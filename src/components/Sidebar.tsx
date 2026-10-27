'use client';

import { useMemo, useState } from 'react';
import {
  Database,
  MessageSquarePlus,
  MessagesSquare,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionSummary, SystemPromptDto } from '@/lib/client-api';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

interface SidebarProps {
  sessions: SessionSummary[];
  activeId: string | null;
  prompts: SystemPromptDto[];
  activePromptId: string | null;
  provider: string;
  model: string;
  database: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onPromptChange: (promptId: string | null) => void;
  onClose: () => void;
}

export function Sidebar(props: SidebarProps) {
  const {
    sessions,
    activeId,
    prompts,
    activePromptId,
    provider,
    model,
    database,
    onSelect,
    onNew,
    onDelete,
    onPromptChange,
    onClose,
  } = props;
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-3">
        <MessagesSquare className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-semibold text-slate-100">
          Conversations
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
          aria-label="Close conversations"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 px-3 pt-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500/60 focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-500">
            {sessions.length === 0
              ? 'No conversations yet — start a new chat.'
              : 'No matches.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((s) => {
              const active = s.id === activeId;
              return (
                <li key={s.id}>
                  <div
                    className={cn(
                      'group flex items-center gap-1 rounded-xl px-2 py-2',
                      active
                        ? 'bg-slate-800/80'
                        : 'hover:bg-slate-900',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div
                        className={cn(
                          'truncate text-sm',
                          active ? 'text-slate-100' : 'text-slate-300',
                        )}
                      >
                        {s.title}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {timeAgo(s.updatedAt)}
                      </div>
                    </button>
                    {confirmDelete === s.id ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            onDelete(s.id);
                            setConfirmDelete(null);
                          }}
                          className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-500"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:bg-slate-800"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(s.id)}
                        className="shrink-0 rounded-lg p-1.5 text-slate-500 opacity-0 hover:bg-slate-800 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
                        aria-label={`Delete "${s.title}"`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-800 px-3 py-3">
        <label
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
          title="Extra instructions appended to Mike's core workspace persona"
        >
          <SlidersHorizontal className="h-3 w-3" />
          Instructions
        </label>
        <select
          value={activePromptId ?? ''}
          onChange={(e) => onPromptChange(e.target.value || null)}
          className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-2.5 py-2 text-sm text-slate-200 focus:border-indigo-500/60 focus:outline-none"
        >
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 pt-1 font-mono text-[11px] text-slate-500">
          <Database className="h-3 w-3" />
          <span className="truncate">
            {provider} · {model} · pg:{database}
          </span>
        </div>
      </div>
    </div>
  );
}
