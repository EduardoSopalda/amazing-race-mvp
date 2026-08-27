import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidAdminCookie } from "@/lib/adminAuth";
import { buildAdminSnapshot } from "@/lib/adminState";
import { withEngine } from "@/lib/raceStore";

export async function GET(request: NextRequest) {
  if (!isValidAdminCookie(request.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  return withEngine((engine) => NextResponse.json({ teams: buildAdminSnapshot(engine) }));
}
