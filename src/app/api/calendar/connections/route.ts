import { NextResponse } from 'next/server';
import { getGoogleConnectionStatus } from '@/lib/calendar/google';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lists the profile's external calendar connections (no secrets). */
export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const connections = [];
  const google = await getGoogleConnectionStatus(profileId);
  if (google) connections.push(google);
  const res = NextResponse.json({ connections });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
