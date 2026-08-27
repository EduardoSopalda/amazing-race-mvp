import { NextResponse } from "next/server";
import { withEngine } from "@/lib/raceStore";

export async function GET() {
  return withEngine((engine) => {
    const teams = new Map(engine.publicTeams().map((t) => [t.id, t]));
    const entries = engine.leaderboard().map((entry) => ({
      ...entry,
      name: teams.get(entry.teamId)?.name ?? entry.teamId,
      colour: teams.get(entry.teamId)?.colour ?? "#999999",
    }));
    return NextResponse.json({ entries, serverNowMs: Date.now() });
  });
}
