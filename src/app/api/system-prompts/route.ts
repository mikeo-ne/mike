import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { asc, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createPromptSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(20000),
  isDefault: z.boolean().optional(),
});

export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db } = await getDb();
  const prompts = await db
    .select()
    .from(schema.systemPrompts)
    .where(
      or(
        isNull(schema.systemPrompts.profileId),
        eq(schema.systemPrompts.profileId, profileId),
      ),
    )
    .orderBy(desc(schema.systemPrompts.isDefault), asc(schema.systemPrompts.name));
  const res = NextResponse.json({ prompts });
  applyProfileCookie(res.headers, setCookie);
  return res;
}

export async function POST(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = createPromptSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { db } = await getDb();
  if (parsed.data.isDefault) {
    await db
      .update(schema.systemPrompts)
      .set({ isDefault: false, updatedAt: new Date() });
  }
  const [prompt] = await db
    .insert(schema.systemPrompts)
    .values({
      id: randomUUID(),
      profileId,
      name: parsed.data.name,
      content: parsed.data.content,
      isDefault: parsed.data.isDefault ?? false,
    })
    .returning();
  const res = NextResponse.json({ prompt }, { status: 201 });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
