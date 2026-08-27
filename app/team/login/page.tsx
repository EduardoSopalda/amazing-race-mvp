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
    <main>
      <h1>Barcelona Race</h1>
      <h2>Team login</h2>
      <form className="card" onSubmit={handleSubmit}>
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
          <label htmlFor="pin">PIN</label>
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
        <button type="submit" className="primary" disabled={submitting || !teamId || !pin}>
          {submitting ? "Starting..." : "Start race"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
