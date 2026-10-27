import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { briefingTwiml, twilioConfig, validateTwilioSignature } from '@/lib/calls/twilio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serves the spoken briefing script as TwiML. Twilio requests this URL when
 * the recipient answers. Only Twilio (valid signature) can fetch a script —
 * the run id alone is not enough.
 */
export async function POST(req: Request) {
  const runId = new URL(req.url).searchParams.get('run');
  if (!runId) {
    return new NextResponse(briefingTwiml('Sorry, this briefing is no longer available.'), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
  let authToken: string;
  try {
    authToken = twilioConfig().authToken;
  } catch {
    return new NextResponse(briefingTwiml('Sorry, phone calls are not configured.'), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
  const form = await req.formData().catch(() => null);
  const params: Record<string, string> = {};
  form?.forEach((value, key) => {
    if (typeof value === 'string') params[key] = value;
  });
  const valid = validateTwilioSignature({
    url: req.url.split('?')[0] + `?run=${encodeURIComponent(runId)}`,
    params,
    signature: req.headers.get('x-twilio-signature'),
    authToken,
  });
  if (!valid) {
    return new NextResponse('Forbidden.', { status: 403 });
  }
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.scheduledRuns)
    .where(eq(schema.scheduledRuns.id, runId))
    .limit(1);
  const script =
    rows[0]?.outputSummary?.trim() ||
    'Sorry, this briefing is no longer available.';
  return new NextResponse(briefingTwiml(script), {
    headers: { 'Content-Type': 'text/xml' },
  });
}
