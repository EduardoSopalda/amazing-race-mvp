import { NextResponse } from "next/server";
import { TEAM_COOKIE } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(TEAM_COOKIE);
  return response;
}
