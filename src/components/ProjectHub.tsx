'use client';

import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  FileText,
  FolderKanban,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, type WorkspaceItemDto } from '@/lib/client-api';
import { FileDropzone } from './FileDropzone';

const kindBadge: Record<string, string> = {
  project: 'bg-indigo-600/30 text-indigo-200',
  brief: 'bg-amber-600/30 text-amber-200',
};

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

/**
 * Project Hub — the right-side context panel where Mike's long-form output
 * lives: project summaries, action plans, briefs, and meeting notes, saved
 * via the summarizeProject / generateActionPlan tools so they never get lost
 * in the scrolling chat window.
 */
export function ProjectHub({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<WorkspaceItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: list } = await api.listWorkspace({ limit: 100 });
      setItems(
        list.filter((i) => i.kind === 'brief' || i.kind === 'project'),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the hub.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // If the open document changed upstream, keep the reader in sync.
  const openItem = openId ? (items.find((i) => i.id === openId) ?? null) : null;
  useEffect(() => {
    if (openId && !items.some((i) => i.id === openId) && !loading) {
      setOpenId(null);
    }
  }, [items, openId, loading]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1 pb-2">
        {openItem ? (
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Back to documents"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <FolderKanban className="h-4 w-4 text-indigo-400" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
          {openItem ? openItem.title : 'Project Hub'}
        </span>
        {!openItem && (
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Refresh Project Hub"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        )}
      </div>

      {!openItem && (
        <p className="px-1 pb-2 text-[11px] leading-relaxed text-slate-500">
          Long-form output from Mike — summaries, action plans, and briefs —
          saved here automatically.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </p>
        ) : openItem ? (
          <article className="md rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm leading-relaxed text-slate-100">
            <div className="mb-2 flex items-center gap-2">
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-medium capitalize',
                  kindBadge[openItem.kind] ?? kindBadge.brief,
                )}
              >
                {openItem.kind}
              </span>
              <span className="text-[11px] text-slate-500">
                Updated {timeAgo(openItem.updatedAt)}
              </span>
            </div>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {openItem.content || '_Empty document._'}
            </ReactMarkdown>
          </article>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 px-3 py-8 text-center">
            <FileText className="mx-auto h-6 w-6 text-slate-600" />
            <p className="mt-2 text-xs text-slate-400">
              No documents yet. Ask Mike to{' '}
              <span className="text-slate-200">“summarize a project”</span> or{' '}
              <span className="text-slate-200">“generate an action plan”</span>{' '}
              and it will land here.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(item.id)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left transition hover:border-indigo-500/50 hover:bg-slate-900"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium capitalize',
                        kindBadge[item.kind] ?? kindBadge.brief,
                      )}
                    >
                      {item.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                      {item.title}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                      {item.content
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 90) || '—'}
                    </p>
                    <span className="shrink-0 text-[11px] text-slate-600">
                      {timeAgo(item.updatedAt)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!openItem && (
        <div className="pt-2">
          <FileDropzone />
        </div>
      )}
    </div>
  );
}
