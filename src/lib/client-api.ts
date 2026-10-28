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

export interface AgendaDto {
  date: string;
  timezone: string;
  calendar?: string;
  day_starts_at: string;
  day_ends_at: string;
  count: number;
  scheduled_minutes: number;
  events: CalendarEventDto[];
}

export interface WorkspaceItemDto {
  id: string;
  profileId: string;
  title: string;
  kind: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceKind =
  | 'note'
  | 'project'
  | 'guideline'
  | 'brief'
  | 'document';

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

export interface HealthDto {
  ok: boolean;
  provider: 'openai' | 'anthropic';
  model: string;
  demoMode: boolean;
  database: 'postgres' | 'pglite';
  time: string;
}

export interface PreferencesDto {
  timezone: string | null;
  schedulingRules: string | null;
  systemInstructions: string | null;
  workdayStart: string | null;
  workdayEnd: string | null;
  preferredCalendar: 'local' | 'google';
  agentName: string | null;
  disabledTools: string[];
  updatedAt?: string | null;
}

/** Backwards-compatible alias (settings == preferences). */
export type SettingsDto = PreferencesDto;

export interface ToolInfo {
  name: string;
  description: string;
}

export interface ScheduledTaskDto {
  id: string;
  name: string;
  instructions: string;
  delivery: string[];
  phone: string | null;
  telegramChatId: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledRunDto {
  id: string;
  status: string;
  briefId: string | null;
  callSid: string | null;
  callStatus: string | null;
  telegramMessageId: string | null;
  telegramStatus: string | null;
  outputSummary: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface CallsConfigDto {
  configured: boolean;
  fromNumber: string | null;
  defaultTo: string | null;
  telegram: {
    configured: boolean;
    defaultTo: string | null;
  };
}

export interface TaskRunDto {
  taskId: string;
  taskName: string;
  runId: string;
  status: 'ok' | 'error';
  briefId: string | null;
  callSid: string | null;
  telegramMessageId: string | null;
  summary: string | null;
  error: string | null;
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

  listTools: () =>
    fetch('/api/tools')
      .then(parse<{ tools: ToolInfo[]; count: number }>)
      .then((r) =>
        r.tools.map((t) =>
          typeof t === 'string'
            ? { name: t, description: '' }
            : { name: t.name, description: t.description ?? '' },
        ),
      ),

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

  agenda: (params?: { calendar?: string; date?: string; timezone?: string }) => {
    const q = new URLSearchParams();
    if (params?.calendar) q.set('calendar', params.calendar);
    if (params?.date) q.set('date', params.date);
    if (params?.timezone) q.set('timezone', params.timezone);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return fetch(`/api/calendar/agenda${suffix}`).then(parse<AgendaDto>);
  },

  listConnections: () =>
    fetch('/api/calendar/connections')
      .then(parse<{ connections: CalendarConnectionDto[] }>)
      .then((r) => r.connections),
  disconnectConnection: (providerName: string) =>
    fetch(`/api/calendar/connections/${providerName}`, {
      method: 'DELETE',
    }).then(parse<{ deleted: boolean }>),

  listWorkspace: (params?: { query?: string; kind?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.query) q.set('query', params.query);
    if (params?.kind) q.set('kind', params.kind);
    if (params?.limit) q.set('limit', String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return fetch(`/api/workspace${suffix}`).then(
      parse<{ items: WorkspaceItemDto[]; count: number }>,
    );
  },
  createWorkspace: (input: { title: string; kind?: WorkspaceKind; content?: string }) =>
    fetch('/api/workspace', json(input)).then(
      parse<{ item: WorkspaceItemDto }>,
    ),
  patchWorkspace: (
    id: string,
    patch: { title?: string; kind?: WorkspaceKind; content?: string },
  ) =>
    fetch(`/api/workspace/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(parse<{ item: WorkspaceItemDto }>),
  deleteWorkspace: (id: string) =>
    fetch(`/api/workspace/${id}`, { method: 'DELETE' }).then(
      parse<{ deleted: boolean }>,
    ),

  listTasks: (params?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return fetch(`/api/tasks${suffix}`).then(
      parse<{ tasks: TaskDto[]; count: number }>,
    );
  },
  createTask: (input: {
    title: string;
    notes?: string;
    priority?: string;
    due_at?: string;
  }) => fetch('/api/tasks', json(input)).then(parse<{ task: TaskDto }>),
  patchTask: (
    id: string,
    patch: {
      title?: string;
      notes?: string | null;
      status?: string;
      priority?: string;
      due_at?: string | null;
    },
  ) =>
    fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(parse<{ task: TaskDto }>),
  deleteTask: (id: string) =>
    fetch(`/api/tasks/${id}`, { method: 'DELETE' }).then(
      parse<{ deleted: boolean }>,
    ),

  getSettings: () =>
    fetch('/api/settings')
      .then(parse<{ settings: PreferencesDto }>)
      .then((r) => r.settings),
  patchSettings: (patch: {
    timezone?: string | null;
    schedulingRules?: string | null;
    systemInstructions?: string | null;
    workdayStart?: string | null;
    workdayEnd?: string | null;
    preferredCalendar?: 'local' | 'google';
    agentName?: string | null;
    disabledTools?: string[];
  }) =>
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(parse<{ settings: PreferencesDto }>),

  callsConfig: () => fetch('/api/calls/config').then(parse<CallsConfigDto>),

  scheduledTasks: {
    list: () =>
      fetch('/api/scheduled-tasks')
        .then(parse<{ tasks: ScheduledTaskDto[] }>)
        .then((r) => r.tasks),
    get: (id: string) =>
      fetch(`/api/scheduled-tasks/${id}`).then(
        parse<{ task: ScheduledTaskDto; runs: ScheduledRunDto[] }>,
      ),
    create: (input: {
      name: string;
      instructions?: string;
      delivery?: string[];
      phone?: string | null;
      telegramChatId?: string | null;
      enabled?: boolean;
    }) =>
      fetch('/api/scheduled-tasks', json(input)).then(
        parse<{ task: ScheduledTaskDto }>,
      ),
    patch: (
      id: string,
      patch: {
        name?: string;
        instructions?: string;
        delivery?: string[];
        phone?: string | null;
        telegramChatId?: string | null;
        enabled?: boolean;
      },
    ) =>
      fetch(`/api/scheduled-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then(parse<{ task: ScheduledTaskDto }>),
    remove: (id: string) =>
      fetch(`/api/scheduled-tasks/${id}`, { method: 'DELETE' }).then(
        parse<{ ok: boolean }>,
      ),
    run: (id: string) =>
      fetch(`/api/scheduled-tasks/${id}/run`, { method: 'POST' }).then(
        parse<{ run: TaskRunDto }>,
      ),
  },

  ingestDocument: (file: File) => {
    const form = new FormData();
    form.set('file', file);
    return fetch('/api/workspace/ingest', { method: 'POST', body: form }).then(
      parse<{
        ok: boolean;
        filename: string;
        kind: string;
        chunks: number;
        chars: number;
        pages: number | null;
        truncated: boolean;
        items: Array<{ id: string; title: string }>;
      }>,
    );
  },
};
