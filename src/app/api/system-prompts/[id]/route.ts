import { NextResponse } from 'next/server';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchPromptSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
  isDefault: z.boolean().optional(),
});

async function visiblePrompt(profileId: string, id: string) {
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.systemPrompts)
    .where(
      and(
        eq(schema.systemPrompts.id, id),
        or(
          isNull(schema.systemPrompts.profileId),
          eq(schema.systemPrompts.profileId, profileId),
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const prompt = await visiblePrompt(profileId, params.id);
  if (!prompt) {
    return NextResponse.json({ error: 'Prompt not found.' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = patchPromptSchema.safeParse(body ?? {});
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
  const [updated] = await db
    .update(schema.systemPrompts)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.content !== undefined
        ? { content: parsed.data.content }
        : {}),
      ...(parsed.data.isDefault !== undefined
        ? { isDefault: parsed.data.isDefault }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.systemPrompts.id, prompt.id))
    .returning();
  const res = NextResponse.json({ prompt: updated });
  applyProfileCookie(res.headers, setCookie);
  return res;
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const prompt = await visiblePrompt(profileId, params.id);
  if (!prompt) {
    return NextResponse.json({ error: 'Prompt not found.' }, { status: 404 });
  }
  const { db } = await getDb();
  await db
    .delete(schema.systemPrompts)
    .where(eq(schema.systemPrompts.id, prompt.id));
  // Keep a default selection valid: promote the oldest remaining prompt.
  if (prompt.isDefault) {
    const remaining = await db
      .select({ id: schema.systemPrompts.id })
      .from(schema.systemPrompts)
      .orderBy(asc(schema.systemPrompts.createdAt))
      .limit(1);
    if (remaining.length > 0) {
      await db
        .update(schema.systemPrompts)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(schema.systemPrompts.id, remaining[0].id));
    }
  }
  const res = NextResponse.json({ deleted: true });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
