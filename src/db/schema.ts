/**
 * Database schema (Postgres dialect, via Drizzle ORM).
 *
 * Tables:
 *  - chat_sessions   — user chat sessions (conversations), owned by an
 *                        anonymous per-browser profile id.
 *  - chat_messages   — full transcript incl. assistant tool calls and tool
 *                        results, so multi-step agent turns can be rebuilt.
 *  - system_prompts  — reusable system prompts (global seeds + user created).
 *  - calendar_events — events the agent manages through tool calls.
 *  - tool_executions — audit log of every tool invocation.
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
// Chat sessions
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
// Chat messages
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
export const chatMessages = pgTable(
  'chat_messages',
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
    sessionIdx: index('chat_messages_session_idx').on(t.sessionId),
  }),
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

// ---------------------------------------------------------------------------
// System prompts
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
// Profile settings
// ---------------------------------------------------------------------------
/**
 * Per-profile preferences. `timezone` (IANA, e.g. "Africa/Kampala") is
 * injected into the agent's system context so relative dates resolve in the
 * user's own timezone, and is the default for time tools.
 */
export const profileSettings = pgTable('profile_settings', {
  profileId: text('profile_id').primaryKey(),
  timezone: text('timezone'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProfileSettings = typeof profileSettings.$inferSelect;
export type NewProfileSettings = typeof profileSettings.$inferInsert;

// ---------------------------------------------------------------------------
// Calendar events
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
