/**
 * Anonymous profile handling (server-only).
 *
 * The app has no login screen by design (personal single-user assistant), but
 * data is still isolated per browser via a random `pa_profile` id stored in
 * an httpOnly cookie. Every database row carrying `profile_id` is always
 * filtered by this value, so profiles can never see each other's sessions,
 * messages, or calendar events.
 */
import { randomUUID } from 'node:crypto';

export const PROFILE_COOKIE = 'pa_profile';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProfileResolution {
  profileId: string;
  /** Set-Cookie header value when a new id was minted, else null. */
  setCookie: string | null;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

/**
 * Resolves the caller profile from the request cookie, minting a new one when
 * missing/invalid. Callers MUST append `setCookie` to the response when set.
 */
export function resolveProfile(req: Request): ProfileResolution {
  const cookies = parseCookies(req.headers.get('cookie'));
  const existing = cookies[PROFILE_COOKIE];
  if (existing && UUID_RE.test(existing)) {
    return { profileId: existing, setCookie: null };
  }
  const profileId = randomUUID();
  const setCookie =
    `${PROFILE_COOKIE}=${profileId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` +
    (process.env.NODE_ENV === 'production' ? '; Secure' : '');
  return { profileId, setCookie };
}

export function applyProfileCookie(headers: Headers, setCookie: string | null) {
  if (setCookie) headers.append('Set-Cookie', setCookie);
}
