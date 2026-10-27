'use client';

import { useState } from 'react';
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, type SystemPromptDto } from '@/lib/client-api';

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/60 focus:outline-none';

interface PromptsPanelProps {
  prompts: SystemPromptDto[];
  activeId: string | null;
  onSelect: (promptId: string) => void;
  onChanged: () => void;
}

export function PromptsPanel({
  prompts,
  activeId,
  onSelect,
  onChanged,
}: PromptsPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setName('');
    setContent('');
    setMakeDefault(false);
    setError(null);
  };

  const startEdit = (p: SystemPromptDto) => {
    setEditingId(p.id);
    setShowForm(true);
    setName(p.name);
    setContent(p.content);
    setMakeDefault(p.isDefault);
    setError(null);
  };

  const submit = async () => {
    if (!name.trim() || !content.trim()) {
      setError('Name and content are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await api.patchPrompt(editingId, {
          name: name.trim(),
          content: content.trim(),
          isDefault: makeDefault,
        });
      } else {
        await api.createPrompt({
          name: name.trim(),
          content: content.trim(),
          isDefault: makeDefault,
        });
      }
      resetForm();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save prompt.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deletePrompt(id);
      setConfirmDelete(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete prompt.');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1 pb-2">
        <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-semibold text-slate-100">
          System prompts
        </span>
        <button
          type="button"
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="ml-auto flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {editingId ? 'Cancel' : 'New'}
        </button>
      </div>

      {showForm && (
        <div className="mb-2 space-y-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Prompt name"
            className={inputCls}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="System instructions…"
            rows={6}
            className={`${inputCls} resize-y font-mono text-xs leading-relaxed`}
          />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={makeDefault}
              onChange={(e) => setMakeDefault(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-indigo-600"
            />
            Set as default for new chats
          </label>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editingId ? 'Save changes' : 'Create prompt'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <ul className="space-y-1.5">
          {prompts.map((p) => {
            const active = p.id === activeId;
            return (
              <li
                key={p.id}
                className={cn(
                  'rounded-xl border px-3 py-2',
                  active
                    ? 'border-indigo-500/50 bg-indigo-500/10'
                    : 'border-slate-800 bg-slate-900/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    title="Use for current chat"
                  >
                    <span className="truncate text-sm font-medium text-slate-100">
                      {p.name}
                    </span>
                    {p.isDefault && (
                      <span className="shrink-0 rounded-full bg-slate-700 px-1.5 py-px text-[10px] text-slate-300">
                        default
                      </span>
                    )}
                    {active && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                    aria-label={`Edit "${p.name}"`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {confirmDelete === p.id ? (
                    <button
                      type="button"
                      onClick={() => void remove(p.id)}
                      className="shrink-0 rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-500"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(p.id)}
                      className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                      aria-label={`Delete "${p.name}"`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                  {p.content}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
