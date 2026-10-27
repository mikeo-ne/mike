import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { normalizeProvider } from '@/lib/ai/config';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSessionSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  systemPromptId: z.string().uuid().nullable().optional(),
  provider: z.enum(['openai', 'anthropic']).optional(),
  model: z.string().trim().max(100).nullable().optional(),
});

async function ownedSession(profileId: string, id: string) {
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.chatSessions)
    .where(
      and(
        eq(schema.chatSessions.id, id),
        eq(schema.chatSessions.profileId, profileId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const session = await ownedSession(profileId, params.id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }
  const { db } = await getDb();
  const messages = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.sessionId, session.id))
    .orderBy(asc(schema.conversations.createdAt));
  const res = NextResponse.json({ session, messages });
  applyProfileCookie(res.headers, setCookie);
  return res;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const session = await ownedSession(profileId, params.id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = patchSessionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { db } = await getDb();
  const [updated] = await db
    .update(schema.chatSessions)
    .set({
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.systemPromptId !== undefined
        ? { systemPromptId: parsed.data.systemPromptId }
        : {}),
      ...(parsed.data.provider !== undefined
        ? { provider: normalizeProvider(parsed.data.provider) }
        : {}),
      ...(parsed.data.model !== undefined
        ? { model: parsed.data.model?.trim() ? parsed.data.model.trim() : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.chatSessions.id, session.id))
    .returning();
  const res = NextResponse.json({ session: updated });
  applyProfileCookie(res.headers, setCookie);
  return res;
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const session = await ownedSession(profileId, params.id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }
  const { db } = await getDb();
  await db
    .delete(schema.chatSessions)
    .where(eq(schema.chatSessions.id, session.id));
  const res = NextResponse.json({ deleted: true });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
