import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { isValidTimezone } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSettingsSchema = z.object({
  timezone: z.string().trim().max(64).nullable(),
});

export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.profileSettings)
    .where(eq(schema.profileSettings.profileId, profileId))
    .limit(1);
  const res = NextResponse.json({
    settings: {
      timezone: rows[0]?.timezone ?? null,
      updatedAt: rows[0]?.updatedAt ?? null,
    },
  });
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
  const timezone = parsed.data.timezone?.trim() || null;
  if (timezone && !isValidTimezone(timezone)) {
    return NextResponse.json(
      {
        error: `Unknown timezone "${timezone}". Use an IANA name like "Africa/Kampala".`,
      },
      { status: 400 },
    );
  }
  const { db } = await getDb();
  const existing = await db
    .select({ profileId: schema.profileSettings.profileId })
    .from(schema.profileSettings)
    .where(eq(schema.profileSettings.profileId, profileId))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.profileSettings).values({ profileId, timezone });
  } else {
    await db
      .update(schema.profileSettings)
      .set({ timezone, updatedAt: new Date() })
      .where(eq(schema.profileSettings.profileId, profileId));
  }
  const res = NextResponse.json({ settings: { timezone } });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
