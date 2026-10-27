import { NextResponse } from 'next/server';
import {
  googleClientCredentials,
  googleRedirectUri,
  saveGoogleConnection,
} from '@/lib/calendar/google';
import { verifyState } from '@/lib/crypto';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Google OAuth callback: verifies state, exchanges the code, stores tokens. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const { profileId, setCookie } = resolveProfile(req);

  const fail = (message: string) => {
    const res = NextResponse.redirect(
      `${origin}/?calendar=google-error&message=${encodeURIComponent(message)}`,
    );
    applyProfileCookie(res.headers, setCookie);
    return res;
  };

  const googleError = url.searchParams.get('error');
  if (googleError) {
    return fail(`Google authorization failed: ${googleError}`);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return fail('Missing code/state in Google callback.');
  }
  try {
    const [payloadB64, signature] = state.split('.');
    const payload = Buffer.from(payloadB64 ?? '', 'base64url').toString('utf8');
    if (!verifyState(payload, signature ?? '')) {
      return fail('Invalid OAuth state signature.');
    }
    const [stateProfile, , expStr] = payload.split('.');
    if (stateProfile !== profileId) {
      return fail('Session mismatch — please retry connecting.');
    }
    if (Number(expStr) < Date.now()) {
      return fail('Authorization expired — please retry connecting.');
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Invalid OAuth state.');
  }

  try {
    const { clientId, clientSecret } = googleClientCredentials();
    const redirectUri = googleRedirectUri(origin);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    };
    if (!tokenRes.ok || !tokens.access_token) {
      throw new Error(
        tokens.error_description || tokens.error || 'Token exchange failed.',
      );
    }
    let email: string | null = null;
    try {
      const userRes = await fetch(
        'https://openidconnect.googleapis.com/v1/userinfo',
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (userRes.ok) {
        email = ((await userRes.json()) as { email?: string }).email ?? null;
      }
    } catch {
      /* email is a nicety, not a requirement */
    }
    await saveGoogleConnection(profileId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_in: tokens.expires_in ?? null,
      email,
    });
    const res = NextResponse.redirect(`${origin}/?calendar=google-connected`);
    applyProfileCookie(res.headers, setCookie);
    return res;
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Connect failed.');
  }
}
