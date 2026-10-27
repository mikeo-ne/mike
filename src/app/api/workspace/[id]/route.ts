import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { WORKSPACE_KINDS } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchWorkspaceSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(WORKSPACE_KINDS).optional(),
  content: z.string().max(50000).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = patchWorkspaceSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { db } = await getDb();
  const updated = await db
    .update(schema.workspaceContext)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(schema.workspaceContext.id, params.id),
        eq(schema.workspaceContext.profileId, profileId),
      ),
    )
    .returning();
  if (updated.length === 0) {
    return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });
  }
  const res = NextResponse.json({ item: updated[0] });
  applyProfileCookie(res.headers, setCookie);
  return res;
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db } = await getDb();
  const deleted = await db
    .delete(schema.workspaceContext)
    .where(
      and(
        eq(schema.workspaceContext.id, params.id),
        eq(schema.workspaceContext.profileId, profileId),
      ),
    )
    .returning({ id: schema.workspaceContext.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });
  }
  const res = NextResponse.json({ deleted: true });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
