# Mike — Workspace AI Assistant

Mike is your strategic personal workspace assistant in the style of FYI.AI: a
split-screen web app with a streaming chat window and a real-time
**Mike's Dashboard** (schedule + tasks + **Project Hub**), an AI agent (OpenAI,
Anthropic, or any OpenAI-compatible provider) with agentic tools, long-term
memory in Postgres, and a webhook relay for real scheduling updates.

Instead of just reacting, Mike coaches you like a digital business coach:
organizing chaotic ideas, cross-referencing project deadlines with your
calendar, pointing out conflicts, generating action plans with tracked tasks,
and saving long-form documents to the Project Hub so they never get lost in
chat.

## Features

- **Split-screen UI** — chat on one side, **Mike's Dashboard** on the other:
  live today-view (now/up-next, conflict warnings, 60s auto-refresh),
  **Project Hub** (generated summaries, action plans, briefs + file staging),
  active tasks with checkboxes, full calendar, workspace notes, prompt library,
  and settings. Responsive with mobile drawers.
- **Workspace coach persona** — hardcoded strategic persona
  (`src/lib/ai/executive.ts`) plus your timezone, scheduling rules, workday
  bounds, and personal instructions, composed fresh on every turn. Concise,
  professional, deeply actionable.
- **Agentic tools** (Vercel AI SDK `streamText` + multi-step tool loop) —
  structured function calling / tool use:
  `get_calendar_schedule` (day/week/month timelines),
  `modify_calendar_schedule` (create/reschedule/update/delete),
  `get_project_context` (workspace memory), `get_daily_agenda`, `manage_tasks`,
  `summarizeProject` (status summaries → Project Hub),
  `generateActionPlan` (dated plans + tracked tasks → Project Hub),
  `get_current_time`, plus per-action calendar tools.
- **Project Hub** — every `summarizeProject` / `generateActionPlan` run saves
  its long-form document as a brief; the Hub lists, previews, and renders them
  in Markdown, with a drag-and-drop zone staging files for future ingestion.
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
- **Demo mode** — no API key? A streaming mock model explains the setup and
  echoes your message so the UI is fully clickable.

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
deadline — ask Mike to `summarize it` or `generate an action plan` and watch
the document land in the **Hub** tab while he cross-references your calendar.

### Enable full AI

Paste keys into your host's **Secrets Management** panel (e.g. Arena secrets), or set
them in `.env` for local development:

```env
AI_PROVIDER=openai            # or: anthropic
AI_MODEL=                   # optional override (defaults: gpt-4o-mini / claude-sonnet-4-20250514)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

#### $0 option — free AI (no credit card)

Mike speaks the OpenAI API format, so any OpenAI-compatible provider works via
`OPENAI_BASE_URL` (key goes in `OPENAI_API_KEY`, model in `AI_MODEL`):

- **Groq free tier** (recommended): sign up at groq.com → API Keys → create one
  (starts with `gsk-...`, no card required). Then:
  ```env
  AI_PROVIDER=openai
  OPENAI_BASE_URL=https://api.groq.com/openai/v1
  OPENAI_API_KEY=gsk-...
  AI_MODEL=openai/gpt-oss-120b
  ```
  Free limits reset daily — plenty for personal use. (Groq retired the old
  `llama-3.3-70b-versatile` in August 2026; `openai/gpt-oss-120b` is their
  recommended replacement — see console.groq.com for the current model list.)
- **OpenRouter free models**: openrouter.ai → key (`sk-or-...`), then
  `OPENAI_BASE_URL=https://openrouter.ai/api/v1` with a `:free` model from
  their current model list.
- **Ollama (local, fully offline)**: install Ollama, run
  `ollama pull llama3.1`, then `OPENAI_BASE_URL=http://localhost:11434/v1`,
  `OPENAI_API_KEY=ollama`, `AI_MODEL=llama3.1`.

Database, Google OAuth, and hosting all have free tiers too (PGlite is built
in, Google Calendar API costs nothing at personal scale, Vercel/Render host
free) — so Mike runs end-to-end for $0.

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
Browser (React 18, Tailwind, Vercel AI SDK useChat)
  split-screen: chat + Mike's Dashboard (today, hub, calendar, workspace…)
  │  AI data stream + JSON REST
  ▼
Next.js App Router (Node.js runtime)
  ├─ /api/chat                  streaming agent turns (Mike core + live context)
  ├─ /api/sessions[ /:id]       conversation threads + transcripts
  ├─ /api/system-prompts[/:id]  additional-instructions library
  ├─ /api/workspace[/:id]       notes / projects / guidelines / briefs (Hub feed)
  ├─ /api/tasks[/:id]           task list CRUD
  ├─ /api/calendar/events[/:id] local event CRUD (local|google routing)
  ├─ /api/calendar/agenda       daily agenda (dashboard feed)
  ├─ /api/calendar/webhook      payload relay → CALENDAR_WEBHOOK_URL / mock
  ├─ /api/calendar/google/*     OAuth connect/callback + connections
  ├─ /api/tools (GET)           tool catalogue (name, description, JSON schema)
  └─ /api/tools/:name (POST)    generic audited tool-execution gateway
  ▼
streamText agentic loop (Vercel AI SDK, max AGENT_MAX_STEPS)
  ├─► OpenAI-compatible chat model (function calling; OPENAI_BASE_URL → Groq/…)
  ├─► Anthropic Messages (tool use)
  └─► streaming demo mock when no API key is configured
  ▼ tools execute via registry (zod-validated, profile-scoped, audited)
Tool registry (src/lib/tools) ──► Postgres (Drizzle ORM, parameterized)
  get_calendar_schedule, modify_calendar_schedule, get_project_context,
  manage_tasks, summarizeProject, generateActionPlan, get_daily_agenda,
  list/create/update/delete_calendar_event, get_current_time
  ▼ mutations also fan out to CALENDAR_WEBHOOK_URL (fire-and-forget)
```

### Request flow for one chat turn

1. `POST /api/chat` accepts the `useChat` body (`{ messages, sessionId?,
   systemPromptId? }`, plus a legacy `{ content }` single-shot form), resolves
   the profile, loads/creates the session, loads preferences + selected
   instructions, and composes the system prompt: **Mike's hardcoded core +
   live context** (timezone, rules, workday, preferred calendar,
   instructions).
2. `streamText` runs the multi-step agentic loop (up to `AGENT_MAX_STEPS`):
   each tool call is validated against its zod schema, executed
   profile-scoped, audit-logged, and fed back until a text answer is produced.
   Calendar mutations also POST their payload to the webhook relay.
3. The AI data stream (`0:` text deltas, tool-call/tool-result parts, finish
   parts) streams to `useChat`; the session id travels in the `X-Session-Id`
   response header and the full transcript lands in `conversations` via
   `onFinish`.

### Database schema

| Table | Purpose |
|---|---|
| `chat_sessions` | Conversation threads: owner, title, prompt ref, provider/model |
| `conversations` | Message logs with metadata: `user` / `assistant` (+`tool_calls`) / `tool` |
| `system_prompts` | Global seeds + user instructions appended to Mike's core |
| `user_preferences` | Timezone, scheduling rules, workday, preferred calendar, instructions |
| `workspace_context` | Notes, projects, guidelines, briefs (Hub feed + Mike's memory) |
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

That's it — the tool is now available to Mike's agentic loop, listed at
`GET /api/tools`, and executable via `POST /api/tools/my_tool`
(`{ args }`, validated + audited).

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
| `POST /api/chat` | `useChat` body (`{ messages, sessionId?, systemPromptId? }`) → AI data stream + `X-Session-Id`; legacy `{ content }` also accepted |
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

The `/api/chat` stream follows the Vercel AI SDK v4 data-stream protocol
(`f:` message id, `0:` text deltas, `9:`/`a:` tool-call/result parts, `e:`/`d:`
finish parts) — see `src/lib/ai/sdk.ts` and `src/hooks/useAgentChat.ts`.

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
  components/             Chat, Dashboard, ProjectHub, FileDropzone, Calendar/… panels
  hooks/useAgentChat.ts   useChat wrapper: views, transcript loading, refresh hooks
  lib/
    ai/                   workspace persona, AI SDK wiring, provider config, types
    tools/                tool registry + time/calendar/agenda/schedule/workspace/tasks/projects
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
