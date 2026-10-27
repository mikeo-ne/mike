import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { TASK_PRIORITIES, createTask, listTasks } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  due_at: z.string().trim().max(64).optional(),
});

export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const url = new URL(req.url);
  const status = url.searchParams.get('status')?.trim() || undefined;
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
  try {
    const result = await listTasks(profileId, { status, limit });
    const res = NextResponse.json(result);
    applyProfileCookie(res.headers, setCookie);
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Request failed.' },
      { status: 400 },
    );
  }
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
  try {
    const result = await createTask(profileId, parsed.data);
    const res = NextResponse.json(result, { status: 201 });
    applyProfileCookie(res.headers, setCookie);
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Request failed.' },
      { status: 400 },
    );
  }
}
