import { NextResponse } from 'next/server';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { defaultAlertPhone, twilioConfig } from '@/lib/calls/twilio';
import { defaultTelegramChat, telegramConfig } from '@/lib/notify/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** UI helper: which delivery channels are configured, and their defaults? */
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
  let telegramConfigured = false;
  try {
    telegramConfig();
    telegramConfigured = true;
  } catch {
    telegramConfigured = false;
  }
  const res = NextResponse.json({
    configured,
    fromNumber,
    defaultTo: defaultAlertPhone(),
    telegram: {
      configured: telegramConfigured,
      defaultTo: defaultTelegramChat(),
    },
  });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
