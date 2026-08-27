export const ADMIN_COOKIE = "bcnrace_admin";

/**
 * The cookie holds the organiser key itself (same low-stakes pattern as the
 * team session cookie) so rotating ORGANISER_KEY invalidates old sessions
 * automatically. If ORGANISER_KEY isn't set at all, admin access is refused
 * outright - an unset env var must never be treated as an open door.
 */
export function isValidAdminCookie(cookieValue: string | undefined): boolean {
  const key = process.env.ORGANISER_KEY;
  if (!key) return false;
  return cookieValue === key;
}
