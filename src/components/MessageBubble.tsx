'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Loader2,
  User,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessageView, ToolCallView } from '@/hooks/useAgentChat';

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  let text: string;
  try {
    text =
      typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  if (text.length > 4000) text = `${text.slice(0, 4000)}\n…(truncated)`;
  return (
    <div className="mt-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-slate-950/80 p-2 text-[11px] leading-relaxed text-slate-300">
        {text}
      </pre>
    </div>
  );
}

function ToolCallCard({ tool }: { tool: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const running = tool.status === 'running';
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border text-left',
        running
          ? 'border-indigo-500/40 bg-indigo-500/[0.07]'
          : 'border-slate-700/80 bg-slate-900/60',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        )}
        <Wrench className="h-3.5 w-3.5 text-slate-400" />
        <span className="font-mono font-medium text-slate-200">{tool.name}</span>
        <span className="text-slate-500">
          {running ? 'running…' : 'completed'}
        </span>
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 text-slate-500 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="border-t border-slate-700/60 px-3 pb-3">
          <JsonBlock label="Arguments" value={tool.args} />
          {tool.result !== undefined && (
            <JsonBlock label="Result" value={tool.result} />
          )}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message }: { message: ChatMessageView }) {
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm sm:max-w-[75%]">
          {message.content}
        </div>
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700">
          <User className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    );
  }

  const hasTools = message.toolCalls.length > 0;
  const hasText = message.content.trim().length > 0;
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600/90">
        <Bot className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0 max-w-[92%] flex-1 sm:max-w-[85%]">
        {hasTools && (
          <div className="mb-2 space-y-1.5">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} tool={tc} />
            ))}
          </div>
        )}
        {hasText ? (
          <div className="md rounded-2xl rounded-bl-md border border-slate-700/60 bg-slate-900/60 px-4 py-2.5 text-sm leading-relaxed text-slate-100">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
            {message.streaming && (
              <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-indigo-400 align-middle" />
            )}
          </div>
        ) : (
          message.streaming && (
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-700/60 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              {hasTools ? 'Working…' : 'Thinking…'}
            </div>
          )
        )}
      </div>
    </div>
  );
}
