import { NextResponse } from 'next/server';
import '@/lib/tools';
import { executeTool } from '@/lib/tools';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { getProfileTimezone } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** REST façade over get_daily_agenda — powers Mike's Dashboard. */
export async function GET(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  const url = new URL(req.url);
  const args: Record<string, string> = {};
  for (const key of ['calendar', 'date', 'timezone']) {
    const v = url.searchParams.get(key);
    if (v !== null && v !== '') args[key] = v;
  }
  try {
    const timezone = await getProfileTimezone(profileId);
    const result = await executeTool('get_daily_agenda', args, {
      profileId,
      timezone,
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
