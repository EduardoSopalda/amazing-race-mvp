import { NextRequest, NextResponse } from "next/server";
import { getEngine } from "@/lib/raceStore";
import { TEAM_COOKIE } from "@/lib/session";
import { buildTeamStatePayload } from "@/lib/teamState";

export async function GET(request: NextRequest) {
  const teamId = request.cookies.get(TEAM_COOKIE)?.value;
  if (!teamId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  const engine = getEngine();
  try {
    return NextResponse.json({ state: buildTeamStatePayload(engine, teamId) });
  } catch {
    return NextResponse.json({ error: "Unknown team" }, { status: 404 });
  }
}
