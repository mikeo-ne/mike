import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { runScheduledTask } from '@/lib/clockwork/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Manual "Run now" — executes the task immediately (even if paused). */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db } = await getDb();
  const rows = await db
    .select({ id: schema.scheduledTasks.id })
    .from(schema.scheduledTasks)
    .where(
      and(
        eq(schema.scheduledTasks.id, params.id),
        eq(schema.scheduledTasks.profileId, profileId),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  const result = await runScheduledTask(params.id);
  const res = NextResponse.json(
    { run: result },
    { status: result.status === 'ok' ? 200 : 502 },
  );
  applyProfileCookie(res.headers, setCookie);
  return res;
}
