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
            <div className={`clock ${remaining <= 0 ? "warn" : ""}`}>
              {remaining > 0 ? formatSeconds(remaining) : "Skip available"}
            </div>
            <p>
              <strong>{checkpoint.clue}</strong>
            </p>
            <p>{checkpoint.instruction}</p>
          </div>

          {checkpoint.selfChecked ? (
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
              <p>
                This checkpoint needs a photo or human judgement, which isn&apos;t built yet
                (Phases 4-5). Ask the organiser to advance you manually for this desk test.
              </p>
            </div>
          )}

          <button className="secondary" onClick={handleSkip} disabled={busy || !skipAvailable}>
            {skipAvailable ? "Skip (penalty applies)" : `Skip available in ${formatSeconds(remaining)}`}
          </button>
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
