-- Initial schema for Mike, the personal AI assistant.
-- The app also applies equivalent idempotent DDL automatically at startup
-- (see src/db/index.ts, including migrations for older databases), so this
-- file is only needed when you manage the database externally
-- (psql / drizzle-kit / CI).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" uuid PRIMARY KEY,
  "profile_id" text NOT NULL,
  "title" text NOT NULL DEFAULT 'New conversation',
  "system_prompt_id" uuid,
  "provider" text NOT NULL DEFAULT 'openai',
  "model" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY,
  "session_id" uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "tool_calls" jsonb,
  "tool_name" text,
  "tool_call_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_prompts" (
  "id" uuid PRIMARY KEY,
  "profile_id" text,
  "name" text NOT NULL,
  "content" text NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_preferences" (
  "profile_id" text PRIMARY KEY,
  "timezone" text,
  "scheduling_rules" text,
  "system_instructions" text,
  "workday_start" text,
  "workday_end" text,
  "preferred_calendar" text NOT NULL DEFAULT 'local',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_context" (
  "id" uuid PRIMARY KEY,
  "profile_id" text NOT NULL,
  "title" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'note',
  "content" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY,
  "profile_id" text NOT NULL,
  "title" text NOT NULL,
  "notes" text,
  "status" text NOT NULL DEFAULT 'open',
  "priority" text NOT NULL DEFAULT 'medium',
  "due_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id" uuid PRIMARY KEY,
  "profile_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "location" text,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz,
  "all_day" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_connections" (
  "id" uuid PRIMARY KEY,
  "profile_id" text NOT NULL,
  "provider" text NOT NULL,
  "email" text,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "expires_at" timestamptz,
  "scope" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("profile_id", "provider")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_executions" (
  "id" uuid PRIMARY KEY,
  "session_id" uuid REFERENCES "chat_sessions"("id") ON DELETE SET NULL,
  "profile_id" text NOT NULL,
  "tool_name" text NOT NULL,
  "args" jsonb,
  "result" jsonb,
  "status" text NOT NULL DEFAULT 'ok',
  "error" text,
  "duration_ms" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "agent_name" text;
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "disabled_tools" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
  "id" uuid PRIMARY KEY,
  "profile_id" text NOT NULL,
  "name" text NOT NULL,
  "instructions" text NOT NULL DEFAULT '',
  "delivery" jsonb NOT NULL DEFAULT '["hub"]',
  "phone" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamptz,
  "last_status" text,
  "run_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_runs" (
  "id" uuid PRIMARY KEY,
  "task_id" uuid NOT NULL REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE,
  "profile_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ok',
  "brief_id" uuid,
  "call_sid" text,
  "call_status" text,
  "output_summary" text,
  "error" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);
--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;
--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD COLUMN IF NOT EXISTS "telegram_message_id" text;
--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD COLUMN IF NOT EXISTS "telegram_status" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_sessions_profile_idx" ON "chat_sessions" ("profile_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_session_idx" ON "conversations" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_context_profile_idx" ON "workspace_context" ("profile_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_profile_status_idx" ON "tasks" ("profile_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_profile_starts_idx" ON "calendar_events" ("profile_id", "starts_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_executions_session_idx" ON "tool_executions" ("session_id");
