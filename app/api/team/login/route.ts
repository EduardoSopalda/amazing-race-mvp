import { NextRequest, NextResponse } from "next/server";
import { getEngine } from "@/lib/raceStore";
import { TEAM_COOKIE } from "@/lib/session";
import { buildTeamStatePayload } from "@/lib/teamState";

export async function POST(request: NextRequest) {
  let body: { teamId?: unknown; pin?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const teamId = typeof body.teamId === "string" ? body.teamId : null;
  const pin = typeof body.pin === "string" ? body.pin : null;
  if (!teamId || !pin) {
    return NextResponse.json({ error: "teamId and pin are required" }, { status: 400 });
  }

  const engine = getEngine();

  let pinOk: boolean;
  try {
    pinOk = engine.verifyPin(teamId, pin);
  } catch {
    return NextResponse.json({ error: "Unknown team" }, { status: 404 });
  }
  if (!pinOk) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }

  // Phase 2 simplification: each team starts its own clock on first login,
  // rather than an organiser triggering a synchronised staggered start
  // (doc §15) - that belongs to the admin dashboard in Phase 6.
  if (!engine.hasStarted(teamId)) {
    engine.startTeam(teamId);
  }

  const response = NextResponse.json({ state: buildTeamStatePayload(engine, teamId) });
  response.cookies.set(TEAM_COOKIE, teamId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
