import { NextRequest, NextResponse } from "next/server";
import { withEngine } from "@/lib/raceStore";
import { TEAM_COOKIE } from "@/lib/session";
import { buildTeamStatePayload } from "@/lib/teamState";

export async function POST(request: NextRequest) {
  const teamId = request.cookies.get(TEAM_COOKIE)?.value;
  if (!teamId) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  let body: { latitude?: unknown; longitude?: unknown; accuracyMeters?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const latitude = typeof body.latitude === "number" ? body.latitude : null;
  const longitude = typeof body.longitude === "number" ? body.longitude : null;
  const accuracyMeters = typeof body.accuracyMeters === "number" ? body.accuracyMeters : null;
  if (latitude === null || longitude === null || accuracyMeters === null) {
    return NextResponse.json(
      { error: "latitude, longitude and accuracyMeters are required numbers" },
      { status: 400 }
    );
  }

  return withEngine((engine) => {
    try {
      const result = engine.reportPosition(teamId, { latitude, longitude, accuracyMeters });
      return NextResponse.json({ result, state: buildTeamStatePayload(engine, teamId) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  });
}
