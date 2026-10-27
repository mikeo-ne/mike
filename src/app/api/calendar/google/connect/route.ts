import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  GOOGLE_CALENDAR_SCOPE,
  googleClientCredentials,
  googleRedirectUri,
} from '@/lib/calendar/google';
import { signState } from '@/lib/crypto';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Starts Google OAuth: redirects the browser to Google's consent screen. */
export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  try {
    const origin = new URL(req.url).origin;
    const { clientId } = googleClientCredentials();
    const redirectUri = googleRedirectUri(origin);
    // Throws early with setup instructions when the encryption key is missing
    // (it is needed to store tokens and to sign the state param).
    const payload = `${profileId}.${randomUUID()}.${Date.now() + 10 * 60_000}`;
    const state = `${Buffer.from(payload, 'utf8').toString('base64url')}.${signState(payload)}`;

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    const res = NextResponse.redirect(authUrl);
    applyProfileCookie(res.headers, setCookie);
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Connect failed.' },
      { status: 400 },
    );
  }
}
