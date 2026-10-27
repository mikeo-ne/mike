'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronRight,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  api,
  type AgendaDto,
  type CalendarEventDto,
  type TaskDto,
} from '@/lib/client-api';

function timeRange(e: CalendarEventDto): string {
  if (e.all_day) return 'all day';
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
  return e.ends_at ? `${t(e.starts_at)} – ${t(e.ends_at)}` : t(e.starts_at);
}

function findOverlaps(events: CalendarEventDto[]) {
  const out: Array<[CalendarEventDto, CalendarEventDto]> = [];
  const sorted = [...events].sort(
    (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at),
  );
  for (let i = 0; i < sorted.length; i += 1) {
    const aEnd = sorted[i].ends_at
      ? +new Date(sorted[i].ends_at as string)
      : +new Date(sorted[i].starts_at) + 3600_000;
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (+new Date(sorted[j].starts_at) >= aEnd) break;
      out.push([sorted[i], sorted[j]]);
      if (out.length >= 5) return out;
    }
  }
  return out;
}

const priorityDot: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-slate-500',
};

interface DashboardPanelProps {
  refreshKey: number;
  onNavigate: (tab: 'calendar' | 'workspace' | 'settings') => void;
}

export function DashboardPanel({ refreshKey, onNavigate }: DashboardPanelProps) {
  const [agenda, setAgenda] = useState<AgendaDto | null>(null);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [calendar, setCalendar] = useState<'local' | 'google'>('local');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTask, setNewTask] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const [a, t] = await Promise.all([
          api.agenda({ calendar }),
          api.listTasks({ limit: 50 }),
        ]);
        setAgenda(a);
        setTasks(t.tasks);
      } catch (err) {
        if (!quiet) {
          setAgenda(null);
          setError(
            err instanceof Error ? err.message : 'Failed to load dashboard.',
          );
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [calendar],
  );

  // Adopt the preferred calendar once, then live-refresh every 60s.
  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((s) => {
        if (!cancelled && s.preferredCalendar === 'google') {
          setCalendar('google');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const id = setInterval(() => void load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const toggleTask = async (task: TaskDto) => {
    const next = task.status === 'done' ? 'open' : 'done';
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)),
    );
    try {
      await api.patchTask(task.id, { status: next });
    } catch {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: task.status } : t,
        ),
      );
    }
  };

  const addTask = async () => {
    const title = newTask.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      const { task } = await api.createTask({ title });
      setTasks((prev) => [task, ...prev]);
      setNewTask('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add task.');
    } finally {
      setAdding(false);
    }
  };

  const removeTask = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await api.deleteTask(id);
    } catch {
      void load(true);
    }
  };

  const now = Date.now();
  const events = agenda?.events ?? [];
  const live = events.find((e) => {
    const s = +new Date(e.starts_at);
    const t = e.ends_at ? +new Date(e.ends_at) : s + 3600_000;
    return s <= now && now < t;
  });
  const upNext = events.find((e) => +new Date(e.starts_at) > now);
  const overlaps = findOverlaps(events);
  const activeTasks = tasks.filter((t) => t.status !== 'done');
  const doneCount = tasks.length - activeTasks.length;
  const googleBlocked =
    !!error && calendar === 'google' && /not connected/i.test(error);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {/* Schedule */}
      <section>
        <div className="flex items-center gap-2 px-1 pb-2">
          <CalendarDays className="h-4 w-4 text-indigo-400" />
          <span className="text-sm font-semibold text-slate-100">
            Today&apos;s schedule
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Refresh dashboard"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>

        <div className="mb-2 flex gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
          {(['local', 'google'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCalendar(c)}
              className={cn(
                'flex-1 rounded-lg px-2 py-1 text-xs font-medium capitalize',
                calendar === c
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {c === 'local' ? 'Built-in' : 'Google'}
            </button>
          ))}
        </div>

        {loading && !agenda ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : googleBlocked ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs leading-relaxed text-slate-300">
            Google Calendar isn&apos;t connected.
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="ml-1 inline-flex items-center gap-0.5 font-medium text-indigo-300 hover:text-indigo-200"
            >
              Connect it <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        ) : error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </p>
        ) : (
          <div className="space-y-2">
            {(live || upNext) && (
              <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                  {live ? 'Happening now' : 'Up next'}
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-slate-100">
                  {(live ?? upNext)?.title}
                </div>
                <div className="text-xs text-indigo-200">
                  {timeRange((live ?? upNext) as CalendarEventDto)}
                </div>
              </div>
            )}
            {overlaps.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {overlaps.length} conflict{overlaps.length > 1 ? 's' : ''} today
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-amber-200/80">
                  {overlaps.slice(0, 3).map(([a, b]) => (
                    <li key={`${a.id}-${b.id}`} className="truncate">
                      {a.title} ↔ {b.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {events.length === 0 ? (
              <p className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-4 text-center text-xs text-slate-500">
                Nothing scheduled today. Ask Mike to plan your day.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {events.slice(0, 6).map((e) => (
                  <li
                    key={e.id}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2"
                  >
                    <div className="truncate text-sm font-medium text-slate-100">
                      {e.title}
                    </div>
                    <div className="text-xs text-indigo-300">{timeRange(e)}</div>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="flex w-full items-center justify-center gap-1 rounded-xl border border-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-900"
            >
              Open full calendar <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </section>

      {/* Tasks */}
      <section>
        <div className="flex items-center gap-2 px-1 pb-2">
          <ListTodo className="h-4 w-4 text-indigo-400" />
          <span className="text-sm font-semibold text-slate-100">
            Active tasks
          </span>
          {doneCount > 0 && (
            <span className="rounded-full bg-slate-800 px-1.5 py-px text-[10px] text-slate-400">
              {doneCount} done
            </span>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addTask();
              }}
              placeholder="Add a task…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void addTask()}
              disabled={adding || !newTask.trim()}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
              aria-label="Add task"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </button>
          </div>
          {activeTasks.length === 0 ? (
            <p className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-4 text-center text-xs text-slate-500">
              All clear. Tell Mike what to track next.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {activeTasks.map((t) => (
                <li
                  key={t.id}
                  className="group flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-2.5 py-2"
                >
                  <button
                    type="button"
                    onClick={() => void toggleTask(t)}
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-slate-600 hover:border-emerald-400"
                    aria-label={`Complete "${t.title}"`}
                  >
                    {t.status === 'done' && (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          priorityDot[t.priority] ?? priorityDot.medium,
                        )}
                      />
                      <span className="truncate text-sm text-slate-100">
                        {t.title}
                      </span>
                    </div>
                    {t.due_at && (
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Due{' '}
                        {new Date(t.due_at).toLocaleString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeTask(t.id)}
                    className="shrink-0 rounded-lg p-1 text-slate-600 hover:bg-slate-800 hover:text-red-300"
                    aria-label={`Delete "${t.title}"`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
            <CheckSquare className="h-3 w-3" />
            Mike can create and complete these from chat.
          </div>
        </div>
      </section>
    </div>
  );
}
