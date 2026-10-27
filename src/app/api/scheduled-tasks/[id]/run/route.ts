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
  // Always 200 with the run payload: the run object itself carries
  // status/error, so the UI shows the real reason instead of a bare 502.
  try {
    const result = await runScheduledTask(params.id);
    const res = NextResponse.json({ run: result });
    applyProfileCookie(res.headers, setCookie);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Run failed.';
    const res = NextResponse.json({
      run: {
        taskId: params.id,
        taskName: '',
        runId: '',
        status: 'error',
        briefId: null,
        callSid: null,
        telegramMessageId: null,
        summary: null,
        error: message,
      },
    });
    applyProfileCookie(res.headers, setCookie);
    return res;
  }
}
