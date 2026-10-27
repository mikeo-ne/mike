import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import '@/lib/tools';
import { executeTool, getTool } from '@/lib/tools';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const executeSchema = z.object({
  args: z.record(z.unknown()).optional().default({}),
  sessionId: z.string().uuid().optional(),
});

/**
 * Generic tool-execution endpoint: POST /api/tools/<name> { args, sessionId? }
 * External systems (or future agents) can invoke any registered tool through
 * this single audited gateway.
 */
export async function POST(
  req: Request,
  { params }: { params: { name: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const tool = getTool(params.name);
  if (!tool) {
    return NextResponse.json(
      { error: `Unknown tool "${params.name}".` },
      { status: 404 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = executeSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  if (parsed.data.sessionId) {
    const { db } = await getDb();
    const rows = await db
      .select({ id: schema.chatSessions.id })
      .from(schema.chatSessions)
      .where(
        and(
          eq(schema.chatSessions.id, parsed.data.sessionId),
          eq(schema.chatSessions.profileId, profileId),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Session not found.' },
        { status: 404 },
      );
    }
  }
  try {
    const result = await executeTool(params.name, parsed.data.args ?? {}, {
      profileId,
      sessionId: parsed.data.sessionId,
    });
    const res = NextResponse.json({ tool: params.name, result });
    applyProfileCookie(res.headers, setCookie);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution failed.';
    const status = message.startsWith('Invalid arguments') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
