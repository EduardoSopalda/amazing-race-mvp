import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Barcelona Race</h1>
      <p>Phase 2 desk-race build. No GPS, no photos yet - text-answer checkpoints only.</p>
      <div className="card">
        <Link href="/team/login">
          <button className="primary">Play as a team</button>
        </Link>
      </div>
      <div className="card">
        <Link href="/leaderboard">
          <button className="secondary">View leaderboard</button>
        </Link>
      </div>
    </main>
  );
}
