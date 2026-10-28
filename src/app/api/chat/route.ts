import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { streamText } from 'ai';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import {
  apiKeyFor,
  defaultModel,
  defaultProvider,
  fallbackModels,
  isRateLimitError,
  maxSteps,
  normalizeProvider,
  pickModel,
  reportRateLimit,
} from '@/lib/ai/config';
import { ONE_EXECUTIVE_PROMPT } from '@/lib/ai/executive';
import {
  buildSdkTools,
  resolveChatModel,
  toModelMessages,
} from '@/lib/ai/sdk';
import type { AgentMessage } from '@/lib/ai/types';
import '@/lib/tools';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { getProfilePreferences } from '@/lib/settings';
import { safeJson, truncate } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// The Vercel AI SDK `useChat` client sends `{ id, messages, sessionId?, ... }`.
// A legacy single-shot `{ content }` body is still accepted (curl, scripts).
const chatMessageSchema = z
  .object({ role: z.string(), content: z.string() })
  .passthrough();

const chatRequestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  systemPromptId: z.string().uuid().nullable().optional(),
  messages: z.array(chatMessageSchema).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
});

function rowToAgentMessage(row: typeof schema.conversations.$inferSelect): AgentMessage | null {
  if (row.role === 'user') return { role: 'user', content: row.content };
  if (row.role === 'assistant') {
    return {
      role: 'assistant',
      content: row.content,
      toolCalls: row.toolCalls ?? undefined,
    };
  }
  if (row.role === 'tool') {
    return {
      role: 'tool',
      content: row.content,
      toolName: row.toolName ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
    };
  }
  return null;
}

export async function POST(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  // The database is the source of truth for history — the client's messages
  // are only used to extract the newest user message (avoids duplication).
  let content: string | null = null;
  if (parsed.data.messages) {
    for (let i = parsed.data.messages.length - 1; i >= 0; i -= 1) {
      const m = parsed.data.messages[i];
      if (m.role === 'user' && m.content.trim()) {
        content = m.content.trim();
        break;
      }
    }
  }
  content ??= parsed.data.content ?? null;
  if (!content) {
    return Response.json(
      { error: 'No user message found in the request.' },
      { status: 400 },
    );
  }
  if (content.length > 20000) {
    return Response.json(
      { error: 'Message is too long (max 20000 characters).' },
      { status: 400 },
    );
  }

  const { db } = await getDb();

  // --- Resolve or create the session (strictly profile-scoped). ---
  let session: typeof schema.chatSessions.$inferSelect | null = null;
  if (parsed.data.sessionId) {
    const rows = await db
      .select()
      .from(schema.chatSessions)
      .where(
        and(
          eq(schema.chatSessions.id, parsed.data.sessionId),
          eq(schema.chatSessions.profileId, profileId),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      return Response.json({ error: 'Session not found.' }, { status: 404 });
    }
    session = rows[0];
  }
  const isNewSession = !session;
  if (!session) {
    const [created] = await db
      .insert(schema.chatSessions)
      .values({
        id: randomUUID(),
        profileId,
        title: truncate(content, 60) || 'New conversation',
        systemPromptId: parsed.data.systemPromptId ?? null,
        provider: defaultProvider(),
        model: null,
      })
      .returning();
    session = created;
  } else if (parsed.data.systemPromptId !== undefined) {
    const [updated] = await db
      .update(schema.chatSessions)
      .set({
        systemPromptId: parsed.data.systemPromptId,
        updatedAt: new Date(),
      })
      .where(eq(schema.chatSessions.id, session.id))
      .returning();
    session = updated;
  }
  const sessionId = session.id;

  // --- Resolve the selected additional-instructions prompt. ---
  let extraPrompt: { name: string; content: string } | null = null;
  const promptId = session.systemPromptId;
  if (promptId) {
    const rows = await db
      .select()
      .from(schema.systemPrompts)
      .where(eq(schema.systemPrompts.id, promptId))
      .limit(1);
    if (rows[0]) extraPrompt = { name: rows[0].name, content: rows[0].content };
  }
  if (!extraPrompt) {
    const rows = await db
      .select()
      .from(schema.systemPrompts)
      .where(eq(schema.systemPrompts.isDefault, true))
      .orderBy(desc(schema.systemPrompts.createdAt))
      .limit(1);
    if (rows[0]) extraPrompt = { name: rows[0].name, content: rows[0].content };
  }

  // --- Compose the system prompt: hardcoded 1ne core + live context. ---
  const prefs = await getProfilePreferences(profileId);
  const userTimezone = prefs.timezone;
  const contextBits: string[] = [];
  if (userTimezone) {
    contextBits.push(
      `User timezone: ${userTimezone}. Interpret relative dates ("tomorrow", "next Thursday") in this timezone and emit ISO 8601 date-times with the correct offset for it.`,
    );
  }
  if (prefs.schedulingRules) {
    contextBits.push(`User scheduling rules:\n${prefs.schedulingRules}`);
  }
  if (prefs.workdayStart || prefs.workdayEnd) {
    contextBits.push(
      `User workday: ${prefs.workdayStart ?? '…'}–${prefs.workdayEnd ?? '…'}. Prefer proposing slots inside it.`,
    );
  }
  if (prefs.preferredCalendar === 'google') {
    contextBits.push(
      'The user\'s preferred calendar is Google — default "calendar" parameters to "google" unless they say otherwise.',
    );
  }
  if (extraPrompt) {
    contextBits.push(
      `Additional instructions from the user's selected prompt ("${extraPrompt.name}"):\n${extraPrompt.content}`,
    );
  }
  if (prefs.systemInstructions) {
    contextBits.push(
      `Additional personal instructions:\n${prefs.systemInstructions}`,
    );
  }
  if (prefs.agentName && prefs.agentName !== '1ne') {
    contextBits.push(
      `The user calls you "${prefs.agentName}" — refer to yourself by that name.`,
    );
  }
  const system =
    contextBits.length > 0
      ? `${ONE_EXECUTIVE_PROMPT}\n\n[Live context]\n${contextBits.join('\n\n')}`
      : ONE_EXECUTIVE_PROMPT;

  // --- Load bounded history + persist the user message. ---
  const historyRows = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.sessionId, sessionId))
    .orderBy(asc(schema.conversations.createdAt))
    .limit(200);
  const history: AgentMessage[] = historyRows
    .map(rowToAgentMessage)
    .filter((m): m is AgentMessage => m !== null)
    .slice(-60);
  history.push({ role: 'user', content });
  await db.insert(schema.conversations).values({
    id: randomUUID(),
    sessionId,
    role: 'user',
    content,
  });

  // --- Provider / model resolution (missing key → streaming demo mode). ---
  const provider = normalizeProvider(session.provider || defaultProvider());
  const requested = session.model?.trim() || defaultModel(provider);
  // Route around models that recently hit a rate limit: each model gets its
  // own free-tier token bucket, so the backup usually answers immediately.
  const model = pickModel(requested, fallbackModels(provider, requested));
  const apiKey = apiKeyFor(provider);
  const steps = maxSteps();

  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: resolveChatModel(provider, model, apiKey),
      system,
      messages: toModelMessages(history),
      tools: buildSdkTools(
        {
          profileId,
          sessionId,
          timezone: userTimezone ?? null,
        },
        { disabled: prefs.disabledTools },
      ),
      maxSteps: steps,
      // Single attempt per model: a 429 cools that model down and the user's
      // retry routes onto the backup model instead of hammering the same one.
      maxRetries: 0,
      abortSignal: req.signal,
      onError: (event) => {
        if (isRateLimitError(event.error)) reportRateLimit(model);
      },
      onFinish: async (event) => {
        // Persist the produced transcript suffix (assistant + tool rows),
        // mirroring the pre-existing schema so history stays intact.
        try {
          const { db: db2 } = await getDb();
          for (const step of event.steps) {
            const calls = step.toolCalls.map((tc) => ({
              id: tc.toolCallId,
              name: tc.toolName,
              args: (tc.args ?? {}) as Record<string, unknown>,
            }));
            if (step.text || calls.length > 0) {
              await db2.insert(schema.conversations).values({
                id: randomUUID(),
                sessionId,
                role: 'assistant',
                content: step.text,
                toolCalls: calls.length > 0 ? calls : null,
                toolName: null,
                toolCallId: null,
              });
            }
            // Registry tools are dynamic, so the SDK types results as never —
            // the runtime shape is stable ({ toolCallId, toolName, result }).
            const results = step.toolResults as Array<{
              toolCallId: string;
              toolName: string;
              result: unknown;
            }>;
            for (const tr of results) {
              await db2.insert(schema.conversations).values({
                id: randomUUID(),
                sessionId,
                role: 'tool',
                content: safeJson(tr.result),
                toolCalls: null,
                toolName: tr.toolName,
                toolCallId: tr.toolCallId,
              });
            }
          }
          await db2
            .update(schema.chatSessions)
            .set({ updatedAt: new Date() })
            .where(eq(schema.chatSessions.id, sessionId));
        } catch (err) {
          console.error('Failed to persist chat transcript:', err);
        }
      },
    });
  } catch (err) {
    console.error('Agent run failed:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Agent run failed.' },
      { status: 500 },
    );
  }

  // The client (`useChat`) picks the session up from the response headers.
  const headers = new Headers();
  headers.set('X-Session-Id', sessionId);
  if (isNewSession) headers.set('X-Session-Created', '1');
  applyProfileCookie(headers, setCookie);
  return result.toDataStreamResponse({ headers });
}
