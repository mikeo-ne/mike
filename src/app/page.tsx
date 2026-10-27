'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  api,
  type HealthDto,
  type SessionSummary,
  type SystemPromptDto,
} from '@/lib/client-api';
import { useAgentChat } from '@/hooks/useAgentChat';
import { ChatInterface } from '@/components/ChatInterface';
import { Sidebar } from '@/components/Sidebar';
import { RightPanel } from '@/components/RightPanel';

export default function Home() {
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [prompts, setPrompts] = useState<SystemPromptDto[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  /** System prompt chosen for the *next* new chat. */
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [calendarNotice, setCalendarNotice] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Surfaces the Google OAuth result after redirecting back from /callback.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('calendar');
    if (status === 'google-connected') {
      setCalendarNotice({
        kind: 'ok',
        text: 'Google Calendar connected — Mike can now read and write it.',
      });
      setCalendarRefreshKey((k) => k + 1);
    } else if (status === 'google-error') {
      setCalendarNotice({
        kind: 'err',
        text: params.get('message') || 'Google Calendar connection failed.',
      });
    }
    if (status) {
      params.delete('calendar');
      params.delete('message');
      const q = params.toString();
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (q ? `?${q}` : ''),
      );
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api.listSessions());
    } catch {
      /* non-fatal */
    }
  }, []);

  const refreshPrompts = useCallback(async () => {
    try {
      setPrompts(await api.listPrompts());
    } catch {
      /* non-fatal */
    }
  }, []);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const defaultPromptId = useMemo(
    () => prompts.find((p) => p.isDefault)?.id ?? prompts[0]?.id ?? null,
    [prompts],
  );

  const effectivePromptId = activeSession
    ? (activeSession.systemPromptId ?? defaultPromptId)
    : (pendingPromptId ?? defaultPromptId);

  const chat = useAgentChat({
    sessionId: activeSessionId,
    systemPromptId: activeSessionId ? undefined : effectivePromptId,
    onSessionCreated: (id) => {
      setActiveSessionId((prev) => (prev === id ? prev : id));
      void refreshSessions();
    },
    onCalendarChanged: () => setCalendarRefreshKey((k) => k + 1),
    // Every finished turn may have created briefs, tasks, or events —
    // refresh the dashboard, hub, calendar, and session list together.
    onTurnFinished: () => {
      void refreshSessions();
      setCalendarRefreshKey((k) => k + 1);
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        setHealth(h);
        const [s, p] = await Promise.all([
          api.listSessions(),
          api.listPrompts(),
        ]);
        if (cancelled) return;
        setSessions(s);
        setPrompts(p);
      } catch (err) {
        if (!cancelled) {
          setHealthError(
            err instanceof Error ? err.message : 'Failed to reach the server.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Split-screen by default on wide displays: chat + Mike's Dashboard.
  useEffect(() => {
    try {
      if (window.matchMedia('(min-width: 1280px)').matches) {
        setPanelOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleSelectSession = useCallback(
    (id: string) => {
      setActiveSessionId(id);
      setSidebarOpen(false);
      void chat.loadSession(id);
    },
    [chat],
  );

  const handleNewChat = useCallback(() => {
    chat.startNew();
    setActiveSessionId(null);
    setSidebarOpen(false);
  }, [chat]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await api.deleteSession(id);
      } catch {
        /* still update UI */
      }
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (id === activeSessionId) {
        chat.startNew();
        setActiveSessionId(null);
      }
    },
    [activeSessionId, chat],
  );

  const handlePromptChange = useCallback(
    async (promptId: string | null) => {
      if (activeSessionId) {
        try {
          await api.patchSession(activeSessionId, {
            systemPromptId: promptId,
          } as Partial<SessionSummary>);
        } catch {
          /* non-fatal; list refresh will correct */
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId ? { ...s, systemPromptId: promptId } : s,
          ),
        );
      } else {
        setPendingPromptId(promptId);
      }
    },
    [activeSessionId],
  );

  const handleSend = useCallback(
    (content: string) => {
      chat.send(content);
    },
    [chat],
  );

  if (healthError) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-slate-950 px-4">
        <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <h1 className="text-lg font-semibold text-red-200">
            Couldn&apos;t reach the assistant server
          </h1>
          <p className="mt-2 text-sm text-red-200/80">{healthError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!health) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-slate-950">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Starting assistant…
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex h-[100dvh] overflow-hidden bg-slate-950 text-slate-100">
      {calendarNotice && (
        <div
          className={cn(
            'absolute left-1/2 top-3 z-50 flex max-w-[92%] -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-2.5 text-sm shadow-xl',
            calendarNotice.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/95 text-emerald-100'
              : 'border-red-500/40 bg-red-950/95 text-red-100',
          )}
        >
          <span className="flex-1">{calendarNotice.text}</span>
          <button
            type="button"
            onClick={() => setCalendarNotice(null)}
            className="rounded p-0.5 text-lg leading-none opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {/* Left sidebar — drawer on mobile, fixed column on lg+ */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-72 shrink-0 border-r border-slate-800 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar
          sessions={sessions}
          activeId={activeSessionId}
          prompts={prompts}
          activePromptId={effectivePromptId}
          provider={health.provider}
          model={health.model}
          database={health.database}
          onSelect={handleSelectSession}
          onNew={handleNewChat}
          onDelete={(id) => void handleDeleteSession(id)}
          onPromptChange={(id) => void handlePromptChange(id)}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Chat */}
      <ChatInterface
        messages={chat.messages}
        status={chat.status}
        loadingSession={chat.loadingSession}
        error={chat.error}
        demoMode={health.demoMode}
        provider={health.provider}
        model={health.model}
        onSend={handleSend}
        onStop={chat.stop}
        onClearError={chat.clearError}
        onOpenSidebar={() => setSidebarOpen(true)}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        panelOpen={panelOpen}
      />

      {/* Right panel — overlay drawer until xl, toggled column on xl+ */}
      {panelOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 xl:hidden"
          onClick={() => setPanelOpen(false)}
          aria-hidden
        />
      )}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-40 w-80 shrink-0 border-l border-slate-800 transition-transform duration-200 sm:w-96 xl:static xl:z-auto xl:w-96',
          panelOpen ? 'translate-x-0' : 'translate-x-full xl:hidden',
        )}
      >
        <RightPanel
          calendarRefreshKey={calendarRefreshKey}
          prompts={prompts}
          activePromptId={effectivePromptId}
          provider={health.provider}
          model={health.model}
          demoMode={health.demoMode}
          onSelectPrompt={(id) => void handlePromptChange(id)}
          onPromptsChanged={() => void refreshPrompts()}
          onClose={() => setPanelOpen(false)}
        />
      </div>
    </main>
  );
}
