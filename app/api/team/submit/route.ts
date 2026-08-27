import { NextRequest, NextResponse } from "next/server";
import { withEngine } from "@/lib/raceStore";
import { TEAM_COOKIE } from "@/lib/session";
import { buildTeamStatePayload } from "@/lib/teamState";

export async function POST(request: NextRequest) {
  const teamId = request.cookies.get(TEAM_COOKIE)?.value;
  if (!teamId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  let body: { answer?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const answer = typeof body.answer === "string" ? body.answer : null;
  if (!answer) {
    return NextResponse.json({ error: "answer is required" }, { status: 400 });
  }

  return withEngine((engine) => {
    try {
      const result = engine.submitAnswer(teamId, answer);
      return NextResponse.json({ result, state: buildTeamStatePayload(engine, teamId) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  });
}
