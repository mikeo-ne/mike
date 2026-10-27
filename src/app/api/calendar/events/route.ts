import { NextResponse } from 'next/server';
import '@/lib/tools';
import { executeTool } from '@/lib/tools';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * REST façade over the calendar tools — the same validated, profile-scoped,
 * audited code path the agent uses. This is what the UI calendar panel calls.
 */
export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const url = new URL(req.url);
  const args: Record<string, string> = {};
  for (const key of ['from', 'to', 'query', 'limit', 'calendar']) {
    const v = url.searchParams.get(key);
    if (v !== null && v !== '') args[key] = v;
  }
  try {
    const result = await executeTool('list_calendar_events', args, {
      profileId,
    });
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
  try {
    const result = await executeTool('create_calendar_event', body, {
      profileId,
    });
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
