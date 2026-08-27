import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidAdminCookie } from "@/lib/adminAuth";
import { buildAdminSnapshot } from "@/lib/adminState";
import { withEngine } from "@/lib/raceStore";

export async function POST(request: NextRequest) {
  if (!isValidAdminCookie(request.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  let body: { teamId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const teamId = typeof body.teamId === "string" ? body.teamId : null;
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  return withEngine((engine) => {
    try {
      engine.manualUnlock(teamId);
      return NextResponse.json({ teams: buildAdminSnapshot(engine) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  });
}
