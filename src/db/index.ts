/**
 * Database connection manager (server-only).
 *
 * - If `DATABASE_URL` (or `POSTGRES_URL`) is set → connects to a real
 *   Postgres server via the `postgres` (postgres.js) driver.
 * - Otherwise → falls back to PGlite, a real Postgres engine running embedded
 *   (file-backed at ./data/pglite), so the app works with zero setup.
 *
 * Both paths speak the Postgres dialect, so the Drizzle schema, queries, and
 * the DDL below are identical either way.
 *
 * On first use it also ensures the schema exists (including idempotent
 * migrations for databases created by earlier versions), migrates legacy
 * preferences, and seeds global prompts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq, isNull, or, sql } from 'drizzle-orm';
import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import postgres from 'postgres';
import * as schema from './schema';
import {
  LEGACY_DEFAULT_SEED_CONTENTS,
  LEGACY_DEFAULT_SEED_NAMES,
  SEED_PROMPTS,
} from './seed-prompts';

export type Database = PostgresJsDatabase<typeof schema>;
export type DatabaseMode = 'postgres' | 'pglite';

interface DbState {
  db: Database;
  mode: DatabaseMode;
  ready: Promise<DbState>;
}

declare global {
  // eslint-disable-next-line no-var
  var __assistantDb: DbState | undefined;
}

function databaseUrl(): string | null {
  // Accept the common Postgres env var names (managed platforms such as
  // Arena/Vercel may inject POSTGRES_URL instead of DATABASE_URL).
  for (const key of ['DATABASE_URL', 'POSTGRES_URL']) {
    const url = process.env[key]?.trim();
    if (url) return url;
  }
  return null;
}

export function getDatabaseMode(): DatabaseMode {
  return databaseUrl() ? 'postgres' : 'pglite';
}

async function createPgliteDb(): Promise<Database> {
  // Dynamic import keeps the heavy native/WASM binding out of bundles that
  // never touch the database (and out of `next build` static analysis).
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(process.cwd(), 'data', 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  return drizzlePglite(client, { schema }) as unknown as Database;
}

function createPostgresDb(url: string): Database {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
  });
  return drizzlePg(client, { schema });
}

/**
 * Idempotent DDL mirroring `schema.ts` (+ `drizzle/0001_init.sql` for
 * externally-managed databases). Safe to run on every cold start.
 */
async function ensureSchema(db: Database): Promise<void> {
  // --- Migrations for pre-existing databases (run before CREATEs). ---
  await db.execute(
    sql`ALTER TABLE IF EXISTS "chat_messages" RENAME TO "conversations";`,
  );
  await db.execute(
    sql`ALTER INDEX IF EXISTS "chat_messages_session_idx" RENAME TO "conversations_session_idx";`,
  );

  await db.execute(sql`
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
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "system_prompts" (
      "id" uuid PRIMARY KEY,
      "profile_id" text,
      "name" text NOT NULL,
      "content" text NOT NULL,
      "is_default" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Agent customization columns (safe on existing DBs via IF NOT EXISTS).
  await db.execute(sql`
    ALTER TABLE IF EXISTS "user_preferences" ADD COLUMN IF NOT EXISTS "agent_name" text;
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS "user_preferences" ADD COLUMN IF NOT EXISTS "disabled_tools" jsonb;
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_preferences" (
      "profile_id" text PRIMARY KEY,
      "timezone" text,
      "scheduling_rules" text,
      "system_instructions" text,
      "workday_start" text,
      "workday_end" text,
      "preferred_calendar" text NOT NULL DEFAULT 'local',
      "agent_name" text,
      "disabled_tools" jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "scheduled_tasks_profile_idx" ON "scheduled_tasks" ("profile_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "scheduled_runs_task_idx" ON "scheduled_runs" ("task_id");
  `);
  // Legacy table (replaced by user_preferences): create-if-missing so the
  // migration below works on fresh databases too, then migrate + drop.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "profile_settings" (
      "profile_id" text PRIMARY KEY,
      "timezone" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "workspace_context" (
      "id" uuid PRIMARY KEY,
      "profile_id" text NOT NULL,
      "title" text NOT NULL,
      "kind" text NOT NULL DEFAULT 'note',
      "content" text NOT NULL DEFAULT '',
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
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
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "chat_sessions_profile_idx"
      ON "chat_sessions" ("profile_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "conversations_session_idx"
      ON "conversations" ("session_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "workspace_context_profile_idx"
      ON "workspace_context" ("profile_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "tasks_profile_status_idx"
      ON "tasks" ("profile_id", "status");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "calendar_events_profile_starts_idx"
      ON "calendar_events" ("profile_id", "starts_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "tool_executions_session_idx"
      ON "tool_executions" ("session_id");
  `);

  // --- Data migration: profile_settings -> user_preferences, then drop. ---
  await db.execute(sql`
    INSERT INTO "user_preferences" ("profile_id", "timezone", "created_at", "updated_at")
    SELECT "profile_id", "timezone", now(), now() FROM "profile_settings"
    ON CONFLICT ("profile_id") DO NOTHING;
  `);
  await db.execute(sql`DROP TABLE IF EXISTS "profile_settings";`);
}

async function seedGlobalPrompts(db: Database): Promise<void> {
  // Migrate untouched legacy defaults to the current workspace persona.
  // Branding (name) is always refreshed; content is only replaced when it
  // still matches a known legacy seed — user-edited prompts are left alone.
  const currentDefault =
    SEED_PROMPTS.find((p) => p.isDefault) ?? SEED_PROMPTS[0];
  const legacyRows = await db
    .select({
      id: schema.systemPrompts.id,
      name: schema.systemPrompts.name,
      content: schema.systemPrompts.content,
    })
    .from(schema.systemPrompts)
    .where(
      or(
        ...LEGACY_DEFAULT_SEED_NAMES.map((n) =>
          eq(schema.systemPrompts.name, n),
        ),
      ),
    );
  for (const row of legacyRows) {
    const resetContent = LEGACY_DEFAULT_SEED_CONTENTS.includes(row.content);
    await db
      .update(schema.systemPrompts)
      .set({
        name: currentDefault.name,
        content: resetContent ? currentDefault.content : row.content,
        updatedAt: new Date(),
      })
      .where(eq(schema.systemPrompts.id, row.id));
  }
  // Top up by name so new seeds appear on existing databases too — never
  // touching user-created prompts. Uses only the portable query builder:
  // raw execute() result shapes differ per driver.
  const globals = await db
    .select({
      id: schema.systemPrompts.id,
      name: schema.systemPrompts.name,
    })
    .from(schema.systemPrompts)
    .where(isNull(schema.systemPrompts.profileId));
  const known = new Set(globals.map((g) => g.name));
  for (const prompt of SEED_PROMPTS) {
    if (known.has(prompt.name)) continue;
    await db.insert(schema.systemPrompts).values({
      id: randomUUID(),
      profileId: null,
      name: prompt.name,
      content: prompt.content,
      isDefault: false,
    });
    known.add(prompt.name);
  }
  // Guarantee a default exists, preferring the flagged seed.
  const all = await db
    .select({
      id: schema.systemPrompts.id,
      name: schema.systemPrompts.name,
      isDefault: schema.systemPrompts.isDefault,
    })
    .from(schema.systemPrompts);
  if (!all.some((r) => r.isDefault)) {
    const preferred =
      SEED_PROMPTS.find((p) => p.isDefault)?.name ?? SEED_PROMPTS[0].name;
    await db
      .update(schema.systemPrompts)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(isNull(schema.systemPrompts.profileId));
    const target = all.find((r) => r.name === preferred);
    if (target) {
      await db
        .update(schema.systemPrompts)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(schema.systemPrompts.id, target.id));
    }
  }
}

async function init(): Promise<{ db: Database; mode: DatabaseMode }> {
  const url = databaseUrl();
  const mode: DatabaseMode = url ? 'postgres' : 'pglite';
  const db = url ? createPostgresDb(url) : await createPgliteDb();
  await ensureSchema(db);
  await seedGlobalPrompts(db);
  return { db, mode };
}

/**
 * Returns the shared database handle, initialising on first call.
 * Safe under Next.js dev hot-reload via the globalThis cache.
 */
export async function getDb(): Promise<{ db: Database; mode: DatabaseMode }> {
  if (!globalThis.__assistantDb) {
    const state = {} as DbState;
    state.ready = init()
      .then(({ db, mode }) => {
        state.db = db;
        state.mode = mode;
        return state;
      })
      .catch((err) => {
        globalThis.__assistantDb = undefined;
        throw err;
      });
    globalThis.__assistantDb = state;
  }
  const state = await globalThis.__assistantDb.ready;
  return { db: state.db, mode: state.mode };
}

export { schema };
