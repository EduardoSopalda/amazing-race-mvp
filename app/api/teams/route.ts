import { NextResponse } from "next/server";
import { withEngine } from "@/lib/raceStore";

export async function GET() {
  return withEngine((engine) => NextResponse.json({ teams: engine.publicTeams() }));
}
