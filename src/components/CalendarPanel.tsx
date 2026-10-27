'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { api, type CalendarEventDto } from '@/lib/client-api';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toLocalInputValue(d: Date): { date: string; time: string } {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function combineLocal(date: string, time: string): string {
  const [y, mo, da] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, da, h || 0, mi || 0).toISOString();
}

function formatEvent(e: CalendarEventDto): string {
  const start = new Date(e.starts_at);
  const date = start.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  if (e.all_day) return `${date} · all day`;
  const t = (d: Date) =>
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const end = e.ends_at ? ` – ${t(new Date(e.ends_at))}` : '';
  return `${date} · ${t(start)}${end}`;
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/60 focus:outline-none';

export function CalendarPanel({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<CalendarEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const tomorrow9 = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  })();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(toLocalInputValue(tomorrow9).date);
  const [startTime, setStartTime] = useState(toLocalInputValue(tomorrow9).time);
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const { events: list } = await api.listEvents({
        from: new Date(now.getTime() - 24 * 3600 * 1000).toISOString(),
        limit: 50,
      });
      setEvents(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const resetForm = () => {
    setTitle('');
    setLocation('');
    setDescription('');
    setFormError(null);
    setShowForm(false);
  };

  const submit = async () => {
    if (!title.trim() || !date || !startTime) {
      setFormError('Title, date, and start time are required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api.createEvent({
        title: title.trim(),
        starts_at: combineLocal(date, startTime),
        ends_at: endTime ? combineLocal(date, endTime) : undefined,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
      });
      resetForm();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create event.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteEvent(id);
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event.');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1 pb-2">
        <CalendarDays className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-semibold text-slate-100">Calendar</span>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label="Refresh calendar"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          New
        </button>
      </div>

      {showForm && (
        <div className="mb-2 space-y-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            className={inputCls}
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${inputCls} col-span-1`}
              aria-label="Date"
            />
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputCls}
              aria-label="Start time"
            />
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputCls}
              aria-label="End time"
            />
          </div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className={inputCls}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className={`${inputCls} resize-none`}
          />
          {formError && <p className="text-xs text-red-300">{formError}</p>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create event
          </button>
        </div>
      )}

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
        ) : events.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-500">
            No upcoming events. Ask the assistant to schedule something, or
            create one above.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li
                key={e.id}
                className="group rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-100">
                      {e.title}
                    </div>
                    <div className="mt-0.5 text-xs text-indigo-300">
                      {formatEvent(e)}
                    </div>
                    {e.location && (
                      <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-400">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {e.location}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(e.id)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                    aria-label={`Delete "${e.title}"`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
