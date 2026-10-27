import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const deliverySchema = z
  .array(z.enum(['hub', 'call', 'telegram']))
  .min(1)
  .max(3)
  .refine((d) => d.includes('hub'), {
    message: 'Delivery must include "hub".',
  });

const createTaskSchema = z.object({
  name: z.string().trim().min(1).max(80),
  instructions: z.string().trim().max(8000).optional().default(''),
  delivery: deliverySchema.optional().default(['hub']),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^\+?[0-9 ()-]*$/, 'Phone must look like +256700000000.')
    .nullable()
    .optional(),
  telegramChatId: z
    .string()
    .trim()
    .max(32)
    .regex(/^-?\d+$/, 'Telegram chat id must be numeric.')
    .nullable()
    .optional(),
  enabled: z.boolean().optional().default(true),
});

function dto(row: typeof schema.scheduledTasks.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    delivery: Array.isArray(row.delivery) ? row.delivery : ['hub'],
    phone: row.phone,
    telegramChatId: row.telegramChatId,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    lastStatus: row.lastStatus,
    runCount: row.runCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.scheduledTasks)
    .where(eq(schema.scheduledTasks.profileId, profileId))
    .orderBy(desc(schema.scheduledTasks.createdAt));
  const res = NextResponse.json({ tasks: rows.map(dto) });
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
  const parsed = createTaskSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { db } = await getDb();
  const id = randomUUID();
  await db.insert(schema.scheduledTasks).values({
    id,
    profileId,
    name: parsed.data.name,
    instructions: parsed.data.instructions,
    delivery: [...new Set(parsed.data.delivery)],
    phone: parsed.data.phone?.trim() || null,
    telegramChatId: parsed.data.telegramChatId?.trim() || null,
    enabled: parsed.data.enabled,
  });
  const [row] = await db
    .select()
    .from(schema.scheduledTasks)
    .where(eq(schema.scheduledTasks.id, id))
    .limit(1);
  const res = NextResponse.json({ task: row ? dto(row) : null }, { status: 201 });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
