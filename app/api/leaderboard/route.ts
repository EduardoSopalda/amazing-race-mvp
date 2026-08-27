import { NextResponse } from "next/server";
import { getEngine } from "@/lib/raceStore";

export async function GET() {
  const engine = getEngine();
  const teams = new Map(engine.publicTeams().map((t) => [t.id, t]));
  const entries = engine.leaderboard().map((entry) => ({
    ...entry,
    name: teams.get(entry.teamId)?.name ?? entry.teamId,
    colour: teams.get(entry.teamId)?.colour ?? "#999999",
  }));
  return NextResponse.json({ entries, serverNowMs: Date.now() });
}
