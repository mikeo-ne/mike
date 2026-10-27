/**
 * Client-safe API helpers (no secrets, no server imports).
 */
export interface SessionSummary {
  id: string;
  title: string;
  systemPromptId: string | null;
  provider: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DbMessageRow {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }> | null;
  toolName: string | null;
  toolCallId: string | null;
  createdAt: string;
}

export interface SystemPromptDto {
  id: string;
  profileId: string | null;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventDto {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}

export interface CalendarConnectionDto {
  provider: string;
  email: string | null;
  connectedAt: string;
  needsReconnect: boolean;
}

export interface HealthDto {
  ok: boolean;
  provider: 'openai' | 'anthropic';
  model: string;
  demoMode: boolean;
  database: 'postgres' | 'pglite';
  time: string;
}

export interface SettingsDto {
  timezone: string | null;
  updatedAt?: string | null;
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
  } & Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : `Request failed (${res.status})`,
    );
  }
  return data as T;
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  health: () => fetch('/api/health').then(parse<HealthDto>),

  listSessions: () =>
    fetch('/api/sessions')
      .then(parse<{ sessions: SessionSummary[] }>)
      .then((r) => r.sessions),
  getSession: (id: string) =>
    fetch(`/api/sessions/${id}`).then(
      parse<{ session: SessionSummary; messages: DbMessageRow[] }>,
    ),
  patchSession: (id: string, patch: Partial<SessionSummary>) =>
    fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(parse<{ session: SessionSummary }>),
  deleteSession: (id: string) =>
    fetch(`/api/sessions/${id}`, { method: 'DELETE' }).then(
      parse<{ deleted: boolean }>,
    ),

  listPrompts: () =>
    fetch('/api/system-prompts')
      .then(parse<{ prompts: SystemPromptDto[] }>)
      .then((r) => r.prompts),
  createPrompt: (input: { name: string; content: string; isDefault?: boolean }) =>
    fetch('/api/system-prompts', json(input)).then(
      parse<{ prompt: SystemPromptDto }>,
    ),
  patchPrompt: (
    id: string,
    patch: { name?: string; content?: string; isDefault?: boolean },
  ) =>
    fetch(`/api/system-prompts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(parse<{ prompt: SystemPromptDto }>),
  deletePrompt: (id: string) =>
    fetch(`/api/system-prompts/${id}`, { method: 'DELETE' }).then(
      parse<{ deleted: boolean }>,
    ),

  listEvents: (params?: { from?: string; to?: string; query?: string; limit?: number; calendar?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.query) q.set('query', params.query);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.calendar) q.set('calendar', params.calendar);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return fetch(`/api/calendar/events${suffix}`).then(
      parse<{ events: CalendarEventDto[]; count: number }>,
    );
  },
  createEvent: (input: {
    title: string;
    starts_at: string;
    ends_at?: string;
    description?: string;
    location?: string;
    all_day?: boolean;
  }) =>
    fetch('/api/calendar/events', json(input)).then(
      parse<{ event: CalendarEventDto }>,
    ),
  deleteEvent: (id: string) =>
    fetch(`/api/calendar/events/${id}`, { method: 'DELETE' }).then(
      parse<{ deleted: boolean }>,
    ),

  listConnections: () =>
    fetch('/api/calendar/connections')
      .then(parse<{ connections: CalendarConnectionDto[] }>)
      .then((r) => r.connections),
  disconnectConnection: (providerName: string) =>
    fetch(`/api/calendar/connections/${providerName}`, {
      method: 'DELETE',
    }).then(parse<{ deleted: boolean }>),

  getSettings: () =>
    fetch('/api/settings')
      .then(parse<{ settings: SettingsDto }>)
      .then((r) => r.settings),
  patchSettings: (patch: { timezone: string | null }) =>
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(parse<{ settings: SettingsDto }>),
};
