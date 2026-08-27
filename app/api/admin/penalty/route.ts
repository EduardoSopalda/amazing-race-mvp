import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidAdminCookie } from "@/lib/adminAuth";
import { buildAdminSnapshot } from "@/lib/adminState";
import { withEngine } from "@/lib/raceStore";

export async function POST(request: NextRequest) {
  if (!isValidAdminCookie(request.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  let body: { teamId?: unknown; seconds?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const teamId = typeof body.teamId === "string" ? body.teamId : null;
  const seconds = typeof body.seconds === "number" ? body.seconds : null;
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!teamId || seconds === null) {
    return NextResponse.json({ error: "teamId and seconds are required" }, { status: 400 });
  }

  return withEngine((engine) => {
    try {
      engine.applyPenalty(teamId, seconds, reason || "No reason given");
      return NextResponse.json({ teams: buildAdminSnapshot(engine) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  });
}
