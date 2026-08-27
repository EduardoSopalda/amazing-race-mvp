"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamStatePayload } from "@/lib/teamState";

function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function stampFor(challengeType: string): string {
  if (challengeType === "qr") return "QR";
  return challengeType.charAt(0).toUpperCase() + challengeType.slice(1);
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

/** Maps every real GPS state onto the skin's .gps.good|poor|dead meter, with real numbers where there are any. */
function gpsMeterInfo(status: GpsStatus): { cls: "good" | "poor" | "dead"; signal: string; detail: string } {
  switch (status.kind) {
    case "unsupported":
      return { cls: "dead", signal: "Unavailable", detail: "This browser can't access location. Try a different phone or browser." };
    case "denied":
      return { cls: "dead", signal: "Denied", detail: "Enable location for this site in your browser settings, then reload." };
    case "searching":
      return { cls: "poor", signal: "Searching…", detail: "Requesting a fix. Keep this page open." };
    case "waiting":
      return { cls: "poor", signal: "Checking…", detail: "Confirming your position against the checkpoint." };
    case "rejected":
      if (status.reason === "poor_accuracy") {
        return { cls: "poor", signal: `Poor · ${Math.round(status.accuracyMeters)}m`, detail: "Move to open sky and keep this page open." };
      }
      return { cls: "poor", signal: `${Math.round(status.distanceMeters)}m away`, detail: "Keep walking." };
  }
}

function GpsMeter({ status }: { status: GpsStatus }) {
  const info = gpsMeterInfo(status);
  return (
    <div className={`gps ${info.cls}`}>
      <div className="gps-row">
        <span>Signal</span>
        <span>{info.signal}</span>
      </div>
      <div className="meter">
        <i />
      </div>
      <div className="gps-row">
        <span>{info.detail}</span>
      </div>
    </div>
  );
}

/** A decisive full-panel outcome - correct/ambiguous/incorrect/skip/transport failure all render through this one shape (doc verdict map: correct -> green, ambiguous or upload fail -> amber, wrong or skip -> red). */
interface Verdict {
  kind: "green" | "amber" | "red";
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
          kind: "amber",
          heading: "Hold",
          text: "Upload didn't go through. Check your connection, then retry.",
          cta: "Retry upload",
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
          kind: "amber",
          heading: "Hold",
          text: data.error ?? "Could not submit that photo.",
          cta: "Retry",
          onCta: () => setVerdict(null),
        });
        return;
      }

      const result = data.result as { outcome: string; pointsAwarded: number; penaltySeconds: number; finished: boolean };
      const judgement = data.judgement as { reason: string };
      if (result.outcome === "correct") {
        setVerdict({
          kind: "green",
          heading: "Clear",
          text: `+${result.pointsAwarded} points. ${judgement.reason}`,
          cta: result.finished ? "Finish" : "Next stop",
          onCta: () => {
            setVerdict(null);
            setPhotoPreview(null);
          },
        });
      } else if (result.outcome === "ambiguous") {
        setVerdict({
          kind: "amber",
          heading: "Hold",
          text: `${judgement.reason} No penalty - try a clearer photo, or an organiser can step in.`,
          cta: "Shoot again",
          onCta: () => {
            setVerdict(null);
            setPhotoPreview(null);
          },
        });
      } else {
        setVerdict({
          kind: "red",
          heading: "No",
          text: `+${result.penaltySeconds}s penalty. ${judgement.reason}`,
          cta: "Resubmit",
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
      setVerdict({ kind: "amber", heading: "Hold", text: (err as Error).message, cta: "Retry", onCta: () => setVerdict(null) });
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
          kind: "amber",
          heading: "Hold",
          text: "Couldn't reach the race server. Check your connection and resubmit.",
          cta: "Retry",
          onCta: () => setVerdict(null),
        });
        return;
      }
      if (!ok) {
        setVerdict({ kind: "amber", heading: "Hold", text: data.error ?? "Could not submit that.", cta: "Retry", onCta: () => setVerdict(null) });
        return;
      }
      const result = data.result as { outcome: string; pointsAwarded: number; penaltySeconds: number; finished: boolean };
      if (result.outcome === "correct") {
        setAnswer("");
        setVerdict({
          kind: "green",
          heading: "Clear",
          text: `+${result.pointsAwarded} points.`,
          cta: result.finished ? "Finish" : "Next stop",
          onCta: () => setVerdict(null),
        });
      } else {
        setVerdict({
          kind: "red",
          heading: "No",
          text: `+${result.penaltySeconds}s penalty.`,
          cta: "Resubmit",
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
    try {
      const { ok, status, data } = await postJsonWithRetry("/api/team/skip", {
        idempotencyKey: crypto.randomUUID(),
      });
      if (status === 0) {
        setVerdict({
          kind: "amber",
          heading: "Hold",
          text: "Couldn't reach the race server. Check your connection and try again.",
          cta: "Retry",
          onCta: () => setVerdict(null),
        });
        return;
      }
      if (!ok) {
        setVerdict({ kind: "amber", heading: "Hold", text: data.error ?? "Cannot skip yet.", cta: "Retry", onCta: () => setVerdict(null) });
        return;
      }
      const result = data.result as { penaltySeconds: number; finished: boolean };
      setVerdict({
        kind: "red",
        heading: "No",
        text: `Skipped. +${result.penaltySeconds}s penalty.`,
        cta: result.finished ? "Finish" : "Next stop",
        onCta: () => setVerdict(null),
      });
      setState(data.state as TeamStatePayload);
      clockOffsetRef.current = (data.state as TeamStatePayload).serverNowMs - Date.now();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="phone">
        <main className="stage">
          <p className="error">{error}</p>
        </main>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="phone">
        <main className="stage">
          <p>Loading...</p>
        </main>
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

  // Strip clock: elapsed race time while locked, challenge countdown once
  // open (warns under 60s), adjusted time once finished.
  let stripClock: string;
  let stripWarn = false;
  if (state.finished) {
    stripClock = formatSeconds(state.adjustedTimeSeconds ?? 0);
  } else if (locked) {
    const elapsedRace = state.startedAtMs !== null ? (estimatedServerNow - state.startedAtMs) / 1000 : 0;
    stripClock = formatSeconds(elapsedRace);
  } else if (checkpoint) {
    stripClock = formatSeconds(remaining);
    stripWarn = remaining <= 60;
  } else {
    stripClock = "—";
  }

  let stage: React.ReactNode;
  let thumb: React.ReactNode;

  // verdict is checked first: a correct/skipped submission on the *last*
  // checkpoint sets state.finished=true in the same update as the verdict
  // itself, so without this order the player would jump straight to "Race
  // complete" and never see the "Clear" moment for their final submission.
  if (verdict) {
    stage = (
      <div className={`verdict ${verdict.kind}`}>
        <div>
          <h2>{verdict.heading}</h2>
          <p>{verdict.text}</p>
        </div>
      </div>
    );
    thumb = (
      <button type="button" className="primary" onClick={verdict.onCta}>
        {verdict.cta}
      </button>
    );
  } else if (state.finished) {
    stage = (
      <div className="packet">
        <span className="stamp">Finished</span>
        <h1>Race complete</h1>
        <p className="mission">Adjusted time includes every penalty and skip along the way.</p>
        <div className="meta-line">
          <span>Penalties</span>
          <span>+{state.penaltySeconds}s</span>
        </div>
        <div className="meta-line">
          <span>Skips</span>
          <span>+{state.skipSeconds}s</span>
        </div>
        <div className="meta-line">
          <span>Points</span>
          <span>{state.points}</span>
        </div>
      </div>
    );
    thumb = (
      <button type="button" className="primary" onClick={() => router.push("/leaderboard")}>
        View leaderboard
      </button>
    );
  } else if (checkpoint && locked) {
    stage = (
      <div className="packet">
        <span className="stamp">Locked</span>
        <h1>Not yet</h1>
        <p className="clue">The city is still closed. Walk into the fence.</p>
        <p className="mission">Clue waits until GPS is good enough. A weak fix is not drama - it is a dispute.</p>
        <GpsMeter status={gpsStatus} />
      </div>
    );
    thumb = (
      <button type="button" className="secondary" disabled>
        Clue sealed
      </button>
    );
  } else if (checkpoint && checkpoint.selfChecked) {
    stage = (
      <form id="answer-form" className="packet" onSubmit={submitAnswer}>
        <span className="stamp">{stampFor(checkpoint.challengeType)}</span>
        <h1>Stop {checkpoint.index}</h1>
        <p className="clue">{checkpoint.clue}</p>
        <p className="mission">{checkpoint.instruction}</p>
        <div className="field">
          <label htmlFor="answer">Your answer</label>
          <input
            id="answer"
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            autoComplete="off"
          />
        </div>
      </form>
    );
    thumb = (
      <>
        <button type="submit" form="answer-form" className="primary" disabled={busy || !answer.trim()}>
          Submit answer
        </button>
        <button type="button" className="secondary" onClick={handleSkip} disabled={busy || !skipAvailable}>
          {skipAvailable ? "Skip (penalty applies)" : `Skip in ${formatSeconds(remaining)}`}
        </button>
      </>
    );
  } else if (checkpoint) {
    stage = (
      <div className="packet">
        <span className="stamp">{stampFor(checkpoint.challengeType)}</span>
        <h1>Stop {checkpoint.index}</h1>
        <p className="clue">{checkpoint.clue}</p>
        <p className="mission">{checkpoint.instruction}</p>
        {photoPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="preview-frame" src={photoPreview} alt="Preview of the photo just taken" />
        ) : (
          <div className="preview">Camera frame</div>
        )}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoSelected}
          style={{ display: "none" }}
        />
      </div>
    );
    thumb = (
      <>
        <button type="button" className="primary" disabled={photoBusy} onClick={() => photoInputRef.current?.click()}>
          {photoBusy ? "Uploading..." : "Open camera"}
        </button>
        {pendingPhoto && (
          <button
            type="button"
            className="secondary"
            disabled={photoBusy}
            onClick={() => submitPhoto(pendingPhoto.base64, pendingPhoto.mediaType, pendingPhoto.idempotencyKey)}
          >
            {photoBusy ? "Retrying..." : "Retry upload"}
          </button>
        )}
        <button type="button" className="secondary" onClick={handleSkip} disabled={busy || !skipAvailable}>
          {skipAvailable ? "Skip (penalty applies)" : `Skip in ${formatSeconds(remaining)}`}
        </button>
      </>
    );
  } else {
    stage = (
      <div className="packet">
        <p className="mission">Loading the next checkpoint...</p>
      </div>
    );
    thumb = null;
  }

  return (
    <div className="phone" data-team={state.team.id} style={{ ["--team" as string]: state.team.colour }}>
      <header className="strip">
        <div className="team-seal">{state.team.name.charAt(0).toUpperCase()}</div>
        <div className="strip-mid">
          <p className="eyebrow">
            {state.team.name} · {state.finished ? "Finished" : checkpoint ? `Stop ${checkpoint.index}` : ""}
          </p>
          <p className="stop-name">{state.finished ? "Race complete" : (checkpoint?.name ?? "")}</p>
        </div>
        <div className={`clock ${stripWarn ? "warn" : ""}`}>{stripClock}</div>
      </header>
      <main className="stage">{stage}</main>
      <footer className="thumb">{thumb}</footer>
    </div>
  );
}
