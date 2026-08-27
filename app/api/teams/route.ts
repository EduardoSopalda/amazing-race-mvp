import { NextResponse } from "next/server";
import { getEngine } from "@/lib/raceStore";

export async function GET() {
  const engine = getEngine();
  return NextResponse.json({ teams: engine.publicTeams() });
}
