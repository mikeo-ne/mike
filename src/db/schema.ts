/**
 * Database schema (Postgres dialect, via Drizzle ORM).
 *
 * Tables:
 *  - chat_sessions        — conversation threads, owned by an anonymous
 *                             per-browser profile id.
 *  - conversations        — message logs with metadata: user / assistant
 *                             (+tool_calls JSON) / tool results.
 *  - system_prompts       — reusable additional instructions (global seeds
 *                             + user created). Mike's core persona is
 *                             hardcoded in src/lib/ai/executive.ts.
 *  - user_preferences     — per-profile memory: timezone, scheduling rules,
 *                             workday bounds, preferred calendar, and personal
 *                             system instructions.
 *  - workspace_context    — user notes, project guidelines, and briefs that
 *                             Mike references for background and deadlines.
 *  - tasks                — active task list surfaced on Mike's Dashboard.
 *  - calendar_events      — local events managed through tools.
 *  - calendar_connections — encrypted external OAuth tokens (Google).
 *  - tool_executions      — audit log of every tool invocation.
 *
 * Security notes:
 *  - This module is imported ONLY from server-side code (API routes, tools).
 *  - All access goes through Drizzle's parameterized query builder — no
 *    string-interpolated SQL anywhere in the app.
 *  - Rows are always scoped by `profile_id` (anonymous owner cookie) so one
 *    browser profile can never read/write another's data.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Chat sessions (threads)
// ---------------------------------------------------------------------------
export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey(),
    /** Anonymous owner id (httpOnly cookie value). */
    profileId: text('profile_id').notNull(),
    title: text('title').notNull().default('New conversation'),
    systemPromptId: uuid('system_prompt_id'),
    provider: text('provider').notNull().default('openai'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    profileIdx: index('chat_sessions_profile_idx').on(t.profileId),
  }),
);

export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;

// ---------------------------------------------------------------------------
// Conversations (message logs with metadata)
// ---------------------------------------------------------------------------
/**
 * role:
 *  - "user"      — human message
 *  - "assistant" — model message (may carry `tool_calls` when it invoked tools)
 *  - "tool"      — result of a single tool invocation (`tool_call_id` links it
 *                  to the assistant's tool call)
 *  - "system"    — reserved (system prompt is injected at runtime, not stored
 *                  per message)
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull().default(''),
    /** For role="assistant": [{ id, name, args }] */
    toolCalls: jsonb('tool_calls').$type<
      Array<{ id: string; name: string; args: Record<string, unknown> }> | null
    >(),
    /** For role="tool": which tool produced this result. */
    toolName: text('tool_name'),
    /** For role="tool": provider tool-call id it answers. */
    toolCallId: text('tool_call_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionIdx: index('conversations_session_idx').on(t.sessionId),
  }),
);

export type ConversationMessage = typeof conversations.$inferSelect;
export type NewConversationMessage = typeof conversations.$inferInsert;

// ---------------------------------------------------------------------------
// System prompts (additional instructions)
// ---------------------------------------------------------------------------
export const systemPrompts = pgTable('system_prompts', {
  id: uuid('id').primaryKey(),
  /**
   * Owner profile id, or NULL for built-in global prompts that every
   * profile can use.
   */
  profileId: text('profile_id'),
  name: text('name').notNull(),
  content: text('content').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SystemPrompt = typeof systemPrompts.$inferSelect;
export type NewSystemPrompt = typeof systemPrompts.$inferInsert;

// ---------------------------------------------------------------------------
// User preferences (long-term memory)
// ---------------------------------------------------------------------------
export const userPreferences = pgTable('user_preferences', {
  profileId: text('profile_id').primaryKey(),
  /** IANA timezone, e.g. "Africa/Kampala". */
  timezone: text('timezone'),
  /** Freeform scheduling rules, e.g. "no meetings before 9am". */
  schedulingRules: text('scheduling_rules'),
  /** Personal instructions appended to Mike's system prompt. */
  systemInstructions: text('system_instructions'),
  /** Workday bounds as "HH:MM" for proactive slot proposals. */
  workdayStart: text('workday_start'),
  workdayEnd: text('workday_end'),
  /** Default calendar source for tools: "local" | "google". */
  preferredCalendar: text('preferred_calendar').notNull().default('local'),
  /** Agent display name (null = "Mike"). */
  agentName: text('agent_name'),
  /** Tool names the agent loop must skip (null = all enabled). */
  disabledTools: jsonb('disabled_tools').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

// ---------------------------------------------------------------------------
// Workspace context (notes, guidelines, briefs)
// ---------------------------------------------------------------------------
/**
 * kind: "note" | "project" | "guideline" | "brief" (free text, UI constrains).
 */
export const workspaceContext = pgTable(
  'workspace_context',
  {
    id: uuid('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('note'),
    content: text('content').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    profileIdx: index('workspace_context_profile_idx').on(t.profileId),
  }),
);

export type WorkspaceContext = typeof workspaceContext.$inferSelect;
export type NewWorkspaceContext = typeof workspaceContext.$inferInsert;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
/**
 * status: "open" | "in_progress" | "done".
 * priority: "low" | "medium" | "high".
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    status: text('status').notNull().default('open'),
    priority: text('priority').notNull().default('medium'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    profileStatusIdx: index('tasks_profile_status_idx').on(
      t.profileId,
      t.status,
    ),
  }),
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

// ---------------------------------------------------------------------------
// Calendar events (local)
// ---------------------------------------------------------------------------
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    allDay: boolean('all_day').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    profileStartsIdx: index('calendar_events_profile_starts_idx').on(
      t.profileId,
      t.startsAt,
    ),
  }),
);

export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;

// ---------------------------------------------------------------------------
// Calendar connections (external OAuth calendars, e.g. Google)
// ---------------------------------------------------------------------------
/**
 * One row per (profile, provider). Tokens are AES-256-GCM encrypted via
 * TOKEN_ENCRYPTION_KEY — see src/lib/crypto.ts. Uniqueness on
 * (profile_id, provider) is enforced by DDL + upsert logic.
 */
export const calendarConnections = pgTable('calendar_connections', {
  id: uuid('id').primaryKey(),
  profileId: text('profile_id').notNull(),
  /** External provider id, e.g. "google". */
  provider: text('provider').notNull(),
  email: text('email'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  scope: text('scope'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type NewCalendarConnection = typeof calendarConnections.$inferInsert;

// ---------------------------------------------------------------------------
// Tool execution audit log
// ---------------------------------------------------------------------------
export const toolExecutions = pgTable(
  'tool_executions',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id').references(() => chatSessions.id, {
      onDelete: 'set null',
    }),
    profileId: text('profile_id').notNull(),
    toolName: text('tool_name').notNull(),
    args: jsonb('args').$type<Record<string, unknown>>(),
    result: jsonb('result').$type<unknown>(),
    status: text('status').notNull().default('ok'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionIdx: index('tool_executions_session_idx').on(t.sessionId),
  }),
);

export type ToolExecution = typeof toolExecutions.$inferSelect;
export type NewToolExecution = typeof toolExecutions.$inferInsert;

/** Clockwork: scheduled agent tasks (e.g. daily morning briefing). */
export const scheduledTasks = pgTable(
  'scheduled_tasks',
  {
    id: uuid('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    name: text('name').notNull(),
    instructions: text('instructions').notNull().default(''),
    /** Delivery channels: ["hub"] and/or ["hub","call"]. */
    delivery: jsonb('delivery').$type<string[]>().notNull(),
    /** E.164 recipient override; null = ALERT_PHONE_NUMBER. */
    phone: text('phone'),
    enabled: boolean('enabled').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status'),
    runCount: integer('run_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('scheduled_tasks_profile_idx').on(t.profileId)],
);

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type NewScheduledTask = typeof scheduledTasks.$inferInsert;

/** Clockwork: execution history for scheduled tasks. */
export const scheduledRuns = pgTable(
  'scheduled_runs',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => scheduledTasks.id, { onDelete: 'cascade' }),
    profileId: text('profile_id').notNull(),
    status: text('status').notNull().default('ok'),
    briefId: uuid('brief_id'),
    callSid: text('call_sid'),
    callStatus: text('call_status'),
    outputSummary: text('output_summary'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('scheduled_runs_task_idx').on(t.taskId)],
);

export type ScheduledRun = typeof scheduledRuns.$inferSelect;
export type NewScheduledRun = typeof scheduledRuns.$inferInsert;
