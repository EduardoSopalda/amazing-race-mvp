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
    // Plain .phone shell (no .rail/.rig grid) - deliberately: there's no
    // team, checkpoint, or race clock confirmed yet at login, so this
    // doesn't borrow the in-race header (a real gap the design review
    // caught: showing another team's mid-race state before login).
    <div className="phone">
      <div className="tele">
        <div className="tele-top">
          <span>GAB LAB / BARCELONA</span>
          <span className="live">LIVE EVENT</span>
        </div>
      </div>

      <picture>
        <source srcSet="/amazing-race-logo.webp" type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/amazing-race-logo.png" alt="The Amazing Race Barcelona - Gab Lab Edition" />
      </picture>

      <form id="login-form" className="brief" onSubmit={handleSubmit}>
        <div className="id">
          <span>GL-BCN · DOSSIER</span>
          <span>OFFICIAL DEVICE</span>
        </div>
        <h1>OPEN THE
          <br />ROUTE</h1>
        <p className="line">One game phone per team. Keep this tab awake once the race starts - the server owns the clock.</p>
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

      <div className="actions">
        <button type="submit" form="login-form" className="go" disabled={submitting || !teamId || !pin}>
          {submitting ? "STARTING..." : "SEAL AND START"}
        </button>
      </div>
    </div>
  );
}
