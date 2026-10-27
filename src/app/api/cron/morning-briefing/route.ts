import { NextResponse } from 'next/server';
import { runDueTasks } from '@/lib/clockwork/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Vercel Cron entrypoint (see vercel.json): runs every enabled Clockwork task
 * that hasn't run in the last ~20h. Secured by CRON_SECRET — Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get('authorization')?.trim();
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const started = Date.now();
  const results = await runDueTasks();
  return NextResponse.json({
    ok: true,
    ran: results.length,
    durationMs: Date.now() - started,
    results: results.map((r) => ({
      taskId: r.taskId,
      taskName: r.taskName,
      status: r.status,
      briefId: r.briefId,
      callSid: r.callSid,
      error: r.error,
    })),
  });
}
