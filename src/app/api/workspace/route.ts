import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { WORKSPACE_KINDS } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createWorkspaceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(WORKSPACE_KINDS).optional().default('note'),
  content: z.string().max(50000).optional().default(''),
});

export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const url = new URL(req.url);
  const query = url.searchParams.get('query')?.trim() || null;
  const kind = url.searchParams.get('kind')?.trim() || null;
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1),
    100,
  );
  if (kind && !(WORKSPACE_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json(
      { error: `Invalid kind "${kind}". Use: ${WORKSPACE_KINDS.join(', ')}.` },
      { status: 400 },
    );
  }
  const { db } = await getDb();
  const conditions = [eq(schema.workspaceContext.profileId, profileId)];
  if (kind) conditions.push(eq(schema.workspaceContext.kind, kind));
  if (query) {
    const q = `%${query}%`;
    conditions.push(
      or(
        ilike(schema.workspaceContext.title, q),
        ilike(schema.workspaceContext.content, q),
      )!,
    );
  }
  const items = await db
    .select()
    .from(schema.workspaceContext)
    .where(and(...conditions))
    .orderBy(desc(schema.workspaceContext.updatedAt))
    .limit(limit);
  const res = NextResponse.json({ items, count: items.length });
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
  const parsed = createWorkspaceSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { db } = await getDb();
  const [item] = await db
    .insert(schema.workspaceContext)
    .values({
      id: randomUUID(),
      profileId,
      title: parsed.data.title,
      kind: parsed.data.kind,
      content: parsed.data.content ?? '',
    })
    .returning();
  const res = NextResponse.json({ item }, { status: 201 });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
