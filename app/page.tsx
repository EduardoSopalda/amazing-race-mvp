"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const TELE_TEXT = "GAB LAB / BARCELONA";

/**
 * Types TELE_TEXT out character by character on mount - the landing
 * page's one "first contact" moment (doc: make it feel like tuning into
 * a live signal, not just reading a page). Skips straight to the full
 * text under prefers-reduced-motion. The full string is always in the
 * DOM via aria-label regardless of animation state, so a screen reader
 * never has to wait on it - only the visible span is progressive.
 */
function useTypewriter(text: string, speedMs = 32): string {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setOut(text);
      return;
    }
    let i = 0;
    setOut("");
    const id = setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speedMs);
    return () => clearInterval(id);
  }, [text, speedMs]);
  return out;
}

export default function HomePage() {
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const typed = useTypewriter(TELE_TEXT);
  const typing = typed.length < TELE_TEXT.length;

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
          <span aria-label={TELE_TEXT}>
            <span aria-hidden="true">
              {typed}
              {typing && <span className="cursor">▌</span>}
            </span>
          </span>
          <span className={`live ${typing ? "hidden" : "fade-in"}`}>LIVE EVENT</span>
        </div>
      </div>

      <div className="logo-frame">
        <picture>
          <source srcSet="/amazing-race-logo.webp" type="image/webp" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/amazing-race-logo.png" alt="The Amazing Race Barcelona - Gab Lab Edition" />
        </picture>
      </div>

      <article className="brief">
        <div className="mark">GL<br />BCN</div>
        <div className="id">
          <span>CASE GL-BCN-000</span>
          <span>{teamCount !== null ? `${String(teamCount).padStart(2, "0")} TEAMS` : "—"}</span>
        </div>
        <h1>YOUR RACE
          <br />STARTS HERE</h1>
        <p className="line">One official phone. Walk the city. Open the envelope when the gate lets you in.</p>
        <div className="brief-meta">
          <div><b>CONTROL</b> SERVER CLOCK</div>
          <div><b>METHOD</b> ON FOOT</div>
          <div><b>ROUTE</b> SEALED UNTIL ARRIVAL</div>
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
