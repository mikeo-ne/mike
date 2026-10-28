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
  Mail,
  Megaphone,
  Menu,
  Mic,
  Music,
  Newspaper,
  PanelRight,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessageView, ChatStatus } from '@/hooks/useAgentChat';
import { useVoice } from '@/hooks/useVoice';
import { MessageBubble } from './MessageBubble';

const PROMPT_LIBRARY: Array<{
  category: string;
  icon: typeof FileText;
  prompts: string[];
}> = [
  {
    category: 'Press & bio',
    icon: Newspaper,
    prompts: [
      'Write a 150-word artist bio for [ARTIST], blending [GENRES] — highlight [KEY STORY].',
      'Write a press release for the single [SONG] by [ARTIST], out [DATE] on [LABEL].',
    ],
  },
  {
    category: 'Social content',
    icon: Megaphone,
    prompts: [
      'Write 3 TikTok captions for a studio clip of [SONG] (vibe: [VIBE]) with hashtags.',
      'Write an Instagram announcement post for [RELEASE] dropping [DATE].',
    ],
  },
  {
    category: 'Pitches',
    icon: Mail,
    prompts: [
      'Write a 120-word pitch email to a Spotify playlist curator for [SONG] by [ARTIST] (sounds like [REFERENCES]).',
      'Write a short pitch to a music blogger premiering [SONG] — angle: [ANGLE].',
    ],
  },
  {
    category: 'Releases',
    icon: Music,
    prompts: [
      'Write a streaming-platform song description for [SONG] by [ARTIST] ([GENRE], [MOOD]).',
      'Draft a 4-week rollout plan for [RELEASE] with timeline, content, and pitch targets.',
    ],
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
  agentName: string;
  onSend: (content: string) => void;
  onStop: () => void;
  onRetry: () => void;
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
    agentName,
    onSend,
    onStop,
    onRetry,
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

  const submitTextRef = useRef<(text: string) => void>(() => {});
  const voice = useVoice({
    onInterim: (text) => setDraft(text),
    onDictated: (text) => submitTextRef.current(text),
  });

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [messages, status]);

  // Read the reply aloud when a turn finishes (if voice replies are on).
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && voice.autoSpeak) {
      const last = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      const text = last?.content.trim();
      if (text) voice.speak(text);
    }
    wasBusy.current = busy;
  }, [busy, messages, voice]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = nearBottom;
    setShowScrollDown(!nearBottom && messages.length > 0);
  };

  const submitText = (text: string) => {
    const clean = text.trim();
    if (!clean || busy) return;
    voice.stopSpeaking();
    voice.stopListening();
    setDraft('');
    stickRef.current = true;
    if (inputRef.current) inputRef.current.style.height = 'auto';
    onSend(clean);
    requestAnimationFrame(() => scrollToBottom());
  };
  submitTextRef.current = submitText;

  const submit = () => submitText(draft);

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
              {agentName}
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
        <button
          type="button"
          onClick={() => voice.setAutoSpeak(!voice.autoSpeak)}
          disabled={!voice.supported.synthesis}
          className={cn(
            'ml-auto shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40',
            voice.autoSpeak && 'bg-indigo-600/20 text-indigo-200',
            voice.speaking && 'animate-pulse',
          )}
          aria-label={
            voice.autoSpeak ? 'Mute voice replies' : 'Unmute voice replies'
          }
          title={
            !voice.supported.synthesis
              ? 'Voice replies are not supported in this browser'
              : voice.autoSpeak
                ? 'Voice replies on — tap to mute'
                : `Voice replies off — tap for ${agentName} to read replies aloud`
          }
        >
          {voice.autoSpeak ? (
            <Volume2 className="h-5 w-5" />
          ) : (
            <VolumeX className="h-5 w-5" />
          )}
        </button>
        <span
          title="Secure data encryption keys — placeholder"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-slate-700 px-2 py-1.5 text-[11px] text-slate-500"
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
                Hi, I&apos;m {agentName}
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-400">
                Your music workspace assistant — projects, releases, and an
                AI team that speaks the industry. Pick a starting point:
              </p>
              <div className="mt-6 grid w-full max-w-lg gap-4 text-left">
                {PROMPT_LIBRARY.map((section) => (
                  <div key={section.category}>
                    <div className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <section.icon className="h-3.5 w-3.5 text-indigo-400" />
                      {section.category}
                    </div>
                    <div className="grid gap-2">
                      {section.prompts.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            setDraft(p);
                            requestAnimationFrame(() => {
                              const el = inputRef.current;
                              if (el) {
                                el.style.height = 'auto';
                                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                                el.focus();
                              }
                            });
                          }}
                          className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-left text-sm text-slate-200 transition hover:border-indigo-500/50 hover:bg-slate-900"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
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
                onClick={onRetry}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-red-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </button>
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
              placeholder={
                voice.listening
                  ? 'Listening… speak now'
                  : 'Message your assistant… (Enter to send, Shift+Enter for newline)'
              }
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() =>
                voice.listening
                  ? voice.stopListening()
                  : voice.startListening()
              }
              disabled={busy || !voice.supported.recognition}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40',
                voice.listening
                  ? 'animate-pulse bg-red-600 text-white hover:bg-red-500'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
              )}
              aria-label={voice.listening ? 'Stop listening' : 'Dictate a message'}
              title={
                voice.blockedReason ??
                (!voice.supported.recognition
                  ? 'Voice input is not supported in this browser — try Chrome or Edge'
                  : voice.listening
                    ? 'Tap to stop listening'
                    : 'Tap and speak — your words are sent automatically')
              }
            >
              <Mic className="h-4 w-4" />
            </button>
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
          {voice.voiceError && (
            <p className="mt-1.5 text-center text-[11px] text-amber-300">
              {voice.voiceError}
            </p>
          )}
          <p className="mt-1.5 text-center text-[11px] text-slate-500">
            {demoMode
              ? 'Demo mode — add OPENAI_API_KEY or ANTHROPIC_API_KEY to secrets for full AI.'
              : `${agentName} calls tools (calendar, tasks, projects). Long-form docs land in the Project Hub.`}
          </p>
        </div>
      </div>
    </div>
  );
}
