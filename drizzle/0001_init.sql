-- Initial schema for the Personal AI Assistant.
-- The app also applies equivalent CREATE TABLE IF NOT EXISTS statements
-- automatically at startup (see src/db/index.ts), so this file is only needed
-- when you manage the database externally (psql / drizzle-kit / CI).
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
CREATE TABLE IF NOT EXISTS "chat_messages" (
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
CREATE TABLE IF NOT EXISTS "profile_settings" (
  "profile_id" text PRIMARY KEY,
  "timezone" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
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
CREATE INDEX IF NOT EXISTS "chat_sessions_profile_idx" ON "chat_sessions" ("profile_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_session_idx" ON "chat_messages" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_events_profile_starts_idx" ON "calendar_events" ("profile_id", "starts_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_executions_session_idx" ON "tool_executions" ("session_id");
