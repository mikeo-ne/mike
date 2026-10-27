import { NextResponse } from 'next/server';
import '@/lib/tools';
import { executeTool } from '@/lib/tools';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  try {
    const result = await executeTool(
      'update_calendar_event',
      { ...((body ?? {}) as Record<string, unknown>), id: params.id },
      { profileId },
    );
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

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  try {
    const result = await executeTool(
      'delete_calendar_event',
      { id: params.id },
      { profileId },
    );
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
