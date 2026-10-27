'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type CallsConfigDto,
  type ScheduledRunDto,
  type ScheduledTaskDto,
} from '@/lib/client-api';

const DEFAULT_INSTRUCTIONS =
  'Cover: today\'s agenda, this week\'s deadlines, open tasks, and any scheduling conflicts. Arrange meetings where needed — propose concrete open slots inside the workday. End with the top 3 next actions.';

function fmtWhen(value: string | null): string {
  if (!value) return 'never';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function deliveryLabel(delivery: string[]): string {
  const parts = ['📄 Hub'];
  if (delivery.includes('call')) parts.push('📞 call');
  if (delivery.includes('telegram')) parts.push('✈️ Telegram');
  return parts.join(' + ');
}

export default function ClockworkPanel() {
  const [tasks, setTasks] = useState<ScheduledTaskDto[]>([]);
  const [calls, setCalls] = useState<CallsConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('Morning briefing');
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [wantCall, setWantCall] = useState(false);
  const [phone, setPhone] = useState('');
  const [wantTelegram, setWantTelegram] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runsOpen, setRunsOpen] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScheduledRunDto[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, c] = await Promise.all([
        api.scheduledTasks.list(),
        api.callsConfig(),
      ]);
      setTasks(t);
      setCalls(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createTask() {
    if (!name.trim()) {
      setError('Give the task a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const delivery = ['hub'];
      if (wantCall) delivery.push('call');
      if (wantTelegram) delivery.push('telegram');
      const { task } = await api.scheduledTasks.create({
        name: name.trim(),
        instructions,
        delivery,
        phone: phone.trim() || null,
        telegramChatId: telegramChatId.trim() || null,
      });
      setTasks((prev) => [task, ...prev]);
      setFormOpen(false);
      setName('Morning briefing');
      setInstructions(DEFAULT_INSTRUCTIONS);
      setWantCall(false);
      setPhone('');
      setWantTelegram(false);
      setTelegramChatId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create task.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(task: ScheduledTaskDto) {
    try {
      const { task: updated } = await api.scheduledTasks.patch(task.id, {
        enabled: !task.enabled,
      });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update task.');
    }
  }

  async function runNow(task: ScheduledTaskDto) {
    setRunningId(task.id);
    setError(null);
    try {
      const { run: result } = await api.scheduledTasks.run(task.id);
      if (result.status === 'ok') {
        await refresh();
      } else {
        setError(result.error || 'Run failed.');
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed.');
    } finally {
      setRunningId(null);
    }
  }

  async function removeTask(task: ScheduledTaskDto) {
    if (!window.confirm(`Delete "${task.name}"?`)) return;
    try {
      await api.scheduledTasks.remove(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete task.');
    }
  }

  async function toggleRuns(task: ScheduledTaskDto) {
    if (runsOpen === task.id) {
      setRunsOpen(null);
      return;
    }
    setRunsOpen(task.id);
    setRunsLoading(true);
    try {
      const detail = await api.scheduledTasks.get(task.id);
      setRuns(detail.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load runs.');
    } finally {
      setRunsLoading(false);
    }
  }

  if (loading) {
    return <p className="text-xs text-zinc-500">Loading scheduled tasks…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Clockwork
        </h3>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="rounded-lg bg-emerald-400/15 px-2 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-400/25"
        >
          {formOpen ? 'Cancel' : '+ New task'}
        </button>
      </div>

      {calls && !calls.configured && (
        <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-2 text-[11px] text-amber-200">
          Phone calls aren&apos;t configured yet — set the Twilio secrets to
          enable call delivery. Hub and Telegram briefings work regardless.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-400/20 bg-red-400/10 p-2 text-[11px] text-red-200">
          {error}
        </p>
      )}

      {formOpen && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <label className="block text-[11px] text-zinc-400">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
              placeholder="Morning briefing"
            />
          </label>
          <label className="block text-[11px] text-zinc-400">
            Instructions
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-300">
            <input
              type="checkbox"
              checked={wantCall}
              onChange={(e) => setWantCall(e.target.checked)}
              disabled={!calls?.configured}
              title={
                calls?.configured ? '' : 'Configure Twilio secrets first'
              }
            />
            Phone me with the briefing
            {!calls?.configured && (
              <span className="text-zinc-500">(needs Twilio)</span>
            )}
          </label>
          {wantCall && (
            <label className="block text-[11px] text-zinc-400">
              Phone (optional — defaults to the alert number)
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
                placeholder={calls?.defaultTo ?? '+256…'}
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-[11px] text-zinc-300">
            <input
              type="checkbox"
              checked={wantTelegram}
              onChange={(e) => setWantTelegram(e.target.checked)}
              disabled={!calls?.telegram.configured}
              title={
                calls?.telegram.configured
                  ? ''
                  : 'Set TELEGRAM_BOT_TOKEN first'
              }
            />
            Send a Telegram voice briefing
            {!calls?.telegram.configured && (
              <span className="text-zinc-500">(needs bot token)</span>
            )}
          </label>
          {wantTelegram && (
            <label className="block text-[11px] text-zinc-400">
              Telegram chat id (optional — defaults to yours)
              <input
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
                placeholder={calls?.telegram.defaultTo ?? 'e.g. 123456789'}
              />
            </label>
          )}
          <button
            onClick={() => void createTask()}
            disabled={saving}
            className="w-full rounded-lg bg-emerald-400/20 px-2 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/30 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create task'}
          </button>
          <p className="text-[10px] text-zinc-500">
            Runs every morning (~8–9am EAT) once deployed. Use “Run now” to
            test immediately.
          </p>
        </div>
      )}

      {tasks.length === 0 && !formOpen && (
        <p className="text-xs text-zinc-500">
          No scheduled tasks yet. Create the morning briefing to have Mike
          work while you sleep.
        </p>
      )}

      {tasks.map((task) => (
        <div
          key={task.id}
          className="space-y-1.5 rounded-xl border border-white/10 bg-white/5 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-zinc-100">{task.name}</p>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                task.lastStatus === 'error'
                  ? 'bg-red-400/15 text-red-200'
                  : 'bg-white/5 text-zinc-400'
              }`}
            >
              {task.enabled ? 'on' : 'paused'} · {task.runCount} runs
            </span>
          </div>
          <p className="text-[10px] text-zinc-500">
            {deliveryLabel(task.delivery)}
            {' · '}last run {fmtWhen(task.lastRunAt)}
            {task.lastStatus ? ` (${task.lastStatus})` : ''}
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              onClick={() => void runNow(task)}
              disabled={runningId === task.id}
              className="rounded-lg bg-emerald-400/15 px-2 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-400/25 disabled:opacity-50"
            >
              {runningId === task.id ? 'Running…' : 'Run now'}
            </button>
            <button
              onClick={() => void toggleEnabled(task)}
              className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
            >
              {task.enabled ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={() => void toggleRuns(task)}
              className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
            >
              {runsOpen === task.id ? 'Hide runs' : 'History'}
            </button>
            <button
              onClick={() => void removeTask(task)}
              className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-red-300 hover:bg-white/10"
            >
              Delete
            </button>
          </div>
          {runsOpen === task.id && (
            <div className="space-y-1 pt-1">
              {runsLoading && (
                <p className="text-[10px] text-zinc-500">Loading runs…</p>
              )}
              {!runsLoading && runs.length === 0 && (
                <p className="text-[10px] text-zinc-500">No runs yet.</p>
              )}
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg bg-black/30 p-2 text-[10px] text-zinc-400"
                >
                  <span
                    className={
                      run.status === 'ok' ? 'text-emerald-300' : 'text-red-300'
                    }
                  >
                    {run.status}
                  </span>
                  {' · '}
                  {fmtWhen(run.startedAt)}
                  {run.callSid && ` · 📞 ${run.callStatus ?? 'called'}`}
                  {run.telegramMessageId &&
                    ` · ✈️ ${run.telegramStatus ?? 'sent'}`}
                  {run.error && (
                    <span className="text-red-300"> · {run.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
