'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useChat, type Message } from 'ai/react';
import type { DbMessageRow } from '@/lib/client-api';
import { api } from '@/lib/client-api';

export interface ToolCallView {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done';
}

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallView[];
  streaming?: boolean;
}

type Invocation = NonNullable<Message['toolInvocations']>[number];

/** Tools whose results should refresh calendar surfaces immediately. */
const CALENDAR_MUTATION_TOOLS = new Set([
  'create_calendar_event',
  'update_calendar_event',
  'delete_calendar_event',
  'modify_calendar_schedule',
]);

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

/** Groups raw DB rows (user / assistant / tool) into AI SDK messages. */
export function dbRowsToMessages(rows: DbMessageRow[]): Message[] {
  const ordered = [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const messages: Message[] = [];
  const invIndex = new Map<string, Invocation>();
  const assistantIndex = new Map<string, Message>();

  for (const row of ordered) {
    if (row.role === 'user') {
      messages.push({ id: row.id, role: 'user', content: row.content });
    } else if (row.role === 'assistant') {
      const toolInvocations: Invocation[] = (row.toolCalls ?? []).map((tc) => {
        const inv: Invocation = {
          state: 'call',
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.args ?? {},
        };
        invIndex.set(tc.id, inv);
        return inv;
      });
      const msg: Message = {
        id: row.id,
        role: 'assistant',
        content: row.content,
        ...(toolInvocations.length > 0 ? { toolInvocations } : {}),
      };
      assistantIndex.set(row.id, msg);
      messages.push(msg);
    } else if (row.role === 'tool') {
      const result = parseToolResult(row.content);
      const existing =
        row.toolCallId != null ? invIndex.get(row.toolCallId) : undefined;
      if (existing && existing.state !== 'result') {
        const done: Invocation = {
          state: 'result',
          toolCallId: existing.toolCallId,
          toolName: existing.toolName,
          args: 'args' in existing ? existing.args : {},
          result,
        };
        invIndex.set(done.toolCallId, done);
        for (const msg of messages) {
          if (!msg.toolInvocations) continue;
          const i = msg.toolInvocations.findIndex(
            (t) => t.toolCallId === done.toolCallId,
          );
          if (i >= 0) msg.toolInvocations[i] = done;
        }
      } else {
        // Orphaned tool row (e.g. aborted run): attach to the last assistant
        // message so the transcript stays visible and coherent.
        const lastAssistant = [...messages]
          .reverse()
          .find((m) => m.role === 'assistant');
        if (lastAssistant) {
          const inv: Invocation = {
            state: 'result',
            toolCallId: row.toolCallId ?? row.id,
            toolName: row.toolName ?? 'tool',
            args: {},
            result,
          };
          lastAssistant.toolInvocations = [
            ...(lastAssistant.toolInvocations ?? []),
            inv,
          ];
        }
      }
    }
  }
  return messages;
}

/** Maps AI SDK messages to the views rendered by MessageBubble. */
export function messagesToViews(
  messages: Message[],
  streamingId: string | null,
): ChatMessageView[] {
  const views: ChatMessageView[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      views.push({ id: m.id, role: 'user', content: m.content, toolCalls: [] });
    } else if (m.role === 'assistant') {
      views.push({
        id: m.id,
        role: 'assistant',
        content: m.content,
        toolCalls: (m.toolInvocations ?? []).map((t) => ({
          id: t.toolCallId,
          name: t.toolName,
          args: (t.args ?? {}) as Record<string, unknown>,
          result: t.state === 'result' ? t.result : undefined,
          status: t.state === 'result' ? ('done' as const) : ('running' as const),
        })),
        streaming: streamingId === m.id,
      });
    }
  }
  return views;
}

export type ChatStatus = 'idle' | 'loading' | 'streaming';

interface UseAgentChatOptions {
  /** Active session id (null = draft). Sent with every chat request. */
  sessionId: string | null;
  /** System prompt for the next new chat (ignored for existing sessions). */
  systemPromptId?: string | null;
  onSessionCreated?: (sessionId: string) => void;
  onCalendarChanged?: () => void;
  onTurnFinished?: () => void;
}

export function useAgentChat(opts: UseAgentChatOptions) {
  const [loadingSession, setLoadingSession] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const chat = useChat({
    api: '/api/chat',
    id: opts.sessionId ?? 'draft',
    // `body` is read fresh for every request, so session switches and new
    // sessions created mid-conversation are picked up automatically.
    body: {
      sessionId: opts.sessionId ?? undefined,
      systemPromptId: opts.systemPromptId ?? undefined,
    },
    onResponse: (res) => {
      const sid = res.headers.get('X-Session-Id');
      if (sid) optsRef.current.onSessionCreated?.(sid);
    },
    onFinish: (message) => {
      const names = (message.toolInvocations ?? []).map((t) => t.toolName);
      if (names.some((n) => CALENDAR_MUTATION_TOOLS.has(n))) {
        optsRef.current.onCalendarChanged?.();
      }
      optsRef.current.onTurnFinished?.();
    },
    onError: () => {
      optsRef.current.onTurnFinished?.();
    },
  });

  const status: ChatStatus =
    chat.status === 'streaming'
      ? 'streaming'
      : chat.status === 'submitted'
        ? 'loading'
        : 'idle';

  const streamingId =
    chat.status === 'streaming' && chat.messages.length > 0
      ? (chat.messages[chat.messages.length - 1].role === 'assistant'
          ? chat.messages[chat.messages.length - 1].id
          : null)
      : null;

  const messages = useMemo(
    () => messagesToViews(chat.messages, streamingId),
    [chat.messages, streamingId],
  );

  const send = useCallback(
    (content: string) => {
      const text = content.trim();
      if (!text || chat.isLoading) return;
      setErrorDismissed(false);
      setLoadError(null);
      void chat.append({ role: 'user', content: text });
    },
    [chat],
  );

  const stop = useCallback(() => {
    chat.stop();
  }, [chat]);

  const startNew = useCallback(() => {
    chat.stop();
    chat.setMessages([]);
    setLoadError(null);
    setErrorDismissed(false);
  }, [chat]);

  const loadSession = useCallback(
    async (sessionId: string) => {
      chat.stop();
      setLoadingSession(true);
      setLoadError(null);
      setErrorDismissed(false);
      try {
        const { messages: rows } = await api.getSession(sessionId);
        chat.setMessages(dbRowsToMessages(rows));
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load session.',
        );
        chat.setMessages([]);
      } finally {
        setLoadingSession(false);
      }
    },
    [chat],
  );

  const rawError = errorDismissed ? null : (chat.error?.message ?? loadError);
  const friendlyError =
    rawError && /rate.?limit|429|too many requests/i.test(rawError)
      ? "Mike hit Groq's free speed limit — wait about 20 seconds, then tap Retry."
      : rawError;

  return {
    messages,
    status,
    loadingSession,
    error: friendlyError,
    send,
    stop,
    retry: () => {
      void chat.reload();
    },
    loadSession,
    startNew,
    clearError: () => setErrorDismissed(true),
  };
}
