import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidAdminCookie } from "@/lib/adminAuth";

export async function POST(request: NextRequest) {
  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : null;
  if (!password) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }
  if (!process.env.ORGANISER_KEY) {
    return NextResponse.json({ error: "Admin access is not configured (ORGANISER_KEY unset)" }, { status: 503 });
  }
  if (!isValidAdminCookie(password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, password, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
