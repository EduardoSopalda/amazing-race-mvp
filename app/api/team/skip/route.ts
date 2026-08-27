import { NextRequest, NextResponse } from "next/server";
import { withEngine } from "@/lib/raceStore";
import { TEAM_COOKIE } from "@/lib/session";
import { buildTeamStatePayload } from "@/lib/teamState";

export async function POST(request: NextRequest) {
  const teamId = request.cookies.get(TEAM_COOKIE)?.value;
  if (!teamId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  return withEngine((engine) => {
    try {
      const result = engine.skip(teamId);
      return NextResponse.json({ result, state: buildTeamStatePayload(engine, teamId) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  });
}
