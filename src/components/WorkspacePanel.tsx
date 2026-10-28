'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  api,
  type WorkspaceItemDto,
  type WorkspaceKind,
} from '@/lib/client-api';

const KINDS: Array<{ id: WorkspaceKind | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'note', label: 'Notes' },
  { id: 'project', label: 'Projects' },
  { id: 'guideline', label: 'Guidelines' },
  { id: 'brief', label: 'Briefs' },
];

const kindBadge: Record<string, string> = {
  note: 'bg-slate-700 text-slate-200',
  project: 'bg-indigo-600/30 text-indigo-200',
  guideline: 'bg-emerald-600/30 text-emerald-200',
  brief: 'bg-amber-600/30 text-amber-200',
};

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/60 focus:outline-none';

export function WorkspacePanel({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<WorkspaceItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<WorkspaceKind | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<WorkspaceKind>('note');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: list } = await api.listWorkspace({ limit: 100 });
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setTitle('');
    setKind('note');
    setContent('');
    setFormError(null);
  };

  const startEdit = (item: WorkspaceItemDto) => {
    setEditingId(item.id);
    setShowForm(true);
    setTitle(item.title);
    setKind((item.kind as WorkspaceKind) || 'note');
    setContent(item.content);
    setFormError(null);
  };

  const submit = async () => {
    if (!title.trim()) {
      setFormError('Title is required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await api.patchWorkspace(editingId, {
          title: title.trim(),
          kind,
          content,
        });
      } else {
        await api.createWorkspace({ title: title.trim(), kind, content });
      }
      resetForm();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteWorkspace(id);
      setConfirmDelete(null);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
    }
  };

  const q = query.trim().toLowerCase();
  const visible = items.filter((i) => {
    if (kindFilter !== 'all' && i.kind !== kindFilter) return false;
    if (!q) return true;
    return (
      i.title.toLowerCase().includes(q) || i.content.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1 pb-2">
        <FileText className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-semibold text-slate-100">Workspace</span>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label="Refresh workspace"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
        <button
          type="button"
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {editingId ? 'Cancel' : 'New'}
        </button>
      </div>

      <p className="px-1 pb-2 text-[11px] leading-relaxed text-slate-500">
        Notes, projects, and briefs 1ne references for context and deadlines.
      </p>

      {showForm && (
        <div className="mb-2 space-y-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Q4 launch brief)"
            className={inputCls}
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as WorkspaceKind)}
            className={inputCls}
            aria-label="Entry kind"
          >
            <option value="note">Note</option>
            <option value="project">Project</option>
            <option value="guideline">Guideline</option>
            <option value="brief">Brief</option>
          </select>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Details, deadlines, constraints…"
            rows={5}
            className={`${inputCls} resize-y text-xs leading-relaxed`}
          />
          {formError && <p className="text-xs text-red-300">{formError}</p>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editingId ? 'Save changes' : 'Add to workspace'}
          </button>
        </div>
      )}

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search workspace…"
          className="w-full rounded-xl border border-slate-800 bg-slate-900/60 py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500/60 focus:outline-none"
        />
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKindFilter(k.id)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-medium',
              kindFilter === k.id
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200',
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </p>
        ) : visible.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-500">
            {items.length === 0
              ? 'Empty workspace — add a project brief so 1ne can cross-reference deadlines.'
              : 'No matches.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {visible.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium capitalize',
                      kindBadge[item.kind] ?? kindBadge.note,
                    )}
                  >
                    {item.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                    {item.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                    aria-label={`Edit "${item.title}"`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {confirmDelete === item.id ? (
                    <button
                      type="button"
                      onClick={() => void remove(item.id)}
                      className="shrink-0 rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-500"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(item.id)}
                      className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                      aria-label={`Delete "${item.title}"`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-400">
                  {item.content || '—'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
