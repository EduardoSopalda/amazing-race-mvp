import Link from "next/link";

export default function HomePage() {
  return (
    <div className="phone">
      <main className="stage">
        <div className="login-brand">
          <picture>
            <source srcSet="/amazing-race-logo.webp" type="image/webp" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/amazing-race-logo.png" alt="The Amazing Race Barcelona - Gab Lab Edition" />
          </picture>
        </div>
        <div className="packet">
          <h1>Barcelona Race</h1>
          <p className="mission">Walk the city, solve the clues, beat the clock. Grab a phone, pick your team, and start the route.</p>
        </div>
      </main>
      <footer className="thumb">
        <Link href="/team/login">
          <button type="button" className="primary">
            Play as a team
          </button>
        </Link>
        <Link href="/leaderboard">
          <button type="button" className="secondary">
            View leaderboard
          </button>
        </Link>
      </footer>
    </div>
  );
}
