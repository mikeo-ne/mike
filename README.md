# MIKE — Personal AI Assistant

MIKE is your hyper-organized executive personal assistant: a responsive chat UI backed
by Next.js + Node.js, an AI agent (OpenAI or Anthropic) with **function calling /
tool use**, and a Postgres database storing conversations, system prompts, calendar
events, and a tool-audit log. MIKE manages your calendar with extreme care — always
checking for conflicts before booking.

## Features

- **Responsive chat interface** — streaming replies, Markdown rendering, live tool-call
  cards, conversation sidebar, mobile drawers, dark UI.
- **AI agent with tools** — OpenAI function calling *or* Anthropic tool use behind one
  provider-agnostic agentic loop (multi-step: model → tools → model).
- **Calendar actions** — the agent can list, create, update, and delete calendar
  events, and build a **daily agenda**; booking tools report **conflicts** so MIKE
  warns before double-booking. A side panel shows the same data with a manual form.
- **System prompts** — MIKE's executive persona ships as the default, plus full CRUD;
  pick one per conversation.
- **Timezone-aware scheduling** — set your IANA timezone in Settings; MIKE resolves
  relative dates in it and emits accurate ISO 8601 date-times.
- **Secure Postgres schema** — parameterized queries only (Drizzle ORM), per-browser
  profile isolation via an `httpOnly` cookie, input validation with zod on every route.
- **Tool framework + REST gateway** — every tool is auto-exposed to the agent, to
  `GET /api/tools` (catalogue), and to `POST /api/tools/<name>` (audited execution).
- **Zero-config fallback DB** — without `DATABASE_URL`/`POSTGRES_URL` the app uses
  embedded PGlite (a real Postgres engine, file-backed) so it runs anywhere; point it
  at real Postgres in production with no code changes.
- **Demo mode** — with no API key configured, the app still runs end-to-end with
  rule-based replies and *real* tool execution.

## Quickstart

```bash
npm install
cp .env.example .env   # optional for demo mode
npm run dev            # http://localhost:3000
```

Open the app and try:

- `What does my schedule look like tomorrow morning?`
- `Book a lunch meeting with Sarah at 1 PM next Thursday.`
- `What can you do?`

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

Tables are created automatically on first boot (see `src/db/index.ts`, mirrored in
`drizzle/0001_init.sql`). To manage migrations explicitly:

```bash
npm run db:generate   # drizzle-kit generate (after editing src/db/schema.ts)
npm run db:push       # push to DATABASE_URL
```

## Architecture

```
Browser (React 18, Tailwind)
  │  SSE stream + JSON REST
  ▼
Next.js App Router (Node.js runtime)
  ├─ /api/chat                  streaming agent turns, transcript persistence
  ├─ /api/sessions[ /:id]       conversation CRUD
  ├─ /api/system-prompts[/:id]  prompt library CRUD
  ├─ /api/calendar/events[/:id] REST façade over calendar tools
  ├─ /api/tools (GET)           tool catalogue (name, description, JSON schema)
  └─ /api/tools/:name (POST)    generic audited tool-execution gateway
  ▼
Agent loop (src/lib/ai) ──► OpenAI Chat Completions  (function calling)
  multi-step, max AGENT_MAX_STEPS ──► Anthropic Messages (tool use)
  ▼ executes via registry
Tool registry (src/lib/tools) ──► Postgres (Drizzle ORM, parameterized)
  get_current_time, get_daily_agenda, list/create/update/delete_calendar_event
```

### Request flow for one chat turn

1. `POST /api/chat` validates input, resolves the profile cookie, loads/creates the
   session, resolves the system prompt, and loads bounded history.
2. The agent loop streams one provider step at a time; each `tool_call` is validated
   against its zod schema, executed profile-scoped, audit-logged, and fed back to the
   model until a text-only answer (or `AGENT_MAX_STEPS`).
3. SSE events (`session`, `text`, `tool_call`, `tool_result`, `done`, `error`) stream
   to the client; the full transcript (including tool calls/results) is persisted.

### Database schema

| Table | Purpose |
|---|---|
| `chat_sessions` | Conversations: owner `profile_id`, title, prompt ref, provider/model |
| `chat_messages` | Transcript rows: `user` / `assistant` (+`tool_calls` JSON) / `tool` results |
| `system_prompts` | Global seeds (`profile_id IS NULL`) + user prompts, one `is_default` |
| `profile_settings` | Per-profile preferences (timezone) injected into agent context |
| `calendar_events` | Profile-scoped events managed by agent tools and the UI |
| `calendar_connections` | Encrypted external OAuth tokens (Google), one row per profile+provider |
| `tool_executions` | Audit log: tool, args, result/error, duration, session |

## Adding a new tool

1. Create `src/lib/tools/<name>.ts`:

```ts
import { z } from 'zod';
import { defineTool } from './registry';

defineTool({
  name: 'my_tool',
  description: 'What it does (the model reads this).',
  parameters: z.object({
    input: z.string().describe('...'),
  }),
  execute: async (args, ctx) => {
    // ctx.profileId — scope all data access to it
    // ctx.sessionId — set when called from a chat turn
    return { ok: true };
  },
});
```

2. Import it from `src/lib/tools/index.ts`.

That's it — the tool is now available to the agent, listed at `GET /api/tools`, and
executable via `POST /api/tools/my_tool` (validated + audited).

## API reference

| Method & path | Description |
|---|---|
| `GET /api/health` | Provider/model, `demoMode`, `database` mode |
| `GET/POST /api/sessions` | List / create conversations |
| `GET/PATCH/DELETE /api/sessions/:id` | Conversation + transcript / update / delete |
| `POST /api/chat` | `{ sessionId?, content, systemPromptId? }` → SSE stream |
| `GET/POST /api/system-prompts` | List / create prompts |
| `PATCH/DELETE /api/system-prompts/:id` | Update / delete prompt |
| `GET/POST /api/calendar/events` | List (`?from&to&query&limit`) / create event |
| `PATCH/DELETE /api/calendar/events/:id` | Update / delete event |
| `GET/PATCH /api/settings` | Read / update profile settings (`{ timezone }`) |
| `GET /api/tools` | Tool catalogue with JSON schemas |
| `POST /api/tools/:name` | `{ args, sessionId? }` → `{ result }` |

SSE event examples from `/api/chat`:

```
data: {"type":"session","sessionId":"…"}
data: {"type":"tool_call","id":"call_…","name":"list_calendar_events","args":{…}}
data: {"type":"tool_result","id":"call_…","name":"list_calendar_events","result":{…}}
data: {"type":"text","delta":"Here's what's…"}
data: {"type":"done"}
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next.js lint |
| `npm run db:generate` / `db:push` | Drizzle schema workflow |

## Security notes

- No auth screen by design (personal single-user app), but all data is isolated per
  browser via a random `httpOnly`, `SameSite=Lax` (`Secure` in production) cookie.
- Every query is parameterized through Drizzle; no raw interpolated SQL.
- Every API input is validated with zod; tool arguments are re-validated at execution.
- API keys live only in server-side env vars — never shipped to the client.
- All tool invocations are recorded in `tool_executions` for review.

## Project structure

```
src/
  app/                    Next.js App Router: page, layout, /api/* routes
  components/             ChatInterface, Sidebar, Calendar/Prompts panels, …
  hooks/useAgentChat.ts   SSE streaming chat state hook
  lib/
    ai/                   provider adapters, agent loop, demo mode, config
    tools/                tool registry + time/calendar tools
    client-api.ts         typed fetch helpers (client-safe)
    profile.ts            anonymous profile cookie (server)
    utils.ts
  db/                     Drizzle schema, connection manager, seeds
drizzle/0001_init.sql     reference migration for externally-managed DBs
docker-compose.yml        local Postgres
```

## Google Calendar (OAuth)

MIKE's built-in calendar works out of the box. To also read and write a real
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
5. Open MIKE → side panel → **Settings → Connections → Connect Google Calendar**,
   and approve the consent screen.
6. Ask MIKE about *"my Google calendar"* — every calendar tool accepts
   `"calendar": "google"` (default `"local"`).

Tokens are AES-256-GCM encrypted at rest, scoped per profile, refreshed
automatically, and revocable anytime via **Disconnect** (which also revokes the
grant at Google). Only least-privilege scopes are requested (`openid email` +
`calendar.events`).

## Deployment

Any Node host works (Vercel, Fly, Render, VPS). Set `DATABASE_URL` to managed Postgres
and at least one provider key; run `npm run build && npm start`. The PGlite fallback
keeps working on hosts with a writable filesystem if you skip `DATABASE_URL`.
