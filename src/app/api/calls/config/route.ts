import { NextResponse } from 'next/server';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { defaultAlertPhone, twilioConfig } from '@/lib/calls/twilio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** UI helper: is phone delivery configured, and what are the defaults? */
export async function GET(req: Request) {
  const { setCookie } = resolveProfile(req);
  let configured = false;
  let fromNumber: string | null = null;
  try {
    fromNumber = twilioConfig().fromNumber;
    configured = true;
  } catch {
    configured = false;
  }
  const res = NextResponse.json({
    configured,
    fromNumber,
    defaultTo: defaultAlertPhone(),
  });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
