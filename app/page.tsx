"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function HomePage() {
  const [teamCount, setTeamCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/teams")
      .then((res) => res.json())
      .then((data: { teams: unknown[] }) => setTeamCount(data.teams.length))
      .catch(() => setTeamCount(null));
  }, []);

  return (
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

      <article className="brief">
        <div className="id">
          <span>GL-BCN · DOSSIER</span>
          <span>{teamCount !== null ? `${String(teamCount).padStart(2, "0")} TEAMS` : "—"}</span>
        </div>
        <h1>YOUR RACE
          <br />STARTS HERE</h1>
        <p className="line">One official phone. Walk the city. Open the envelope when the gate lets you in.</p>
        <div className="brief-meta">
          <div><b>CONTROL</b> SERVER CLOCK</div>
          <div><b>METHOD</b> ON FOOT</div>
          <div><b>STATUS</b> TEAMS REPORT TO START</div>
        </div>
      </article>

      <div className="actions">
        <Link href="/team/login">
          <button type="button" className="go">PLAY AS A TEAM &rarr;</button>
        </Link>
        <Link href="/leaderboard">
          <button type="button" className="ghost">VIEW LEADERBOARD</button>
        </Link>
      </div>

      <p className="foot">RACE CONTROL · NOT A TOURIST MAP</p>
    </div>
  );
}
