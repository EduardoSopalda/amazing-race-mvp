"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamStatePayload } from "@/lib/teamState";
import * as AudioRace from "@/lib/audioRace";

function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function stampFor(challengeType: string): string {
  if (challengeType === "qr") return "QR";
  return challengeType.toUpperCase();
}

/** Decimal degrees -> DMS, matching the dossier's field-telemetry style ("41°23'05.8"N"). */
function toDMS(deg: number, axis: "lat" | "lon"): string {
  const dir = axis === "lat" ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W";
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = (minFloat - m) * 60;
  return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(1)}"${dir}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PostResult {
  ok: boolean;
  /** 0 means every attempt failed to get a real response - network down or persistent 5xx. */
  status: number;
  data: Record<string, unknown> & { error?: string };
}

/**
 * A checkpoint submission - especially a multi-hundred-KB photo - has to
 * survive a flaky connection in the Gothic Quarter, not just a fast one
 * (doc §4: "Design for urban GPS, crowds, closed doors"; Phase 4's own bar
 * was "a photo survives a flaky connection"). Retries network failures and
 * 5xx server errors with backoff; a 4xx (bad request, wrong checkpoint
 * type, not logged in) is the server telling us retrying won't help, so it
 * returns immediately instead of wasting attempts.
 */
async function postJsonWithRetry(url: string, body: unknown, attempts = 3): Promise<PostResult> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status < 500) {
        return { ok: res.ok, status: res.status, data };
      }
    } catch {
      // Network failure - fall through to retry.
    }
    if (i < attempts - 1) await sleep(500 * 2 ** i);
  }
  return { ok: false, status: 0, data: {} };
}

type GpsStatus =
  | { kind: "unsupported" }
  | { kind: "denied" }
  | { kind: "searching" }
  | { kind: "waiting" }
  | { kind: "rejected"; reason: "poor_accuracy" | "too_far"; distanceMeters: number; accuracyMeters: number };

/** Maps every real GPS state onto the dossier's DISTANCE/STATUS intel fields, and swaps in an explanatory clue line for the two states a distance/signal readout alone can't explain. */
function gpsIntel(status: GpsStatus): { distance: string; signalStatus: string; clueOverride?: string } {
  switch (status.kind) {
    case "unsupported":
      return { distance: "—", signalStatus: "GPS UNAVAILABLE", clueOverride: "This browser can't access location. Try a different phone or browser." };
    case "denied":
      return { distance: "—", signalStatus: "LOCATION DENIED", clueOverride: "Location permission denied. Enable it for this site in your browser settings, then reload." };
    case "searching":
      return { distance: "—", signalStatus: "GPS ACQUIRING" };
    case "waiting":
      return { distance: "—", signalStatus: "CONFIRMING FIX" };
    case "rejected":
      if (status.reason === "poor_accuracy") {
        return { distance: `±${Math.round(status.accuracyMeters)}m ERROR`, signalStatus: "SIGNAL WEAK" };
      }
      return { distance: `${Math.round(status.distanceMeters)}m`, signalStatus: "OUT OF RANGE" };
  }
}

/** A decisive full-panel outcome - correct/ambiguous/incorrect/skip/transport failure all render through this one shape (doc verdict map: correct -> cleared, ambiguous or transport failure -> hold, wrong or skip -> rejected). */
interface Verdict {
  kind: "cleared" | "rejected" | "hold";
  heading: string;
  text: string;
  cta: string;
  onCta: () => void;
}

export default function TeamPage() {
  const router = useRouter();
  const [state, setState] = useState<TeamStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [muted, setMutedState] = useState(true);

  useEffect(() => {
    // Mirrors the real mute flag once mounted (it reads localStorage /
    // prefers-reduced-motion, both client-only, hence not read at first
    // render to avoid a server/client mismatch).
    setMutedState(AudioRace.isMuted());
    const bootOnce = () => AudioRace.boot();
    document.addEventListener("click", bootOnce);
    return () => document.removeEventListener("click", bootOnce);
  }, []);

  function toggleMuted() {
    const next = !AudioRace.isMuted();
    AudioRace.setMuted(next);
    setMutedState(next);
  }

  // serverNowMs - Date.now() at the moment of the last fetch, so we can keep
  // the on-screen clock ticking between polls without trusting the phone's
  // own clock as the source of truth (doc §3: "server is the official race
  // clock; phones only display it").
  const clockOffsetRef = useRef(0);
  const [displayNow, setDisplayNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const res = await fetch("/api/team/state");
    if (res.status === 401) {
      router.push("/team/login");
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load race state");
      return;
    }
    clockOffsetRef.current = data.state.serverNowMs - Date.now();
    setState(data.state);
    setError(null);
  }, [router]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 4000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const tick = setInterval(() => setDisplayNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const [gpsStatus, setGpsStatus] = useState<GpsStatus>({ kind: "searching" });
  const watchIdRef = useRef<number | null>(null);
  const lastFixRef = useRef<GeolocationPosition | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const needsGps = Boolean(state?.checkpoint?.requiresGps && !state.checkpoint.arrived);

  useEffect(() => {
    function stopWatching() {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (reportTimerRef.current !== null) {
        clearInterval(reportTimerRef.current);
        reportTimerRef.current = null;
      }
    }

    if (!needsGps) {
      stopWatching();
      return;
    }

    if (!("geolocation" in navigator)) {
      setGpsStatus({ kind: "unsupported" });
      return;
    }

    setGpsStatus({ kind: "searching" });

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        lastFixRef.current = pos;
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGpsStatus({ kind: "denied" });
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    async function reportFix() {
      const pos = lastFixRef.current;
      if (!pos) return;
      setGpsStatus({ kind: "waiting" });
      const res = await fetch("/api/team/gps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
        }),
      });
      const data = await res.json();
      if (!res.ok) return;
      if (data.result.accepted) {
        AudioRace.play("unlock");
        setState(data.state);
        clockOffsetRef.current = data.state.serverNowMs - Date.now();
      } else {
        setGpsStatus({
          kind: "rejected",
          reason: data.result.reason,
          distanceMeters: data.result.distanceMeters,
          accuracyMeters: data.result.accuracyMeters,
        });
      }
    }

    reportTimerRef.current = setInterval(reportFix, 4000);
    return stopWatching;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsGps]);

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // Kept only while an upload hasn't actually reached the server (network
  // failure or 5xx after retries) - lets "Retry upload" resend without
  // making the team retake and recompose the photo.
  const [pendingPhoto, setPendingPhoto] = useState<{ base64: string; mediaType: "image/jpeg"; idempotencyKey: string } | null>(
    null
  );
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Resizing onto a canvas and re-exporting as JPEG both compresses the
  // photo before upload and strips all EXIF metadata (including GPS) as a
  // side effect - doc §5/§16: "Strip or ignore EXIF location after judging."
  async function compressImage(file: File): Promise<{ base64: string; mediaType: "image/jpeg"; dataUrl: string }> {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't process images.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    const base64 = dataUrl.split(",")[1] ?? "";
    return { base64, mediaType: "image/jpeg", dataUrl };
  }

  async function submitPhoto(base64: string, mediaType: "image/jpeg", idempotencyKey: string) {
    setPhotoBusy(true);
    AudioRace.play("review");
    try {
      const { ok, status, data } = await postJsonWithRetry("/api/team/photo", {
        imageBase64: base64,
        mediaType,
        idempotencyKey,
      });

      if (status === 0) {
        // Every attempt failed to get a real response - keep the photo (and
        // its key, so a resend is recognised server-side as the same
        // attempt rather than a second AI judging call) for "Retry upload".
        setPendingPhoto({ base64, mediaType, idempotencyKey });
        setVerdict({
          kind: "hold",
          heading: "HOLD",
          text: "UPLOAD DIDN'T GO THROUGH · CHECK YOUR CONNECTION · RETRY",
          cta: "RETRY UPLOAD →",
          onCta: () => {
            setVerdict(null);
            submitPhoto(base64, mediaType, idempotencyKey);
          },
        });
        return;
      }
      setPendingPhoto(null);
      if (!ok) {
        setVerdict({
          kind: "hold",
          heading: "HOLD",
          text: (data.error ?? "COULD NOT SUBMIT THAT PHOTO").toUpperCase(),
          cta: "RETRY →",
          onCta: () => setVerdict(null),
        });
        return;
      }

      const result = data.result as { outcome: string; pointsAwarded: number; penaltySeconds: number; finished: boolean };
      const judgement = data.judgement as { reason: string };
      if (result.outcome === "correct") {
        AudioRace.play("verified");
        setVerdict({
          kind: "cleared",
          heading: "VERIFIED",
          text: `+${result.pointsAwarded} · ${judgement.reason.toUpperCase()}`,
          cta: result.finished ? "FINISH" : "NEXT DOSSIER →",
          onCta: () => {
            setVerdict(null);
            setPhotoPreview(null);
          },
        });
      } else if (result.outcome === "ambiguous") {
        setVerdict({
          kind: "hold",
          heading: "HOLD",
          text: `${judgement.reason.toUpperCase()} · NO PENALTY · TRY AGAIN OR WAIT FOR OVERRIDE`,
          cta: "SHOOT AGAIN →",
          onCta: () => {
            setVerdict(null);
            setPhotoPreview(null);
          },
        });
      } else {
        AudioRace.play("rejected");
        setVerdict({
          kind: "rejected",
          heading: "REJECTED",
          text: `NOT QUITE · +${result.penaltySeconds}s PENALTY · ${judgement.reason.toUpperCase()}`,
          cta: "RESUBMIT →",
          onCta: () => {
            setVerdict(null);
            setPhotoPreview(null);
          },
        });
      }
      setState(data.state as TeamStatePayload);
      clockOffsetRef.current = (data.state as TeamStatePayload).serverNowMs - Date.now();
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { base64, mediaType, dataUrl } = await compressImage(file);
      setPhotoPreview(dataUrl);
      await submitPhoto(base64, mediaType, crypto.randomUUID());
    } catch (err) {
      setVerdict({ kind: "hold", heading: "HOLD", text: (err as Error).message.toUpperCase(), cta: "RETRY →", onCta: () => setVerdict(null) });
    } finally {
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function submitAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    setBusy(true);
    try {
      const { ok, status, data } = await postJsonWithRetry("/api/team/submit", {
        answer,
        idempotencyKey: crypto.randomUUID(),
      });
      if (status === 0) {
        setVerdict({
          kind: "hold",
          heading: "HOLD",
          text: "COULDN'T REACH RACE CONTROL · CHECK YOUR CONNECTION · RETRY",
          cta: "RETRY →",
          onCta: () => setVerdict(null),
        });
        return;
      }
      if (!ok) {
        setVerdict({ kind: "hold", heading: "HOLD", text: (data.error ?? "COULD NOT SUBMIT THAT").toUpperCase(), cta: "RETRY →", onCta: () => setVerdict(null) });
        return;
      }
      const result = data.result as { outcome: string; pointsAwarded: number; penaltySeconds: number; finished: boolean };
      if (result.outcome === "correct") {
        AudioRace.play("verified");
        setAnswer("");
        setVerdict({
          kind: "cleared",
          heading: "VERIFIED",
          text: `CHECKPOINT CLEARED · +${result.pointsAwarded} · ${result.finished ? "FINISH" : "NEXT ENVELOPE"}`,
          cta: result.finished ? "FINISH" : "NEXT DOSSIER →",
          onCta: () => setVerdict(null),
        });
      } else {
        AudioRace.play("rejected");
        setVerdict({
          kind: "rejected",
          heading: "REJECTED",
          text: `NOT QUITE · +${result.penaltySeconds}s PENALTY · TRY AGAIN`,
          cta: "RESUBMIT →",
          onCta: () => {
            setAnswer("");
            setVerdict(null);
          },
        });
      }
      setState(data.state as TeamStatePayload);
      clockOffsetRef.current = (data.state as TeamStatePayload).serverNowMs - Date.now();
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip() {
    setBusy(true);
    AudioRace.play("skip");
    try {
      const { ok, status, data } = await postJsonWithRetry("/api/team/skip", {
        idempotencyKey: crypto.randomUUID(),
      });
      if (status === 0) {
        setVerdict({
          kind: "hold",
          heading: "HOLD",
          text: "COULDN'T REACH RACE CONTROL · CHECK YOUR CONNECTION · RETRY",
          cta: "RETRY →",
          onCta: () => setVerdict(null),
        });
        return;
      }
      if (!ok) {
        setVerdict({ kind: "hold", heading: "HOLD", text: (data.error ?? "CANNOT SKIP YET").toUpperCase(), cta: "RETRY →", onCta: () => setVerdict(null) });
        return;
      }
      const result = data.result as { penaltySeconds: number; finished: boolean };
      setVerdict({
        kind: "rejected",
        heading: "REJECTED",
        text: `SKIPPED · +${result.penaltySeconds}s PENALTY · ${result.finished ? "FINISH" : "NEXT ENVELOPE"}`,
        cta: result.finished ? "FINISH" : "NEXT DOSSIER →",
        onCta: () => setVerdict(null),
      });
      setState(data.state as TeamStatePayload);
      clockOffsetRef.current = (data.state as TeamStatePayload).serverNowMs - Date.now();
    } finally {
      setBusy(false);
    }
  }

  const MuteToggle = (
    <button type="button" className="sound-toggle" aria-pressed={!muted} onClick={toggleMuted}>
      {muted ? "MUTED" : "SOUND"}
    </button>
  );

  if (error) {
    return (
      <div className="phone">
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="phone">
        <p>Loading...</p>
      </div>
    );
  }

  const estimatedServerNow = displayNow + clockOffsetRef.current;
  const checkpoint = state.checkpoint;
  const elapsedOnCheckpoint = checkpoint
    ? Math.max(0, (estimatedServerNow - (checkpoint.unlockedAtMs ?? estimatedServerNow)) / 1000)
    : 0;
  const remaining = checkpoint ? checkpoint.timeLimitSeconds - elapsedOnCheckpoint : 0;
  const skipAvailable = checkpoint ? elapsedOnCheckpoint >= checkpoint.timeLimitSeconds : false;
  const locked = Boolean(checkpoint && checkpoint.requiresGps && !checkpoint.arrived);

  // Telemetry clock: elapsed race time while locked, challenge countdown
  // once open (warns under 60s), adjusted time once finished.
  let clockValue: string;
  let clockLabel: string;
  let clockWarn = false;
  if (state.finished) {
    clockValue = formatSeconds(state.adjustedTimeSeconds ?? 0);
    clockLabel = "FINAL TIME";
  } else if (locked) {
    const elapsedRace = state.startedAtMs !== null ? (estimatedServerNow - state.startedAtMs) / 1000 : 0;
    clockValue = formatSeconds(elapsedRace);
    clockLabel = "RACE TIME";
  } else if (checkpoint) {
    clockValue = formatSeconds(remaining);
    clockLabel = "TIME LEFT";
    clockWarn = remaining <= 60;
  } else {
    clockValue = "—";
    clockLabel = "RACE TIME";
  }

  const coords = lastFixRef.current
    ? `${toDMS(lastFixRef.current.coords.latitude, "lat")}  ${toDMS(lastFixRef.current.coords.longitude, "lon")}`
    : "—";
  const scoreLine = state.finished
    ? "FINISHED"
    : checkpoint
      ? `${state.points} PTS · ${String(checkpoint.index).padStart(2, "0")} / ${checkpoint.total}`
      : `${state.points} PTS`;

  let liveStatus = "";
  let stage: React.ReactNode;
  let thumb: React.ReactNode;

  // verdict is checked first: a correct/skipped submission on the *last*
  // checkpoint sets state.finished=true in the same update as the verdict
  // itself, so without this order the player would jump straight to
  // "race complete" and never see the outcome of their final submission.
  if (verdict) {
    liveStatus = verdict.heading;
    stage = (
      <section className={`verdict ${verdict.kind}`}>
        <div>
          <h2>{verdict.heading}</h2>
          <p>{verdict.text}</p>
        </div>
      </section>
    );
    thumb = (
      <button type="button" className="go" onClick={verdict.onCta}>
        {verdict.cta}
      </button>
    );
  } else if (state.finished) {
    liveStatus = "RACE COMPLETE";
    stage = (
      <article className="dossier">
        <div className="meta"><span>GL-BCN · DOSSIER</span><span>COMPLETE</span></div>
        <p className="place">RACE COMPLETE</p>
        <p className="clue">Every envelope opened. Every checkpoint cleared or paid for.</p>
        <div className="intel">
          <b>PENALTIES</b><span>+{state.penaltySeconds}s</span>
          <b>SKIPS</b><span>+{state.skipSeconds}s</span>
          <b>POINTS</b><span>{state.points}</span>
        </div>
      </article>
    );
    thumb = (
      <button type="button" className="go" onClick={() => router.push("/leaderboard")}>
        VIEW LEADERBOARD →
      </button>
    );
  } else if (checkpoint && locked) {
    const intel = gpsIntel(gpsStatus);
    liveStatus = intel.signalStatus;
    stage = (
      <article className="dossier">
        <div className="mark">{String(checkpoint.index).padStart(2, "0")}<br />BCN</div>
        <div className="meta"><span>GL-BCN-{String(checkpoint.index).padStart(2, "0")} · DOSSIER</span><span>LOCKED</span></div>
        <p className="place">{checkpoint.name}</p>
        <p className="clue">{intel.clueOverride ?? "The envelope stays sealed until you are on the ground."}</p>
        <div className="intel">
          <b>DISTANCE</b><span>{intel.distance}</span>
          <b>METHOD</b><span>ON FOOT</span>
          <b>STATUS</b><span>{intel.signalStatus}</span>
        </div>
        <div className="track">
          <div className="legs"><span>START</span><span className="now">YOU</span><span className="next">FINISH</span></div>
          <div className="bar" style={{ ["--you" as string]: `${Math.round(((checkpoint.index - 1) / checkpoint.total) * 100)}%` }}><b></b><i></i></div>
        </div>
      </article>
    );
    thumb = (
      <button type="button" className="go" disabled>
        ENVELOPE SEALED
      </button>
    );
  } else if (checkpoint && photoBusy) {
    liveStatus = "PHOTO UNDER REVIEW";
    stage = (
      <article className="dossier">
        <div className="mark">{String(checkpoint.index).padStart(2, "0")}<br />BCN</div>
        <div className="meta"><span>GL-BCN-{String(checkpoint.index).padStart(2, "0")} · DOSSIER</span><span>PENDING</span></div>
        <p className="place">{checkpoint.name}</p>
        <p className="clue">Hold the line. Control is reading the frame.</p>
        <div className="intel">
          <b>DISTANCE</b><span>ON SITE</span>
          <b>METHOD</b><span>AI + OVERRIDE</span>
          <b>STATUS</b><span>PHOTO UNDER REVIEW</span>
        </div>
      </article>
    );
    thumb = (
      <button type="button" className="go" disabled>
        UNDER REVIEW
      </button>
    );
  } else if (checkpoint && checkpoint.selfChecked) {
    liveStatus = "CHECKPOINT UNLOCKED";
    stage = (
      <form id="answer-form" className="dossier" onSubmit={submitAnswer}>
        <div className="mark">{String(checkpoint.index).padStart(2, "0")}<br />BCN</div>
        <div className="meta"><span>GL-BCN-{String(checkpoint.index).padStart(2, "0")} · DOSSIER</span><span>UNLOCKED</span></div>
        <p className="place">{checkpoint.name}</p>
        <p className="clue">{checkpoint.clue}</p>
        <div className="obj"><b>YOUR MISSION</b><span>{checkpoint.instruction}</span></div>
        <div className="field">
          <label htmlFor="answer">YOUR ANSWER</label>
          <input
            id="answer"
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="intel">
          <b>DISTANCE</b><span>ON SITE</span>
          <b>METHOD</b><span>{stampFor(checkpoint.challengeType)}</span>
          <b>STATUS</b><span>CHECKPOINT IN RANGE</span>
        </div>
        <div className="track">
          <div className="legs"><span>START</span><span className="now">YOU</span><span className="next">FINISH</span></div>
          <div className="bar" style={{ ["--you" as string]: `${Math.round(((checkpoint.index - 1) / checkpoint.total) * 100)}%` }}><b></b><i></i></div>
        </div>
      </form>
    );
    thumb = (
      <>
        <button type="submit" form="answer-form" className="go" disabled={busy || !answer.trim()}>
          SUBMIT →
        </button>
        <button type="button" className="skip" onClick={handleSkip} disabled={busy || !skipAvailable}>
          {skipAvailable ? "SKIP CHECKPOINT · PENALTY APPLIES" : `SKIP AVAILABLE IN ${formatSeconds(remaining)}`}
        </button>
      </>
    );
  } else if (checkpoint) {
    liveStatus = "CHECKPOINT UNLOCKED";
    stage = (
      <article className="dossier">
        <div className="mark">{String(checkpoint.index).padStart(2, "0")}<br />BCN</div>
        <div className="meta"><span>GL-BCN-{String(checkpoint.index).padStart(2, "0")} · DOSSIER</span><span>UNLOCKED</span></div>
        <p className="place">{checkpoint.name}</p>
        <p className="clue">{checkpoint.clue}</p>
        <div className="obj"><b>YOUR MISSION</b><span>{checkpoint.instruction}</span></div>
        <div className="intel">
          <b>DISTANCE</b><span>ON SITE</span>
          <b>METHOD</b><span>ON FOOT</span>
          <b>STATUS</b><span>CHECKPOINT IN RANGE</span>
        </div>
        <div className="track">
          <div className="legs"><span>START</span><span className="now">YOU</span><span className="next">FINISH</span></div>
          <div className="bar" style={{ ["--you" as string]: `${Math.round(((checkpoint.index - 1) / checkpoint.total) * 100)}%` }}><b></b><i></i></div>
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoSelected}
          style={{ display: "none" }}
        />
      </article>
    );
    thumb = (
      <>
        <button type="button" className="go" disabled={photoBusy} onClick={() => photoInputRef.current?.click()}>
          OPEN CAMERA →
        </button>
        {pendingPhoto && (
          <button
            type="button"
            className="skip"
            disabled={photoBusy}
            onClick={() => submitPhoto(pendingPhoto.base64, pendingPhoto.mediaType, pendingPhoto.idempotencyKey)}
          >
            {photoBusy ? "RETRYING..." : "RETRY UPLOAD"}
          </button>
        )}
        <button type="button" className="skip" onClick={handleSkip} disabled={busy || !skipAvailable}>
          {skipAvailable ? "SKIP CHECKPOINT · PENALTY APPLIES" : `SKIP AVAILABLE IN ${formatSeconds(remaining)}`}
        </button>
      </>
    );
  } else {
    stage = (
      <article className="dossier">
        <p className="clue">Loading the next envelope...</p>
      </article>
    );
    thumb = null;
  }

  return (
    <div className="rig" data-team={state.team.id}>
      <div className="rail">{state.team.name.toUpperCase()}</div>
      <header className="tele">
        <div className="tele-top">
          <span>GAB LAB / BARCELONA</span>
          <span style={{ display: "flex", alignItems: "center" }}>
            <span className="live">{liveStatus}</span>
            {MuteToggle}
          </span>
        </div>
        <div className="who">TEAM {state.team.name.toUpperCase()}</div>
        <div className={`clock ${clockWarn ? "warn" : ""}`}>
          {clockValue}
          <small>{clockLabel}</small>
        </div>
        <div className="tele-bot">
          <span>{coords}</span>
          <span>{scoreLine}</span>
        </div>
      </header>
      <main className="stage">{stage}</main>
      <footer className="thumb">{thumb}</footer>
    </div>
  );
}
