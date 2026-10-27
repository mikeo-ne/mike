/**
 * Google Calendar integration (server-only, raw REST — no extra deps).
 *
 * - OAuth credentials from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
 * - Tokens stored AES-256-GCM encrypted in `calendar_connections`,
 *   refreshed automatically when expiring.
 * - CRUD maps Google events to the same DTO shape as the local tools.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { decryptSecret, encryptSecret } from '@/lib/crypto';

export const GOOGLE_PROVIDER = 'google';
/** Least-privilege scopes: identity + read/write events (not full calendar). */
export const GOOGLE_CALENDAR_SCOPE =
  'openid email https://www.googleapis.com/auth/calendar.events';

export const NOT_CONNECTED_MESSAGE =
  'Google Calendar is not connected for this profile. Ask the user to connect it in Settings → Connections.';

export function googleClientCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in secrets.',
    );
  }
  return { clientId, clientSecret };
}

export function googleRedirectUri(requestOrigin?: string): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (appUrl) return `${appUrl}/api/calendar/google/callback`;
  if (requestOrigin) return `${requestOrigin}/api/calendar/google/callback`;
  throw new Error(
    'Cannot determine the Google OAuth redirect URI. Set GOOGLE_REDIRECT_URI or APP_URL.',
  );
}

// ------------------------------------------------------------------ tokens --
async function loadConnection(profileId: string) {
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.calendarConnections)
    .where(
      and(
        eq(schema.calendarConnections.profileId, profileId),
        eq(schema.calendarConnections.provider, GOOGLE_PROVIDER),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getGoogleConnectionStatus(profileId: string): Promise<{
  provider: string;
  email: string | null;
  connectedAt: Date;
  needsReconnect: boolean;
} | null> {
  const row = await loadConnection(profileId);
  if (!row) return null;
  const expired =
    !!row.expiresAt && row.expiresAt.getTime() < Date.now() - 60_000;
  return {
    provider: GOOGLE_PROVIDER,
    email: row.email,
    connectedAt: row.createdAt,
    needsReconnect: expired && !row.refreshToken,
  };
}

export async function saveGoogleConnection(
  profileId: string,
  tokens: {
    access_token: string;
    refresh_token?: string | null;
    expires_in?: number | null;
    email?: string | null;
  },
): Promise<void> {
  const { db } = await getDb();
  const existing = await loadConnection(profileId);
  const values = {
    email: tokens.email ?? existing?.email ?? null,
    accessToken: encryptSecret(tokens.access_token),
    refreshToken: tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : (existing?.refreshToken ?? null),
    expiresAt:
      typeof tokens.expires_in === 'number'
        ? new Date(Date.now() + Math.max(tokens.expires_in - 30, 60) * 1000)
        : (existing?.expiresAt ?? null),
    scope: GOOGLE_CALENDAR_SCOPE,
    updatedAt: new Date(),
  };
  if (existing) {
    await db
      .update(schema.calendarConnections)
      .set(values)
      .where(eq(schema.calendarConnections.id, existing.id));
  } else {
    await db.insert(schema.calendarConnections).values({
      id: randomUUID(),
      profileId,
      provider: GOOGLE_PROVIDER,
      ...values,
    });
  }
}

async function getAccessToken(profileId: string): Promise<string> {
  const row = await loadConnection(profileId);
  if (!row) throw new Error(NOT_CONNECTED_MESSAGE);
  const fresh =
    row.expiresAt && row.expiresAt.getTime() - Date.now() > 60_000;
  const accessToken = decryptSecret(row.accessToken);
  if (fresh) return accessToken;
  if (!row.refreshToken) {
    throw new Error(
      'Google session expired — please disconnect and reconnect Google Calendar in Settings.',
    );
  }
  const { clientId, clientSecret } = googleClientCredentials();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptSecret(row.refreshToken),
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google token refresh failed (${data.error_description || data.error || res.status}) — please disconnect and reconnect Google Calendar in Settings.`,
    );
  }
  await saveGoogleConnection(profileId, {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in ?? null,
  });
  return data.access_token;
}

export async function revokeAndDeleteConnection(
  profileId: string,
): Promise<boolean> {
  const row = await loadConnection(profileId);
  if (!row) return false;
  try {
    const token = decryptSecret(row.accessToken);
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
      { method: 'POST' },
    );
  } catch {
    /* best-effort: still delete locally */
  }
  const { db } = await getDb();
  await db
    .delete(schema.calendarConnections)
    .where(eq(schema.calendarConnections.id, row.id));
  return true;
}

// ------------------------------------------------------------------ client --
interface GoogleApiInit {
  method?: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function googleApi(profileId: string, path: string, init?: GoogleApiInit): Promise<any> {
  const token = await getAccessToken(profileId);
  const url = new URL(`https://www.googleapis.com${path}`);
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const detail =
      data?.error?.message || `Google API error (${res.status})`;
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Google Calendar authorization failed: ${detail} — try disconnecting and reconnecting in Settings.`,
      );
    }
    throw new Error(detail);
  }
  return data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGoogleEvent(item: any) {
  const allDay = !!item.start?.date;
  return {
    id: item.id as string,
    title: (item.summary as string | undefined) ?? '(no title)',
    description: (item.description as string | undefined) ?? null,
    location: (item.location as string | undefined) ?? null,
    starts_at: allDay
      ? `${item.start.date}T00:00:00Z`
      : ((item.start?.dateTime as string | undefined) ??
        new Date().toISOString()),
    ends_at: item.end?.dateTime
      ? (item.end.dateTime as string)
      : item.end?.date
        ? `${item.end.date}T00:00:00Z`
        : null,
    all_day: allDay,
  };
}

function overlaps(
  startsAt: string,
  endsAt: string | null,
  winStart: Date,
  winEnd: Date,
): boolean {
  const s = new Date(startsAt).getTime();
  const e = endsAt ? new Date(endsAt).getTime() : s + 3600_000;
  return s < winEnd.getTime() && e > winStart.getTime();
}

// -------------------------------------------------------------------- CRUD --
export async function listGoogleEvents(
  profileId: string,
  opts: { from?: string; to?: string; query?: string; limit?: number },
) {
  const query: Record<string, string> = {
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(opts.limit ?? 20),
  };
  if (opts.from) query.timeMin = opts.from;
  if (opts.to) query.timeMax = opts.to;
  if (opts.query) query.q = opts.query;
  const data = await googleApi(
    profileId,
    '/calendar/v3/calendars/primary/events',
    { query },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = ((data.items ?? []) as any[]).map(mapGoogleEvent);
  return { events, count: events.length };
}

export interface GoogleEventInput {
  title: string;
  starts_at: string;
  ends_at?: string;
  description?: string;
  location?: string;
  all_day?: boolean;
}

function googleEventBody(input: GoogleEventInput, timezone?: string | null) {
  const startsAt = new Date(input.starts_at);
  const endsAt = input.ends_at
    ? new Date(input.ends_at)
    : new Date(startsAt.getTime() + 3600_000);
  if (endsAt <= startsAt) throw new Error('ends_at must be after starts_at.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    summary: input.title,
    description: input.description,
    location: input.location,
  };
  if (input.all_day) {
    const s = input.starts_at.slice(0, 10);
    let e = input.ends_at ? input.ends_at.slice(0, 10) : '';
    if (!e || e <= s) {
      const d = new Date(`${s}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      e = d.toISOString().slice(0, 10);
    }
    body.start = { date: s };
    body.end = { date: e };
  } else {
    body.start = {
      dateTime: startsAt.toISOString(),
      ...(timezone ? { timeZone: timezone } : {}),
    };
    body.end = {
      dateTime: endsAt.toISOString(),
      ...(timezone ? { timeZone: timezone } : {}),
    };
  }
  return { body, startsAt, endsAt };
}

export async function createGoogleEvent(
  profileId: string,
  input: GoogleEventInput,
  timezone?: string | null,
) {
  const { body, startsAt, endsAt } = googleEventBody(input, timezone);
  let conflicts: ReturnType<typeof mapGoogleEvent>[] = [];
  try {
    const existing = await listGoogleEvents(profileId, {
      from: startsAt.toISOString(),
      to: endsAt.toISOString(),
      limit: 25,
    });
    conflicts = existing.events.filter((e) =>
      overlaps(e.starts_at, e.ends_at, startsAt, endsAt),
    );
  } catch {
    conflicts = [];
  }
  const created = await googleApi(
    profileId,
    '/calendar/v3/calendars/primary/events',
    { method: 'POST', body },
  );
  return {
    event: mapGoogleEvent(created),
    conflicts,
    conflicts_count: conflicts.length,
  };
}

export async function updateGoogleEvent(
  profileId: string,
  id: string,
  patch: Partial<GoogleEventInput>,
  timezone?: string | null,
) {
  const current = await googleApi(
    profileId,
    `/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`,
  );
  const merged: GoogleEventInput = {
    title: patch.title ?? current.summary ?? '(no title)',
    starts_at:
      patch.starts_at ?? current.start?.dateTime ?? current.start?.date
        ? (patch.starts_at ??
          current.start?.dateTime ??
          `${current.start.date}T00:00:00Z`)
        : new Date().toISOString(),
    ends_at:
      patch.ends_at ?? current.end?.dateTime ?? current.end?.date
        ? (patch.ends_at ??
          current.end?.dateTime ??
          `${current.end.date}T00:00:00Z`)
        : undefined,
    description: patch.description ?? current.description ?? undefined,
    location: patch.location ?? current.location ?? undefined,
    all_day: patch.all_day ?? !!current.start?.date,
  };
  const { body, startsAt, endsAt } = googleEventBody(merged, timezone);
  let conflicts: ReturnType<typeof mapGoogleEvent>[] = [];
  if (patch.starts_at || patch.ends_at) {
    try {
      const existing = await listGoogleEvents(profileId, {
        from: startsAt.toISOString(),
        to: endsAt.toISOString(),
        limit: 25,
      });
      conflicts = existing.events.filter(
        (e) => e.id !== id && overlaps(e.starts_at, e.ends_at, startsAt, endsAt),
      );
    } catch {
      conflicts = [];
    }
  }
  const updated = await googleApi(
    profileId,
    `/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`,
    { method: 'PATCH', body },
  );
  return {
    event: mapGoogleEvent(updated),
    conflicts,
    conflicts_count: conflicts.length,
  };
}

export async function deleteGoogleEvent(profileId: string, id: string) {
  try {
    await googleApi(
      profileId,
      `/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not.?found|deleted|404/i.test(message)) {
      throw new Error(`No Google Calendar event found with id "${id}".`);
    }
    throw err;
  }
  return { deleted: true, id };
}
