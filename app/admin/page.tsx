"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminTeamSnapshot } from "@/lib/adminState";

function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function timeAgo(atMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - atMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

const PENALTY_PRESETS = [
  { label: "Minor violation (+2min)", seconds: 120 },
  { label: "Skipped requirement (+5min)", seconds: 300 },
  { label: "Deliberate cheating (+10min)", seconds: 600 },
];

export default function AdminPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<AdminTeamSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);
  const [customSeconds, setCustomSeconds] = useState<Record<string, string>>({});
  const [customReason, setCustomReason] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/teams");
    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not load team status");
      return;
    }
    setTeams(data.teams);
    setError(null);
  }, [router]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 4000);
    return () => clearInterval(poll);
  }, [refresh]);

  async function handleUnlock(teamId: string) {
    setBusyTeamId(teamId);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Could not unlock");
        return;
      }
      setTeams(data.teams);
      setMessage(`${teamId}: manually unlocked`);
    } finally {
      setBusyTeamId(null);
    }
  }

  async function handlePenalty(teamId: string, seconds: number, reason: string) {
    if (!reason.trim()) {
      setMessage("A reason is required for every penalty.");
      return;
    }
    setBusyTeamId(teamId);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, seconds, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Could not apply penalty");
        return;
      }
      setTeams(data.teams);
      setMessage(`${teamId}: +${seconds}s - ${reason}`);
      setCustomSeconds((prev) => ({ ...prev, [teamId]: "" }));
      setCustomReason((prev) => ({ ...prev, [teamId]: "" }));
    } finally {
      setBusyTeamId(null);
    }
  }

  async function handleOverride(teamId: string, verdict: "correct" | "incorrect") {
    setBusyTeamId(teamId);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, verdict }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Could not override");
        return;
      }
      setTeams(data.teams);
      setMessage(`${teamId}: organiser marked ${verdict}`);
    } finally {
      setBusyTeamId(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  if (error) {
    return (
      <main>
        <p className="error">{error}</p>
      </main>
    );
  }

  if (!teams) {
    return (
      <main>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Organiser dashboard</h1>
      {message && <p className="success">{message}</p>}

      {teams.map((team) => (
        <div className="card" key={team.id}>
          <span className="dot" style={{ background: team.colour }} />
          <strong>{team.name}</strong>

          {!team.hasStarted ? (
            <p>Not started yet.</p>
          ) : team.finished ? (
            <div className="stat-row">
              <span>Finished</span>
              <span>{formatSeconds(team.adjustedTimeSeconds ?? 0)}</span>
            </div>
          ) : (
            <>
              <div className="stat-row">
                <span>Checkpoint</span>
                <span>
                  {team.checkpoint?.index}/{team.checkpoint?.total} - {team.checkpoint?.name} (
                  {team.checkpoint?.challengeType})
                </span>
              </div>
              <div className="stat-row">
                <span>Arrived</span>
                <span>{team.checkpoint?.arrived ? "yes" : "no - GPS pending"}</span>
              </div>
              {team.lastGps && (
                <div className="stat-row">
                  <span>Last GPS</span>
                  <span>
                    {team.lastGps.accepted ? "accepted" : `rejected (${team.lastGps.reason})`} - {timeAgo(team.lastGps.atMs)}
                  </span>
                </div>
              )}

              {team.checkpoint &&
                !team.checkpoint.selfChecked &&
                team.checkpoint.arrived &&
                team.lastJudgement &&
                team.lastJudgement.checkpoint === team.checkpoint.index && (
                  <div style={{ marginTop: 12 }}>
                    <label>Last submission on this checkpoint</label>
                    {team.lastJudgement.photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={team.lastJudgement.photoUrl}
                        alt="Last photo submission"
                        style={{ width: "100%", borderRadius: 8, margin: "6px 0" }}
                      />
                    )}
                    <p style={{ fontSize: "0.9rem", color: "#b9bdc8" }}>
                      AI said <strong>{team.lastJudgement.verdict}</strong>
                      {team.lastJudgement.reason ? ` - ${team.lastJudgement.reason}` : ""} ({timeAgo(team.lastJudgement.atMs)})
                    </p>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="secondary"
                        style={{ flex: 1 }}
                        disabled={busyTeamId === team.id}
                        onClick={() => handleOverride(team.id, "correct")}
                      >
                        Override: mark correct
                      </button>
                      <button
                        className="secondary"
                        style={{ flex: 1 }}
                        disabled={busyTeamId === team.id}
                        onClick={() => handleOverride(team.id, "incorrect")}
                      >
                        Override: mark incorrect
                      </button>
                    </div>
                  </div>
                )}
            </>
          )}

          <div className="stat-row">
            <span>Penalties / skips</span>
            <span>
              +{team.penaltySeconds}s / +{team.skipSeconds}s
            </span>
          </div>
          <div className="stat-row">
            <span>Points</span>
            <span>{team.points}</span>
          </div>

          {team.hasStarted && !team.finished && (
            <button
              className="secondary"
              style={{ marginTop: 8 }}
              disabled={busyTeamId === team.id || Boolean(team.checkpoint?.arrived)}
              onClick={() => handleUnlock(team.id)}
            >
              Manually unlock current checkpoint
            </button>
          )}

          {team.hasStarted && (
            <div style={{ marginTop: 12 }}>
              <label>Apply penalty</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {PENALTY_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className="secondary"
                    disabled={busyTeamId === team.id}
                    onClick={() => handlePenalty(team.id, preset.seconds, preset.label)}
                  >
                    {preset.label}
                  </button>
                ))}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="seconds"
                    style={{ width: 70, minWidth: 0 }}
                    value={customSeconds[team.id] ?? ""}
                    onChange={(e) => setCustomSeconds((prev) => ({ ...prev, [team.id]: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="reason"
                    style={{ flex: 1, minWidth: 100 }}
                    value={customReason[team.id] ?? ""}
                    onChange={(e) => setCustomReason((prev) => ({ ...prev, [team.id]: e.target.value }))}
                  />
                  <button
                    className="secondary"
                    style={{ width: "auto", flexShrink: 0 }}
                    disabled={busyTeamId === team.id || !customSeconds[team.id]}
                    onClick={() =>
                      handlePenalty(team.id, Number(customSeconds[team.id] ?? 0), customReason[team.id] ?? "")
                    }
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      <button className="secondary" onClick={handleLogout}>
        Log out
      </button>
    </main>
  );
}
