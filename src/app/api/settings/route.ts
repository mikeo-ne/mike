import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { isValidTimezone } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const patchSettingsSchema = z.object({
  timezone: z.string().trim().max(64).nullable().optional(),
  schedulingRules: z.string().trim().max(5000).nullable().optional(),
  systemInstructions: z.string().trim().max(20000).nullable().optional(),
  workdayStart: z.string().trim().max(5).nullable().optional(),
  workdayEnd: z.string().trim().max(5).nullable().optional(),
  preferredCalendar: z.enum(['local', 'google']).optional(),
  agentName: z.string().trim().max(40).nullable().optional(),
  disabledTools: z.array(z.string().trim().min(1).max(64)).max(60).optional(),
});

function clean(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const t = value.trim();
  return t ? t : null;
}

function settingsDto(row: typeof schema.userPreferences.$inferSelect | undefined) {
  return {
    timezone: row?.timezone ?? null,
    schedulingRules: row?.schedulingRules ?? null,
    systemInstructions: row?.systemInstructions ?? null,
    workdayStart: row?.workdayStart ?? null,
    workdayEnd: row?.workdayEnd ?? null,
    preferredCalendar: row?.preferredCalendar ?? 'local',
    agentName: row?.agentName ?? null,
    disabledTools: Array.isArray(row?.disabledTools)
      ? (row?.disabledTools as string[]).filter((t) => typeof t === 'string')
      : [],
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.profileId, profileId))
    .limit(1);
  const res = NextResponse.json({ settings: settingsDto(rows[0]) });
  applyProfileCookie(res.headers, setCookie);
  return res;
}

export async function PATCH(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = patchSettingsSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const timezone = clean(parsed.data.timezone);
  if (timezone && !isValidTimezone(timezone)) {
    return NextResponse.json(
      {
        error: `Unknown timezone "${timezone}". Use an IANA name like "Africa/Kampala".`,
      },
      { status: 400 },
    );
  }
  const workdayStart = clean(parsed.data.workdayStart);
  const workdayEnd = clean(parsed.data.workdayEnd);
  for (const [label, value] of [
    ['workdayStart', workdayStart],
    ['workdayEnd', workdayEnd],
  ] as const) {
    if (value && !HHMM.test(value)) {
      return NextResponse.json(
        { error: `${label} must be "HH:MM" (24-hour), e.g. "09:00".` },
        { status: 400 },
      );
    }
  }

  const { db } = await getDb();
  const patch: Record<string, string | string[] | null> = {};
  const schedulingRules = clean(parsed.data.schedulingRules);
  const systemInstructions = clean(parsed.data.systemInstructions);
  const agentName = clean(parsed.data.agentName);
  if (timezone !== undefined) patch.timezone = timezone;
  if (schedulingRules !== undefined) patch.schedulingRules = schedulingRules;
  if (systemInstructions !== undefined) patch.systemInstructions = systemInstructions;
  if (workdayStart !== undefined) patch.workdayStart = workdayStart;
  if (workdayEnd !== undefined) patch.workdayEnd = workdayEnd;
  if (parsed.data.preferredCalendar !== undefined) {
    patch.preferredCalendar = parsed.data.preferredCalendar;
  }
  if (agentName !== undefined) patch.agentName = agentName;
  if (parsed.data.disabledTools !== undefined) {
    patch.disabledTools = [...new Set(parsed.data.disabledTools)].slice(0, 60);
  }

  const existing = await db
    .select({ profileId: schema.userPreferences.profileId })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.profileId, profileId))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.userPreferences).values({ profileId, ...patch });
  } else if (Object.keys(patch).length > 0) {
    await db
      .update(schema.userPreferences)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.userPreferences.profileId, profileId));
  }
  const [row] = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.profileId, profileId))
    .limit(1);
  const res = NextResponse.json({ settings: settingsDto(row) });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
