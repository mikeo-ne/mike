import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forwardCalendarPayload } from '@/lib/calendar/webhook';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const relaySchema = z.object({
  action: z.enum([
    'created',
    'updated',
    'rescheduled',
    'deleted',
    'cancelled',
    'test',
  ]),
  calendar: z.enum(['local', 'google']).optional().default('local'),
  event: z.record(z.unknown()),
  conflicts: z.array(z.record(z.unknown())).optional(),
  note: z.string().max(500).optional(),
});

/**
 * Extensible calendar-payload relay: validates any calendar JSON and passes
 * it to CALENDAR_WEBHOOK_URL (Cal.com, Make.com, or a custom webhook).
 * Without a configured URL it runs in mock mode and echoes the payload.
 */
export async function POST(req: Request) {
  const { setCookie } = resolveProfile(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = relaySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const result = await forwardCalendarPayload({
    action: parsed.data.action,
    calendar: parsed.data.calendar ?? 'local',
    event: parsed.data.event,
    conflicts: parsed.data.conflicts,
    note: parsed.data.note,
  });
  const res = NextResponse.json(result);
  applyProfileCookie(res.headers, setCookie);
  return res;
}

/** Relay status (never exposes the configured URL or secrets). */
export async function GET(req: Request) {
  const { setCookie } = resolveProfile(req);
  const configured = !!process.env.CALENDAR_WEBHOOK_URL?.trim();
  const res = NextResponse.json({
    configured,
    mode: configured ? 'live' : 'mock',
  });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
