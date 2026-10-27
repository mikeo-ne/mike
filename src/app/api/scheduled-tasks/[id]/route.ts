import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchTaskSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().trim().max(8000).optional(),
  delivery: z
    .array(z.enum(['hub', 'call']))
    .min(1)
    .max(2)
    .refine((d) => d.includes('hub'), {
      message: 'Delivery must include "hub".',
    })
    .optional(),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^\+?[0-9 ()-]*$/, 'Phone must look like +256700000000.')
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
});

function dto(row: typeof schema.scheduledTasks.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    delivery: Array.isArray(row.delivery) ? row.delivery : ['hub'],
    phone: row.phone,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    lastStatus: row.lastStatus,
    runCount: row.runCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function runDto(row: typeof schema.scheduledRuns.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    briefId: row.briefId,
    callSid: row.callSid,
    callStatus: row.callStatus,
    outputSummary: row.outputSummary,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

async function findTask(profileId: string, id: string) {
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.scheduledTasks)
    .where(
      and(
        eq(schema.scheduledTasks.id, id),
        eq(schema.scheduledTasks.profileId, profileId),
      ),
    )
    .limit(1);
  return { db, task: rows[0] ?? null };
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db, task } = await findTask(profileId, params.id);
  if (!task) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  const runs = await db
    .select()
    .from(schema.scheduledRuns)
    .where(eq(schema.scheduledRuns.taskId, task.id))
    .orderBy(desc(schema.scheduledRuns.startedAt))
    .limit(10);
  const res = NextResponse.json({ task: dto(task), runs: runs.map(runDto) });
  applyProfileCookie(res.headers, setCookie);
  return res;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db, task } = await findTask(profileId, params.id);
  if (!task) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = patchTaskSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const patch: Partial<typeof schema.scheduledTasks.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.instructions !== undefined) {
    patch.instructions = parsed.data.instructions;
  }
  if (parsed.data.delivery !== undefined) {
    patch.delivery = [...new Set(parsed.data.delivery)];
  }
  if (parsed.data.phone !== undefined) {
    patch.phone = parsed.data.phone?.trim() || null;
  }
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  await db
    .update(schema.scheduledTasks)
    .set(patch)
    .where(eq(schema.scheduledTasks.id, task.id));
  const [row] = await db
    .select()
    .from(schema.scheduledTasks)
    .where(eq(schema.scheduledTasks.id, task.id))
    .limit(1);
  const res = NextResponse.json({ task: row ? dto(row) : null });
  applyProfileCookie(res.headers, setCookie);
  return res;
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db, task } = await findTask(profileId, params.id);
  if (!task) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }
  await db
    .delete(schema.scheduledTasks)
    .where(eq(schema.scheduledTasks.id, task.id));
  const res = NextResponse.json({ ok: true });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
