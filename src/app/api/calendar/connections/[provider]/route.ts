import { NextResponse } from 'next/server';
import {
  GOOGLE_PROVIDER,
  revokeAndDeleteConnection,
} from '@/lib/calendar/google';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Disconnects an external calendar (revokes at the provider, deletes tokens). */
export async function DELETE(
  req: Request,
  { params }: { params: { provider: string } },
) {
  const { profileId, setCookie } = resolveProfile(req);
  if (params.provider !== GOOGLE_PROVIDER) {
    return NextResponse.json(
      { error: `Unknown provider "${params.provider}".` },
      { status: 404 },
    );
  }
  const deleted = await revokeAndDeleteConnection(profileId);
  if (!deleted) {
    return NextResponse.json(
      { error: 'No Google Calendar connection found.' },
      { status: 404 },
    );
  }
  const res = NextResponse.json({ deleted: true });
  applyProfileCookie(res.headers, setCookie);
  return res;
}
