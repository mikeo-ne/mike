/**
 * Twilio voice-call client (server-only, dependency-free raw REST — no SDK).
 *
 * Clockwork uses this to phone the user with the spoken morning briefing.
 * Works with a Twilio trial account (30 days, 75 voice minutes, verified
 * numbers only) as well as paid accounts.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (your Twilio
 * number, trial or purchased), ALERT_PHONE_NUMBER (default recipient).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export function twilioConfig(): TwilioConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error(
      'Phone calls are not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in secrets.',
    );
  }
  return { accountSid, authToken, fromNumber };
}

/** Default call recipient (the user's own verified number). */
export function defaultAlertPhone(): string | null {
  return process.env.ALERT_PHONE_NUMBER?.trim() || null;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** TwiML that speaks the briefing script, then hangs up. */
export function briefingTwiml(script: string): string {
  const clean = script.replace(/\s+/g, ' ').trim().slice(0, 4000);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say voice="Polly.Joanna">${escapeXml(clean)}</Say><Hangup/></Response>`
  );
}

interface TwilioCallResponse {
  sid?: string;
  status?: string;
  message?: string;
  code?: number;
}

/**
 * Places an outbound call. Twilio fetches TwiML instructions from `twimlUrl`
 * when the recipient answers, and POSTs call progress to `statusCallbackUrl`.
 */
export async function placeCall(opts: {
  to: string;
  twimlUrl: string;
  statusCallbackUrl?: string;
  timeoutSecs?: number;
}): Promise<{ sid: string }> {
  const { accountSid, authToken, fromNumber } = twilioConfig();
  const to = opts.to.trim();
  if (!to) throw new Error('No destination phone number for the call.');
  const body = new URLSearchParams({
    To: to,
    From: fromNumber,
    Url: opts.twimlUrl,
  });
  if (opts.statusCallbackUrl) {
    body.set('StatusCallback', opts.statusCallbackUrl);
    body.set('StatusCallbackEvent', 'completed');
  }
  if (opts.timeoutSecs) body.set('Timeout', String(opts.timeoutSecs));

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const data = (await res.json().catch(() => ({}))) as TwilioCallResponse;
  if (!res.ok || !data.sid) {
    throw new Error(
      data.message || `Twilio call failed with status ${res.status}.`,
    );
  }
  return { sid: data.sid };
}

/**
 * Validates Twilio's X-Twilio-Signature header (HMAC-SHA1 over the full URL +
 * sorted POST params, per Twilio's security docs). Callbacks without a valid
 * signature must be rejected — otherwise anyone could trigger calls/reads.
 */
export function validateTwilioSignature(opts: {
  url: string;
  params: Record<string, string>;
  signature: string | null;
  authToken: string;
}): boolean {
  if (!opts.signature) return false;
  const data =
    opts.url +
    Object.keys(opts.params)
      .sort()
      .map((k) => k + opts.params[k])
      .join('');
  const expected = createHmac('sha1', opts.authToken)
    .update(data, 'utf8')
    .digest('base64');
  const a = Buffer.from(opts.signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
