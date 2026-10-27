import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { twilioConfig, validateTwilioSignature } from '@/lib/calls/twilio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Twilio call-progress callback: records the final call status on the run. */
export async function POST(req: Request) {
  let authToken: string;
  try {
    authToken = twilioConfig().authToken;
  } catch {
    return NextResponse.json({ error: 'Calls not configured.' }, { status: 503 });
  }
  const form = await req.formData().catch(() => null);
  const params: Record<string, string> = {};
  form?.forEach((value, key) => {
    if (typeof value === 'string') params[key] = value;
  });
  const valid = validateTwilioSignature({
    url: req.url.split('?')[0],
    params,
    signature: req.headers.get('x-twilio-signature'),
    authToken,
  });
  if (!valid) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  const callSid = params.CallSid;
  const callStatus = params.CallStatus;
  if (callSid && callStatus) {
    const { db } = await getDb();
    await db
      .update(schema.scheduledRuns)
      .set({ callStatus })
      .where(eq(schema.scheduledRuns.callSid, callSid));
  }
  return NextResponse.json({ ok: true });
}
