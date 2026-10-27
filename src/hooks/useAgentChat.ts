'use client';

import { useCallback, useRef, useState } from 'react';
import type { DbMessageRow } from '@/lib/client-api';
import { api } from '@/lib/client-api';
import type { StreamEvent } from '@/lib/ai/types';

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

let clientId = 0;
const nextId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${(clientId += 1)}`;

/** Groups raw DB rows (user / assistant / tool) into UI message views. */
export function dbRowsToViews(rows: DbMessageRow[]): ChatMessageView[] {
  const views: ChatMessageView[] = [];
  const toolIndex = new Map<string, ToolCallView>();
  for (const row of rows) {
    if (row.role === 'user') {
      views.push({
        id: row.id,
        role: 'user',
        content: row.content,
        toolCalls: [],
      });
    } else if (row.role === 'assistant') {
      const toolCalls: ToolCallView[] = (row.toolCalls ?? []).map((tc) => {
        const view: ToolCallView = {
          id: tc.id,
          name: tc.name,
          args: tc.args ?? {},
          status: 'done',
        };
        toolIndex.set(tc.id, view);
        return view;
      });
      views.push({ id: row.id, role: 'assistant', content: row.content, toolCalls });
    } else if (row.role === 'tool') {
      let result: unknown = row.content;
      try {
        result = JSON.parse(row.content);
      } catch {
        /* keep raw text */
      }
      const existing = row.toolCallId ? toolIndex.get(row.toolCallId) : undefined;
      if (existing) {
        existing.result = result;
        existing.status = 'done';
      } else {
        const lastAssistant = [...views]
          .reverse()
          .find((v) => v.role === 'assistant');
        if (lastAssistant) {
          lastAssistant.toolCalls.push({
            id: row.toolCallId ?? row.id,
            name: row.toolName ?? 'tool',
            args: {},
            result,
            status: 'done',
          });
        }
      }
    }
  }
  return views;
}

export type ChatStatus = 'idle' | 'loading' | 'streaming';

interface UseAgentChatOptions {
  onSessionCreated?: (sessionId: string) => void;
  onCalendarChanged?: () => void;
  onTurnFinished?: () => void;
}

export function useAgentChat(opts: UseAgentChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [loadingSession, setLoadingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const startNew = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStatus('idle');
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    abortRef.current?.abort();
    setLoadingSession(true);
    setError(null);
    try {
      const { messages: rows } = await api.getSession(sessionId);
      setMessages(dbRowsToViews(rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session.');
      setMessages([]);
    } finally {
      setLoadingSession(false);
    }
  }, []);

  const send = useCallback(
    async (
      content: string,
      sendOpts?: { sessionId?: string | null; systemPromptId?: string | null },
    ) => {
      const text = content.trim();
      if (!text || status !== 'idle') return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setStatus('loading');
      setMessages((prev) => [
        ...prev,
        { id: nextId('u'), role: 'user', content: text, toolCalls: [] },
      ]);

      const assistantId = nextId('a');
      const ensureAssistant = () =>
        setMessages((prev) => {
          if (prev.some((m) => m.id === assistantId)) return prev;
          return [
            ...prev,
            {
              id: assistantId,
              role: 'assistant',
              content: '',
              toolCalls: [],
              streaming: true,
            },
          ];
        });
      const patchAssistant = (
        patch: (m: ChatMessageView) => ChatMessageView,
      ) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? patch(m) : m)),
        );

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            sessionId: sendOpts?.sessionId ?? undefined,
            content: text,
            systemPromptId: sendOpts?.systemPromptId ?? undefined,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            typeof data.error === 'string'
              ? data.error
              : `Chat request failed (${res.status})`,
          );
        }

        setStatus('streaming');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;

        const handleEvent = (event: StreamEvent) => {
          switch (event.type) {
            case 'session':
              optsRef.current.onSessionCreated?.(event.sessionId);
              break;
            case 'notice':
              break; // informational only
            case 'text':
              ensureAssistant();
              patchAssistant((m) => ({ ...m, content: m.content + event.delta }));
              break;
            case 'tool_call':
              ensureAssistant();
              patchAssistant((m) => ({
                ...m,
                toolCalls: [
                  ...m.toolCalls,
                  {
                    id: event.id,
                    name: event.name,
                    args: event.args ?? {},
                    status: 'running' as const,
                  },
                ],
              }));
              break;
            case 'tool_result':
              patchAssistant((m) => ({
                ...m,
                toolCalls: m.toolCalls.map((tc) =>
                  tc.id === event.id
                    ? { ...tc, result: event.result, status: 'done' as const }
                    : tc,
                ),
              }));
              if (
                event.name === 'create_calendar_event' ||
                event.name === 'update_calendar_event' ||
                event.name === 'delete_calendar_event'
              ) {
                optsRef.current.onCalendarChanged?.();
              }
              break;
            case 'done':
              finished = true;
              break;
            case 'error':
              throw new Error(event.message);
          }
        };

        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload) continue;
              try {
                handleEvent(JSON.parse(payload) as StreamEvent);
              } catch (err) {
                if (err instanceof Error && controller.signal.aborted) break;
                throw err;
              }
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // Keep partial content; mark stream finished.
        } else {
          const message =
            err instanceof Error ? err.message : 'Something went wrong.';
          setError(message);
          // Remove the empty assistant placeholder on hard failure.
          setMessages((prev) =>
            prev.filter((m) => {
              if (m.id !== assistantId) return true;
              return m.content.length > 0 || m.toolCalls.length > 0;
            }),
          );
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
        setStatus('idle');
        optsRef.current.onTurnFinished?.();
      }
    },
    [status],
  );

  return {
    messages,
    status,
    loadingSession,
    error,
    send,
    stop,
    loadSession,
    startNew,
    clearError: () => setError(null),
  };
}
