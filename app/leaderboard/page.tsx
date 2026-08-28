"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface LeaderboardRow {
  teamId: string;
  name: string;
  colour: string;
  finished: boolean;
  checkpointsCleared: number;
  totalCheckpoints: number;
  adjustedTimeSeconds: number | null;
  points: number;
}

const RAIL: Record<string, string> = {
  red: "RED",
  blue: "BLUE",
  green: "GREEN",
  yellow: "YELLOW",
};

function formatSeconds(totalSeconds: number | null, finished: boolean): string {
  if (!finished || totalSeconds == null) return "RACING";
  const clamped = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/leaderboard");
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not load board");
          return;
        }
        setRows(data.entries);
        setError(null);
      } catch {
        setError("Could not reach race control.");
      }
    }
    load();
    const poll = setInterval(load, 3000);
    return () => clearInterval(poll);
  }, []);

  return (
    <div className="phone">
      <div className="tele">
        <div className="tele-top">
          <span>GAB LAB / BARCELONA</span>
          <span className="live">LIVE BOARD</span>
        </div>
      </div>

      <h1 className="board-title">RACE BOARD</h1>
      <p className="board-sub">{String(rows.length).padStart(2, "0")} TEAMS · POLL 3s</p>
      {error && <p className="error">{error}</p>}

      <div className="board-list">
        {rows.map((row) => {
          const total = row.totalCheckpoints || 12;
          const pct = total ? Math.round((row.checkpointsCleared / total) * 100) : 0;
          const rail = RAIL[row.teamId] ?? row.name.toUpperCase();
          return (
            <article
              key={row.teamId}
              className="board-row"
              data-state={row.finished ? "finished" : "racing"}
              style={
                {
                  ["--team" as string]: row.colour,
                  ["--you" as string]: `${pct}%`,
                } as React.CSSProperties
              }
            >
              <div className="board-rail">{rail}</div>
              <div className="board-mid">
                <div className="board-name">{row.name}</div>
                <div className="board-prog">
                  {String(row.checkpointsCleared).padStart(2, "0")} / {String(total).padStart(2, "0")} ·{" "}
                  {row.finished ? "FINISHED" : "RACING"}
                </div>
                <div className="board-bar">
                  <i />
                </div>
              </div>
              <div className="board-stats">
                <div className="board-time">{formatSeconds(row.adjustedTimeSeconds, row.finished)}</div>
                <div className="board-pts">{row.points} PTS</div>
              </div>
            </article>
          );
        })}
      </div>

      <p className="board-back">
        <Link href="/">&larr; RACE CONTROL</Link>
      </p>
    </div>
  );
}
