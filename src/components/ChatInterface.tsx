'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  CalendarDays,
  FileText,
  FlaskConical,
  KeyRound,
  ListChecks,
  Loader2,
  Menu,
  PanelRight,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessageView, ChatStatus } from '@/hooks/useAgentChat';
import { MessageBubble } from './MessageBubble';

const SUGGESTIONS = [
  {
    icon: FileText,
    label: 'Summarize Project Apollo and save it to the hub',
  },
  {
    icon: ListChecks,
    label: 'Generate an action plan for the product launch',
  },
  {
    icon: CalendarDays,
    label: "What's on my calendar this week?",
  },
];

interface ChatInterfaceProps {
  messages: ChatMessageView[];
  status: ChatStatus;
  loadingSession: boolean;
  error: string | null;
  demoMode: boolean;
  provider: string;
  model: string;
  onSend: (content: string) => void;
  onStop: () => void;
  onClearError: () => void;
  onOpenSidebar: () => void;
  onTogglePanel: () => void;
  panelOpen: boolean;
}

export function ChatInterface(props: ChatInterfaceProps) {
  const {
    messages,
    status,
    loadingSession,
    error,
    demoMode,
    provider,
    model,
    onSend,
    onStop,
    onClearError,
    onOpenSidebar,
    onTogglePanel,
    panelOpen,
  } = props;
  const [draft, setDraft] = useState('');
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status !== 'idle';

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [messages, status]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = nearBottom;
    setShowScrollDown(!nearBottom && messages.length > 0);
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    stickRef.current = true;
    if (inputRef.current) inputRef.current.style.height = 'auto';
    onSend(text);
    requestAnimationFrame(() => scrollToBottom());
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/80 px-3 py-2.5 backdrop-blur sm:px-4">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
          aria-label="Open conversations"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold leading-tight tracking-tight text-slate-50">
              Mike
            </div>
            <div
              className="flex items-center gap-1.5 text-[11px] text-slate-400"
              title={`${provider} · ${model}`}
            >
              <span className="truncate">Workspace AI Assistant</span>
              {demoMode && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-px font-medium text-amber-300">
                  <FlaskConical className="h-3 w-3" />
                  demo
                </span>
              )}
            </div>
          </div>
        </div>
        <span
          title="Secure data encryption keys — placeholder"
          className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-slate-700 px-2 py-1.5 text-[11px] text-slate-500"
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">keys</span>
        </span>
        <button
          type="button"
          onClick={onTogglePanel}
          className={cn(
            'rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100',
            panelOpen && 'bg-slate-800 text-slate-100',
          )}
          aria-label="Toggle side panel"
        >
          <PanelRight className="h-5 w-5" />
        </button>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      >
        <div className="mx-auto w-full max-w-3xl space-y-4 pb-2">
          {loadingSession ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading conversation…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-10 text-center sm:py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-950">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-slate-100">
                Hi, I&apos;m Mike
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-400">
                Your strategic workspace assistant — I coach, organize,
                schedule, and track every action item to done.
              </p>
              <div className="mt-6 grid w-full max-w-lg gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => onSend(s.label)}
                    className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-left text-sm text-slate-200 transition hover:border-indigo-500/50 hover:bg-slate-900"
                  >
                    <s.icon className="h-4 w-4 shrink-0 text-indigo-400" />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={onClearError}
                className="rounded p-0.5 hover:bg-red-500/20"
                aria-label="Dismiss error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {showScrollDown && (
          <button
            type="button"
            onClick={() => {
              stickRef.current = true;
              scrollToBottom(true);
            }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-300 shadow-lg hover:bg-slate-800"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 bg-slate-950/80 px-3 py-3 sm:px-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-slate-700 bg-slate-900 p-2 focus-within:border-indigo-500/60">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Message your assistant… (Enter to send, Shift+Enter for newline)"
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-slate-100 hover:bg-slate-600"
                aria-label="Stop generating"
                title="Stop"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send message"
                title="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-slate-500">
            {demoMode
              ? 'Demo mode — add OPENAI_API_KEY or ANTHROPIC_API_KEY to secrets for full AI.'
              : 'Mike calls tools (calendar, tasks, projects). Long-form docs land in the Project Hub.'}
          </p>
        </div>
      </div>
    </div>
  );
}
