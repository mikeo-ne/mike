import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  deleteTask,
  updateTask,
} from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  due_at: z.string().trim().max(64).nullable().optional(),
});

function statusFor(message: string): number {
  return message.startsWith('No task found') ? 404 : 400;
}

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
  const parsed = patchTaskSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  try {
    const result = await updateTask(profileId, params.id, {
      title: parsed.data.title,
      notes: parsed.data.notes ?? undefined,
      status: parsed.data.status,
      priority: parsed.data.priority,
      due_at:
        parsed.data.due_at === null ? null : (parsed.data.due_at ?? undefined),
    });
    const res = NextResponse.json(result);
    applyProfileCookie(res.headers, setCookie);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed.';
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  try {
    const result = await deleteTask(profileId, params.id);
    const res = NextResponse.json(result);
    applyProfileCookie(res.headers, setCookie);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed.';
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
