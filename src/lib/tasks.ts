/**
 * Task store shared by the REST API and the manage_tasks tool.
 * Server-only.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';

export const TASK_STATUSES = ['open', 'in_progress', 'done'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskDto {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toTaskDto(t: typeof schema.tasks.$inferSelect): TaskDto {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
    due_at: t.dueAt ? t.dueAt.toISOString() : null,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

function assertStatus(value: unknown): asserts value is TaskStatus {
  if (!TASK_STATUSES.includes(value as TaskStatus)) {
    throw new Error(
      `Invalid status "${String(value)}". Use one of: ${TASK_STATUSES.join(', ')}.`,
    );
  }
}

function assertPriority(value: unknown): asserts value is TaskPriority {
  if (!TASK_PRIORITIES.includes(value as TaskPriority)) {
    throw new Error(
      `Invalid priority "${String(value)}". Use one of: ${TASK_PRIORITIES.join(', ')}.`,
    );
  }
}

function parseDueAt(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid due_at "${value}". Use ISO 8601.`);
  }
  return d;
}

export async function listTasks(
  profileId: string,
  opts?: { status?: string; limit?: number },
): Promise<{ tasks: TaskDto[]; count: number }> {
  if (opts?.status) assertStatus(opts.status);
  const { db } = await getDb();
  const conditions = [eq(schema.tasks.profileId, profileId)];
  if (opts?.status) {
    conditions.push(eq(schema.tasks.status, opts.status));
  }
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(and(...conditions))
    .orderBy(asc(schema.tasks.dueAt), desc(schema.tasks.createdAt))
    .limit(Math.min(Math.max(opts?.limit ?? 50, 1), 100));
  // Open tasks first, then in-progress, then done (stable secondary order kept).
  const rank = (s: string) =>
    s === 'open' ? 0 : s === 'in_progress' ? 1 : 2;
  rows.sort((a, b) => rank(a.status) - rank(b.status));
  return { tasks: rows.map(toTaskDto), count: rows.length };
}

export async function createTask(
  profileId: string,
  input: { title: string; notes?: string; priority?: string; due_at?: string },
): Promise<{ task: TaskDto }> {
  if (input.priority !== undefined) assertPriority(input.priority);
  const { db } = await getDb();
  const [row] = await db
    .insert(schema.tasks)
    .values({
      id: randomUUID(),
      profileId,
      title: input.title,
      notes: input.notes ?? null,
      status: 'open',
      priority: input.priority ?? 'medium',
      dueAt: input.due_at ? parseDueAt(input.due_at) : null,
    })
    .returning();
  return { task: toTaskDto(row) };
}

export async function updateTask(
  profileId: string,
  id: string,
  patch: {
    title?: string;
    notes?: string | null;
    status?: string;
    priority?: string;
    due_at?: string | null;
  },
): Promise<{ task: TaskDto }> {
  if (patch.status !== undefined) assertStatus(patch.status);
  if (patch.priority !== undefined) assertPriority(patch.priority);
  const { db } = await getDb();
  const existing = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.profileId, profileId)))
    .limit(1);
  if (existing.length === 0) {
    throw new Error(`No task found with id "${id}".`);
  }
  const [row] = await db
    .update(schema.tasks)
    .set({
      title: patch.title ?? existing[0].title,
      notes: patch.notes !== undefined ? patch.notes : existing[0].notes,
      status: patch.status ?? existing[0].status,
      priority: patch.priority ?? existing[0].priority,
      dueAt:
        patch.due_at === undefined
          ? existing[0].dueAt
          : patch.due_at === null
            ? null
            : parseDueAt(patch.due_at),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.profileId, profileId)))
    .returning();
  return { task: toTaskDto(row) };
}

export async function deleteTask(
  profileId: string,
  id: string,
): Promise<{ deleted: boolean; id: string }> {
  const { db } = await getDb();
  const deleted = await db
    .delete(schema.tasks)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.profileId, profileId)))
    .returning({ id: schema.tasks.id });
  if (deleted.length === 0) {
    throw new Error(`No task found with id "${id}".`);
  }
  return { deleted: true, id };
}
