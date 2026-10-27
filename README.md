# Mike — Personal AI Assistant

Mike is your elite, proactive executive assistant: a split-screen web app with a
conversational chat window and a real-time **Mike's Dashboard** (schedule +
tasks), an AI agent (OpenAI or Anthropic) with function calling, long-term memory
in Postgres, and a webhook relay for real scheduling updates.

Instead of just reacting, Mike cross-references project deadlines with your
calendar, points out conflicts, suggests next actions, and proposes clear time
slots for tasks.

## Features

- **Split-screen UI** — chat on one side, **Mike's Dashboard** on the other:
  live today-view (now/up-next, conflict warnings, 60s auto-refresh), active
  tasks with checkboxes, full calendar, workspace notes, prompt library, and
  settings. Responsive with mobile drawers.
- **Proactive agent** — hardcoded executive persona (`src/lib/ai/executive.ts`)
  plus your timezone, scheduling rules, workday bounds, and personal
  instructions, composed fresh on every turn.
- **Agentic tools** — structured function calling / tool use:
  `get_calendar_schedule` (day/week/month timelines),
  `modify_calendar_schedule` (create/reschedule/update/delete),
  `get_project_context` (workspace memory), `get_daily_agenda`, `manage_tasks`,
  `get_current_time`, plus per-action calendar tools.
- **Long-term memory (Postgres)** — `conversations` (message logs + tool
  metadata), `user_preferences` (timezone, scheduling rules, workday,
  preferred calendar, instructions), `workspace_context` (notes, projects,
  guidelines, briefs), `tasks`, and a `tool_executions` audit log.
- **Google Calendar OAuth** — connect your real calendar; every calendar tool
  accepts `"calendar": "google"`.
- **Webhook relay** — every mutation payload is POSTed to
  `CALENDAR_WEBHOOK_URL` (Cal.com, Make.com, custom), HMAC-signed, with a mock
  mode when unconfigured; `POST /api/calendar/webhook` relays arbitrary
  calendar JSON.
- **Secure by default** — parameterized queries only, zod validation on every
  route, per-browser profile isolation via `httpOnly` cookie, encrypted OAuth
  tokens, API keys server-side only.
- **Zero-config DB** — embedded PGlite (real Postgres) when
  `DATABASE_URL`/`POSTGRES_URL` is unset; idempotent DDL + migrations on boot.
- **Demo mode** — no API key? Rule-based replies with *real* tool execution.

## Quickstart

```bash
npm install
cp .env.example .env   # optional for demo mode
npm run dev            # http://localhost:3000
```

Open the app and try:

- `What does my schedule look like tomorrow morning?`
- `Book a lunch meeting with Sarah at 1 PM next Thursday.`
- `Add "Prepare Q4 board deck" to my tasks and find time for it Friday.`
- `Save a project brief: website relaunch, deadline Nov 20.`

Then open **Mike's Dashboard → Workspace** and save a project brief with a
deadline — ask Mike to plan around it and watch him cross-reference.

### Enable full AI

Paste keys into your host's **Secrets Management** panel (e.g. Arena secrets), or set
them in `.env` for local development:

```env
AI_PROVIDER=openai            # or: anthropic
AI_MODEL=                   # optional override (defaults: gpt-4o-mini / claude-sonnet-4-20250514)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Use real Postgres

```bash
docker compose up -d postgres
# .env:
DATABASE_URL=postgresql://assistant:assistant@localhost:5432/assistant
npm run dev
```

Tables + migrations apply automatically on boot (mirrored in
`drizzle/0001_init.sql`). Explicit workflow:

```bash
npm run db:generate   # drizzle-kit generate (after editing src/db/schema.ts)
npm run db:push       # push to DATABASE_URL
```

## Architecture

```
Browser (React 18, Tailwind)
  split-screen: chat + Mike's Dashboard (agenda, tasks, calendar, workspace)
  │  SSE stream + JSON REST
  ▼
Next.js App Router (Node.js runtime)
  ├─ /api/chat                  streaming agent turns (Mike core + live context)
  ├─ /api/sessions[ /:id]       conversation threads + transcripts
  ├─ /api/system-prompts[/:id]  additional-instructions library
  ├─ /api/workspace[/:id]       notes / projects / guidelines / briefs
  ├─ /api/tasks[/:id]           task list CRUD
  ├─ /api/calendar/events[/:id] local event CRUD (local|google routing)
  ├─ /api/calendar/agenda       daily agenda (dashboard feed)
  ├─ /api/calendar/webhook      payload relay → CALENDAR_WEBHOOK_URL / mock
  ├─ /api/calendar/google/*     OAuth connect/callback + connections
  ├─ /api/tools (GET)           tool catalogue (name, description, JSON schema)
  └─ /api/tools/:name (POST)    generic audited tool-execution gateway
  ▼
Agent loop (src/lib/ai) ──► OpenAI Chat Completions  (function calling)
  multi-step, max AGENT_MAX_STEPS ──► Anthropic Messages (tool use)
  ▼ executes via registry (validated + audited)
Tool registry (src/lib/tools) ──► Postgres (Drizzle ORM, parameterized)
  get_calendar_schedule, modify_calendar_schedule, get_project_context,
  manage_tasks, get_daily_agenda, list/create/update/delete_calendar_event,
  get_current_time
  ▼ mutations also fan out to CALENDAR_WEBHOOK_URL (fire-and-forget)
```

### Request flow for one chat turn

1. `POST /api/chat` validates input, resolves the profile, loads/creates the
   session, loads preferences + selected instructions, and composes the system
   prompt: **Mike's hardcoded core + live context** (timezone, rules, workday,
   preferred calendar, instructions).
2. The agent loop streams one provider step at a time; each `tool_call` is
   validated against its zod schema, executed profile-scoped, audit-logged, and
   fed back until a text-only answer (or `AGENT_MAX_STEPS`). Calendar mutations
   also POST their payload to the webhook relay.
3. SSE events (`session`, `text`, `tool_call`, `tool_result`, `done`, `error`)
   stream to the client; the full transcript lands in `conversations`.

### Database schema

| Table | Purpose |
|---|---|
| `chat_sessions` | Conversation threads: owner, title, prompt ref, provider/model |
| `conversations` | Message logs with metadata: `user` / `assistant` (+`tool_calls`) / `tool` |
| `system_prompts` | Global seeds + user instructions appended to Mike's core |
| `user_preferences` | Timezone, scheduling rules, workday, preferred calendar, instructions |
| `workspace_context` | Notes, projects, guidelines, briefs (Mike's background memory) |
| `tasks` | Task list: status, priority, due dates |
| `calendar_events` | Profile-scoped local events |
| `calendar_connections` | Encrypted external OAuth tokens (Google) |
| `tool_executions` | Audit log: tool, args, result/error, duration, session |

## Adding a new tool

1. Create `src/lib/tools/<name>.ts`:

```ts
import { z } from 'zod';
import { defineTool } from './registry';

defineTool({
  name: 'my_tool',
  description: 'What it does (Mike reads this).',
  parameters: z.object({
    input: z.string().describe('...'),
  }),
  execute: async (args, ctx) => {
    // ctx.profileId — scope all data access to it
    // ctx.sessionId — set when called from a chat turn
    // ctx.timezone  — user's saved timezone, when set
    return { ok: true };
  },
});
```

2. Import it from `src/lib/tools/index.ts`.

That's it — the tool is now available to Mike, listed at `GET /api/tools`, and
executable via `POST /api/tools/my_tool` (validated + audited).

## Webhook relay

Set `CALENDAR_WEBHOOK_URL` (+ optional `CALENDAR_WEBHOOK_SECRET` for the
`X-Mike-Signature: sha256=…` header). Every calendar mutation then POSTs:

```json
{
  "source": "mike",
  "occurred_at": "2026-10-27T…",
  "action": "created | updated | rescheduled | deleted | cancelled",
  "calendar": "local | google",
  "event": { "id": "…", "title": "…", "starts_at": "…" },
  "conflicts": []
}
```

Point it at Cal.com, a Make.com webhook, or your own endpoint to trigger real
scheduling updates. `POST /api/calendar/webhook` accepts the same shape for
manual/external relay; `GET` reports `{ configured, mode }` without leaking
secrets. Failures never break tool execution ( mock mode when unset).

## API reference

| Method & path | Description |
|---|---|
| `GET /api/health` | Provider/model, `demoMode`, `database` mode |
| `GET/POST /api/sessions` | List / create conversations |
| `GET/PATCH/DELETE /api/sessions/:id` | Thread + transcript / update / delete |
| `POST /api/chat` | `{ sessionId?, content, systemPromptId? }` → SSE stream |
| `GET/POST /api/system-prompts` | List / create instruction prompts |
| `PATCH/DELETE /api/system-prompts/:id` | Update / delete prompt |
| `GET/POST /api/workspace` | List (`?query&kind&limit`) / create entry |
| `PATCH/DELETE /api/workspace/:id` | Update / delete entry |
| `GET/POST /api/tasks` | List (`?status&limit`) / create task |
| `PATCH/DELETE /api/tasks/:id` | Update / delete task |
| `GET/POST /api/calendar/events` | List (`?from&to&query&limit&calendar`) / create |
| `PATCH/DELETE /api/calendar/events/:id` | Update / delete event |
| `GET /api/calendar/agenda` | Daily agenda (`?calendar&date&timezone`) |
| `GET/POST /api/calendar/webhook` | Relay status / relay a calendar payload |
| `GET /api/calendar/connections` | External connections (no secrets) |
| `DELETE /api/calendar/connections/:provider` | Disconnect + revoke |
| `GET /api/calendar/google/connect` | Start Google OAuth |
| `GET /api/calendar/google/callback` | OAuth callback |
| `GET/PATCH /api/settings` | Read / update preferences |
| `GET /api/tools` | Tool catalogue with JSON schemas |
| `POST /api/tools/:name` | `{ args, sessionId? }` → `{ result }` |

SSE event examples from `/api/chat`: `session`, `tool_call`, `tool_result`,
`text` (deltas), `done`, `error` — see `src/lib/ai/types.ts`.

## Google Calendar (OAuth)

Mike's built-in calendar works out of the box. To also read and write a real
Google Calendar:

1. In **Google Cloud Console**, create a project, configure the OAuth consent
   screen (External), and create an **OAuth Client ID** (Web application).
2. Add the authorized redirect URI:
   `https://<your-host>/api/calendar/google/callback`
   (local: `http://localhost:3000/api/calendar/google/callback`).
3. Generate a token-encryption key:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Paste into **Secrets Management** (or `.env` locally):
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`
   (optional: `GOOGLE_REDIRECT_URI`, `APP_URL`).
5. Open Mike → side panel → **Settings → Connections → Connect Google Calendar**,
   and approve the consent screen.
6. Ask Mike about *"my Google calendar"* — every calendar tool accepts
   `"calendar": "google"` (or set it as preferred in Settings).

Tokens are AES-256-GCM encrypted at rest, scoped per profile, refreshed
automatically, and revocable anytime via **Disconnect** (which also revokes the
grant at Google). Only least-privilege scopes are requested (`openid email` +
`calendar.events`).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next.js lint |
| `npm run db:generate` / `db:push` | Drizzle schema workflow |

## Security notes

- No login screen by design (personal single-user app), but all data is isolated
  per browser via a random `httpOnly`, `SameSite=Lax` (`Secure` in production)
  cookie.
- Every query is parameterized through Drizzle; no raw interpolated SQL.
- Every API input is validated with zod; tool arguments are re-validated at
  execution; OAuth state is HMAC-signed and profile-bound.
- API keys and OAuth secrets live only in server-side env vars.
- All tool invocations are recorded in `tool_executions` for review.

## Project structure

```
src/
  app/                    Next.js App Router: page, layout, /api/* routes
  components/             Chat, Dashboard, Calendar/Workspace/Prompts/Settings, …
  hooks/useAgentChat.ts   SSE streaming chat state hook
  lib/
    ai/                   executive core, provider adapters, agent loop, demo
    tools/                tool registry + time/calendar/agenda/schedule/workspace/tasks
    calendar/             local store, Google client, tz windows, webhook relay
    tasks.ts              shared task store (REST + tool)
    settings.ts           preference lookups (server)
    client-api.ts         typed fetch helpers (client-safe)
    profile.ts            anonymous profile cookie (server)
    crypto.ts             AES-GCM + HMAC (server)
    utils.ts
  db/                     Drizzle schema, connection manager, seeds
drizzle/0001_init.sql     reference migration for externally-managed DBs
docker-compose.yml        local Postgres
```

## Deployment

Any Node host works (Vercel, Fly, Render, VPS). Set `DATABASE_URL` to managed
Postgres and at least one provider key; run `npm run build && npm start`. The
PGlite fallback keeps working on hosts with a writable filesystem if you skip
`DATABASE_URL`.
