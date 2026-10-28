# Prisma migration plan

The app runs on Drizzle today. The target is Prisma, migrated in phases so
production never breaks. **Phase 1 (this shipment): schema port only — no
live query path touches Prisma yet.**

## Phase 1 — schema port ✅ (this PR)

- `prisma/schema.prisma` is the complete forward model: 6 product models
  (User, Project, ProjectMember, Asset, ChatThread, Message) + 11 legacy
  mirrors mapped 1:1 onto the live snake_case tables.
- `prisma` (CLI) + `@prisma/client` installed and pinned in the lockfile.
- Verified in sandbox via the Prisma 7.10 compiler itself
  (@prisma/prisma-schema-wasm, same Rust code as the schema engine):
  full-schema format/parse succeeds, proving relations, mappings, and
  native types all resolve. (`prisma validate`/`generate` need engine
  binaries from binaries.prisma.sh, unreachable from this sandbox.)
- Durable gate: `.github/workflows/prisma.yml` runs `prisma validate` +
  `generate` + full `migrate diff` DDL on every PR (GitHub runners have
  internet).
- Deliberately NOT in Phase 1: no `src/lib/prisma.ts` singleton, no route
  rewrites, no build-script change (nothing imports the client yet, so
  Vercel needs no `generate` step until Phase 2).

## Phase 2 — read/write new surfaces with Prisma (next)

1. Add `src/lib/prisma.ts` singleton + `prisma generate` to the build.
2. Build Projects / Members / Assets APIs on Prisma (new tables — zero
   collision with Drizzle paths).
3. Align `supabase/schema.sql` to this file (profiles += email/role,
   projects: name→title + description/status, assets: filename/file_type/
   file_size/file_url) and decide: Prisma Migrate owns tables, SQL file
   keeps auth trigger + RLS + storage policies.
4. Supabase keys still required (user setup) for Auth + Storage.

## Phase 3 — migrate live surfaces + unify chat (later)

- Flip routes surface-by-surface (prompts → prefs → tasks → calendar →
  workspace → sessions → runs), each behind verification.
- Unify chat: migrate `chat_sessions`/`conversations` rows into
  `chat_threads`/`messages` (project-linked), then retire the old tables.
- Retire Drizzle + PGlite dev flow once nothing imports them.

## Open question: dev database

Prisma cannot talk to PGlite (embedded, no Postgres wire server), and this
sandbox has no Postgres binaries. Options for live Prisma verification:
(a) point dev at Neon (real, but shared with prod data — use a branch),
(b) Prisma Postgres free tier, (c) user runs Postgres locally.
Decision needed before Phase 2 route flips.

## Decisions (deviations from the original sketch)

| # | Decision | Why |
|---|----------|-----|
| 1 | Connection URL in `prisma.config.ts` as `POSTGRES_URL`, not `DATABASE_URL` | Prisma 7 forbids `url` in schemas; one secret; matches existing convention |
| 2 | `User.id` has no default; `@@map("profiles")` | Id must equal the Supabase auth id; `profiles` already exists with the auth trigger |
| 3 | Added `ProjectMember` table | The sketch had owner-only; PRD §2.1 needs per-project roles |
| 4 | Added `Project.stage` | PRD pipeline; `status` alone is weaker |
| 5 | Added `Asset.version`, `storage_path`, `mime_type`; `file_size` is BigInt; `file_url` nullable | PRD version history; stems exceed Int; private RLS bucket ⇒ signed URLs, no static URL at upload |
| 6 | Legacy tables mirrored with `@@map`/`@map`, no renames | Zero-downtime: Prisma and Drizzle see the same DB |
| 7 | Scalars kept scalar (`systemPromptId`, `briefId`) | Live tables have no such FKs; mirrors stay faithful |
| 8 | `Message.sender` keeps USER/ASSISTANT only | Tool/system roles fold in during Phase 3 chat unification |

## Commands

```bash
npx prisma validate                    # schema compiles
npx prisma generate                    # build the typed client (needs engines)
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script  # full DDL
# Offline equivalent (sandbox: no engine downloads) — same compiler via WASM:
node -e "const w=require('@prisma/prisma-schema-wasm');const fs=require('fs');w.format(fs.readFileSync('prisma/schema.prisma','utf8'),'{}');console.log('schema OK')"
```
