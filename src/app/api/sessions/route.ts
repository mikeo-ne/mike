import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { normalizeProvider } from '@/lib/ai/config';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  systemPromptId: z.string().uuid().nullable().optional(),
  provider: z.enum(['openai', 'anthropic']).optional(),
  model: z.string().trim().max(100).optional(),
});

export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db } = await getDb();
  const sessions = await db
    .select({
      id: schema.chatSessions.id,
      title: schema.chatSessions.title,
      systemPromptId: schema.chatSessions.systemPromptId,
      provider: schema.chatSessions.provider,
      model: schema.chatSessions.model,
      createdAt: schema.chatSessions.createdAt,
      updatedAt: schema.chatSessions.updatedAt,
    })
    .from(schema.chatSessions)
    .where(eq(schema.chatSessions.profileId, profileId))
    .orderBy(desc(schema.chatSessions.updatedAt))
    .limit(50);
  const res = NextResponse.json({ sessions });
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
  const parsed = createSessionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const { db } = await getDb();
  if (parsed.data.systemPromptId) {
    const found = await db
      .select({ id: schema.systemPrompts.id })
      .from(schema.systemPrompts)
      .where(
        and(
          eq(schema.systemPrompts.id, parsed.data.systemPromptId),
          or(
            isNull(schema.systemPrompts.profileId),
            eq(schema.systemPrompts.profileId, profileId),
          ),
        ),
      )
      .limit(1);
    if (found.length === 0) {
      return NextResponse.json(
        { error: 'System prompt not found.' },
        { status: 404 },
      );
    }
  }

  const [session] = await db
    .insert(schema.chatSessions)
    .values({
      id: randomUUID(),
      profileId,
      title: parsed.data.title?.trim() || 'New conversation',
      systemPromptId: parsed.data.systemPromptId ?? null,
      provider: normalizeProvider(parsed.data.provider),
      model: parsed.data.model?.trim() || null,
    })
    .returning();
  const res = NextResponse.json({ session }, { status: 201 });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
