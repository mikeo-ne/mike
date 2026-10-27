/**
 * Database connection manager (server-only).
 *
 * - If `DATABASE_URL` is set → connects to a real Postgres server via the
 *   `postgres` (postgres.js) driver.
 * - Otherwise → falls back to PGlite, a real Postgres engine running embedded
 *   (file-backed at ./data/pglite), so the app works with zero setup.
 *
 * Both paths speak the Postgres dialect, so the Drizzle schema, queries, and
 * the CREATE TABLE statements below are identical either way.
 *
 * On first use it also ensures the schema exists and seeds global prompts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq, isNull, sql } from 'drizzle-orm';
import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import postgres from 'postgres';
import * as schema from './schema';
import { SEED_PROMPTS } from './seed-prompts';

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
    CREATE TABLE IF NOT EXISTS "profile_settings" (
      "profile_id" text PRIMARY KEY,
      "timezone" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
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
    CREATE INDEX IF NOT EXISTS "chat_messages_session_idx"
      ON "chat_messages" ("session_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "calendar_events_profile_starts_idx"
      ON "calendar_events" ("profile_id", "starts_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "tool_executions_session_idx"
      ON "tool_executions" ("session_id");
  `);
}

async function seedGlobalPrompts(db: Database): Promise<void> {
  // Top up by name so new seeds (e.g. the MIKE persona) appear on existing
  // databases too — never touching user-created prompts. Uses only the
  // portable query builder: raw execute() result shapes differ per driver.
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
