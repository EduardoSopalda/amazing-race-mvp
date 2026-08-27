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

type GpsStatus =
  | { kind: "unsupported" }
  | { kind: "denied" }
  | { kind: "searching" }
  | { kind: "waiting" }
  | { kind: "rejected"; reason: "poor_accuracy" | "too_far"; distanceMeters: number; accuracyMeters: number };

function GpsStatusView({ status }: { status: GpsStatus }) {
  switch (status.kind) {
    case "unsupported":
      return <p className="error">This browser can&apos;t access location. Try a different phone or browser.</p>;
    case "denied":
      return (
        <p className="error">
          Location permission denied. Enable it for this site in your browser settings, then reload.
        </p>
      );
    case "searching":
      return <p>Requesting location permission and searching for a signal...</p>;
    case "waiting":
      return <p>Got a signal, checking it against the checkpoint...</p>;
    case "rejected":
      if (status.reason === "poor_accuracy") {
        return (
          <p>
            GPS signal is weak (accuracy {Math.round(status.accuracyMeters)}m). Move to open sky and keep this
            page open.
          </p>
        );
      }
      return <p>Not there yet - about {Math.round(status.distanceMeters)}m away. Keep walking.</p>;
  }
}

export default function TeamPage() {
  const router = useRouter();
  const [state, setState] = useState<TeamStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
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
  const [photoFeedback, setPhotoFeedback] = useState<{ ok: boolean; text: string } | null>(null);
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

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFeedback(null);
    setPhotoBusy(true);
    try {
      const { base64, mediaType, dataUrl } = await compressImage(file);
      setPhotoPreview(dataUrl);
      const res = await fetch("/api/team/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhotoFeedback({ ok: false, text: data.error ?? "Could not submit photo" });
        return;
      }
      if (data.result.outcome === "correct") {
        setPhotoFeedback({ ok: true, text: `Correct! +${data.result.pointsAwarded} points. ${data.judgement.reason}` });
        setPhotoPreview(null);
      } else if (data.result.outcome === "ambiguous") {
        setPhotoFeedback({ ok: false, text: `Not sure yet - ${data.judgement.reason} Try a clearer photo.` });
      } else {
        setPhotoFeedback({
          ok: false,
          text: `Not quite. +${data.result.penaltySeconds}s penalty. ${data.judgement.reason}`,
        });
      }
      setState(data.state);
      clockOffsetRef.current = data.state.serverNowMs - Date.now();
    } catch (err) {
      setPhotoFeedback({ ok: false, text: (err as Error).message });
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function submitAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/team/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, text: data.error ?? "Could not submit" });
        return;
      }
      setAnswer("");
      if (data.result.outcome === "correct") {
        setFeedback({ ok: true, text: `Correct! +${data.result.pointsAwarded} points.` });
      } else {
        setFeedback({ ok: false, text: `Not quite. +${data.result.penaltySeconds}s penalty. Try again.` });
      }
      setState(data.state);
      clockOffsetRef.current = data.state.serverNowMs - Date.now();
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/team/skip", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, text: data.error ?? "Cannot skip yet" });
        return;
      }
      setFeedback({ ok: false, text: `Skipped. +${data.result.penaltySeconds}s penalty.` });
      setState(data.state);
      clockOffsetRef.current = data.state.serverNowMs - Date.now();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main>
        <p className="error">{error}</p>
      </main>
    );
  }

  if (!state) {
    return (
      <main>
        <p>Loading...</p>
      </main>
    );
  }

  const estimatedServerNow = displayNow + clockOffsetRef.current;

  if (state.finished) {
    return (
      <main>
        <h1 style={{ color: state.team.colour }}>{state.team.name}</h1>
        <div className="card">
          <h2>Finished</h2>
          <div className="clock">{formatSeconds(state.adjustedTimeSeconds ?? 0)}</div>
          <div className="stat-row">
            <span>Penalties</span>
            <span>+{state.penaltySeconds}s</span>
          </div>
          <div className="stat-row">
            <span>Skips</span>
            <span>+{state.skipSeconds}s</span>
          </div>
          <div className="stat-row">
            <span>Points</span>
            <span>{state.points}</span>
          </div>
        </div>
        <button className="secondary" onClick={() => router.push("/leaderboard")}>
          View leaderboard
        </button>
      </main>
    );
  }

  const checkpoint = state.checkpoint;
  const elapsedOnCheckpoint = checkpoint
    ? Math.max(0, (estimatedServerNow - (checkpoint.unlockedAtMs ?? estimatedServerNow)) / 1000)
    : 0;
  const remaining = checkpoint ? checkpoint.timeLimitSeconds - elapsedOnCheckpoint : 0;
  const skipAvailable = checkpoint ? elapsedOnCheckpoint >= checkpoint.timeLimitSeconds : false;

  return (
    <main>
      <h1 style={{ color: state.team.colour }}>{state.team.name}</h1>
      {checkpoint && (
        <>
          <p>
            Checkpoint {checkpoint.index} of {checkpoint.total}
          </p>
          <div className="card">
            <span className="badge">{checkpoint.challengeType}</span>
            {checkpoint.requiresGps && !checkpoint.arrived ? (
              <span className="badge" style={{ marginLeft: 8 }}>
                Locked - reach the location
              </span>
            ) : (
              <div className={`clock ${remaining <= 0 ? "warn" : ""}`}>
                {remaining > 0 ? formatSeconds(remaining) : "Skip available"}
              </div>
            )}
            <p>
              <strong>{checkpoint.clue}</strong>
            </p>
            <p>{checkpoint.instruction}</p>
          </div>

          {checkpoint.requiresGps && !checkpoint.arrived ? (
            <div className="card">
              <h2>Getting there</h2>
              <GpsStatusView status={gpsStatus} />
            </div>
          ) : checkpoint.selfChecked ? (
            <form className="card" onSubmit={submitAnswer}>
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
              <button type="submit" className="primary" disabled={busy || !answer.trim()}>
                Submit
              </button>
              {feedback && <p className={feedback.ok ? "success" : "error"}>{feedback.text}</p>}
            </form>
          ) : (
            <div className="card">
              <h2>Submit a photo</h2>
              {photoPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoPreview}
                  alt="Preview of the photo just taken"
                  style={{ width: "100%", borderRadius: 8, marginBottom: 12 }}
                />
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoSelected}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="primary"
                disabled={photoBusy}
                onClick={() => photoInputRef.current?.click()}
              >
                {photoBusy ? "Judging..." : "Take photo"}
              </button>
              {photoFeedback && <p className={photoFeedback.ok ? "success" : "error"}>{photoFeedback.text}</p>}
            </div>
          )}

          {(!checkpoint.requiresGps || checkpoint.arrived) && (
            <button className="secondary" onClick={handleSkip} disabled={busy || !skipAvailable}>
              {skipAvailable ? "Skip (penalty applies)" : `Skip available in ${formatSeconds(remaining)}`}
            </button>
          )}
        </>
      )}

      <div className="stat-row" style={{ marginTop: 24 }}>
        <span>Penalties so far</span>
        <span>+{state.penaltySeconds}s</span>
      </div>
      <div className="stat-row">
        <span>Points so far</span>
        <span>{state.points}</span>
      </div>
    </main>
  );
}
