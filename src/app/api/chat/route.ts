import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { runAgent } from '@/lib/ai/agent';
import {
  apiKeyFor,
  defaultModel,
  defaultProvider,
  maxSteps,
  normalizeProvider,
} from '@/lib/ai/config';
import { runDemoAgent } from '@/lib/ai/demo';
import {
  encodeStreamEvent,
  type AgentMessage,
  type StreamEvent,
} from '@/lib/ai/types';
import '@/lib/tools';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';
import { getProfileTimezone } from '@/lib/settings';
import { truncate } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const chatRequestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(20000),
  systemPromptId: z.string().uuid().nullable().optional(),
});

function rowToAgentMessage(row: typeof schema.chatMessages.$inferSelect): AgentMessage | null {
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
  const { content } = parsed.data;

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

  // --- Resolve the system prompt: session choice → default → none. ---
  let system: string | null = null;
  if (session.systemPromptId) {
    const rows = await db
      .select()
      .from(schema.systemPrompts)
      .where(eq(schema.systemPrompts.id, session.systemPromptId))
      .limit(1);
    system = rows[0]?.content ?? null;
  }
  if (!system) {
    const rows = await db
      .select()
      .from(schema.systemPrompts)
      .where(eq(schema.systemPrompts.isDefault, true))
      .orderBy(desc(schema.systemPrompts.createdAt))
      .limit(1);
    system = rows[0]?.content ?? null;
  }

  // --- User timezone context (drives ISO accuracy for relative dates). ---
  const userTimezone = await getProfileTimezone(profileId);
  if (system && userTimezone) {
    system += `\n\n[Context: the user's timezone is ${userTimezone}. Interpret relative dates ("tomorrow", "next Thursday") in this timezone and emit ISO 8601 date-times with the correct offset for it.]`;
  }

  // --- Load bounded history + persist the user message. ---
  const historyRows = await db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionId, sessionId))
    .orderBy(asc(schema.chatMessages.createdAt))
    .limit(200);
  const history: AgentMessage[] = historyRows
    .map(rowToAgentMessage)
    .filter((m): m is AgentMessage => m !== null)
    .slice(-60);
  history.push({ role: 'user', content });
  await db.insert(schema.chatMessages).values({
    id: randomUUID(),
    sessionId,
    role: 'user',
    content,
  });

  // --- Provider / model resolution. ---
  const provider = normalizeProvider(session.provider || defaultProvider());
  const model = session.model?.trim() || defaultModel(provider);
  const apiKey = apiKeyFor(provider);
  const demoMode = !apiKey;
  const steps = maxSteps();
  const signal = req.signal;

  // --- Stream the agent run as SSE, persisting the transcript after. ---
  const produced: AgentMessage[] = [];
  let persistDone = false;

  const persist = async () => {
    if (persistDone) return;
    persistDone = true;
    try {
      const { db: db2 } = await getDb();
      for (const m of produced) {
        await db2.insert(schema.chatMessages).values({
          id: randomUUID(),
          sessionId,
          role: m.role,
          content: m.content ?? '',
          toolCalls: m.toolCalls ?? null,
          toolName: m.toolName ?? null,
          toolCallId: m.toolCallId ?? null,
        });
      }
      await db2
        .update(schema.chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(schema.chatSessions.id, sessionId));
    } catch (err) {
      console.error('Failed to persist chat transcript:', err);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeStreamEvent(event)));
        } catch {
          /* client disconnected */
        }
      };
      try {
        emit({ type: 'session', sessionId });
        if (isNewSession) {
          // Let the client refresh its session list with the new title.
          emit({ type: 'notice', message: `session-created:${sessionId}` });
        }
        if (demoMode) {
          emit({
            type: 'notice',
            message:
              `No API key configured for ${provider} — running in demo mode with real tools.`,
          });
          const out = await runDemoAgent(
            content,
            { profileId, sessionId, timezone: userTimezone },
            emit,
            signal,
          );
          produced.push(...out);
        } else {
          const { produced: out } = await runAgent(
            {
              provider,
              model,
              apiKey: apiKey as string,
              system,
              history,
              toolContext: { profileId, sessionId, timezone: userTimezone },
              maxSteps: steps,
              signal,
            },
            emit,
          );
          produced.push(...out);
        }
        await persist();
        emit({ type: 'done' });
      } catch (err) {
        if (signal.aborted) {
          await persist();
        } else {
          const message =
            err instanceof Error ? err.message : 'Agent run failed.';
          console.error('Agent run failed:', err);
          await persist();
          emit({ type: 'error', message });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      void persist();
    },
  });

  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  applyProfileCookie(headers, setCookie);
  return new Response(stream, { headers });
}
