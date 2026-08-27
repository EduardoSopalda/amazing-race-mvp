"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PublicTeam {
  id: string;
  name: string;
  colour: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<PublicTeam[]>([]);
  const [teamId, setTeamId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/teams")
      .then((res) => res.json())
      .then((data: { teams: PublicTeam[] }) => {
        setTeams(data.teams);
        if (data.teams.length > 0 && data.teams[0]) setTeamId(data.teams[0].id);
      })
      .catch(() => setError("Could not reach the race server."));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/team/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      router.push("/team");
    } catch {
      setError("Could not reach the race server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // No .strip here, deliberately - there's no team, checkpoint, or race
    // clock yet at login, so this doesn't borrow the in-race header (a real
    // gap the design review caught: showing another team's mid-race state
    // stamped across a login screen).
    <div className="phone">
      <main className="stage">
        <div className="login-brand">
          <picture>
            <source srcSet="/amazing-race-logo.webp" type="image/webp" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/amazing-race-logo.png" alt="The Amazing Race Barcelona - Gab Lab Edition" />
          </picture>
        </div>
        <form id="login-form" className="packet pin" onSubmit={handleSubmit}>
          <span className="stamp">Official device</span>
          <h1>Open the route</h1>
          <p className="mission">One game phone per team. Keep this tab awake once the race starts - the server owns the clock.</p>
          <div className="field">
            <label htmlFor="teamId">Team</label>
            <select id="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pin">Team PIN</label>
            <input
              id="pin"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="1111"
            />
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      </main>
      <footer className="thumb">
        <button type="submit" form="login-form" className="primary" disabled={submitting || !teamId || !pin}>
          {submitting ? "Starting..." : "Seal and start"}
        </button>
      </footer>
    </div>
  );
}
