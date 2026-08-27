"use client";

import { useEffect, useState } from "react";

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

function formatSeconds(totalSeconds: number): string {
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
          setError(data.error ?? "Could not load leaderboard");
          return;
        }
        setRows(data.entries);
        setError(null);
      } catch {
        setError("Could not reach the race server.");
      }
    }
    load();
    const poll = setInterval(load, 3000);
    return () => clearInterval(poll);
  }, []);

  return (
    <main>
      <h1>Leaderboard</h1>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>Progress</th>
              <th>Time</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.teamId}>
                <td>
                  <span className="dot" style={{ background: row.colour }} />
                  {row.name}
                </td>
                <td>
                  {row.checkpointsCleared}/{row.totalCheckpoints}
                </td>
                <td>{row.finished ? formatSeconds(row.adjustedTimeSeconds ?? 0) : "racing"}</td>
                <td>{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
