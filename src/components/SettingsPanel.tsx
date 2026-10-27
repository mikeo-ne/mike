'use client';

import { useEffect, useState } from 'react';
import { Check, Globe, Loader2 } from 'lucide-react';
import { api } from '@/lib/client-api';

const COMMON_TIMEZONES = [
  'Africa/Kampala',
  'Africa/Nairobi',
  'Africa/Lagos',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/60 focus:outline-none';

export function SettingsPanel({
  provider,
  model,
  demoMode,
}: {
  provider: string;
  model: string;
  demoMode: boolean;
}) {
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getSettings();
        if (!cancelled) setTimezone(s.timezone ?? '');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load settings.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { settings } = await api.patchSettings({
        timezone: timezone.trim() || null,
      });
      setTimezone(settings.timezone ?? '');
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const useBrowserTimezone = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setTimezone(tz);
    } catch {
      /* ignore */
    }
  };

  const nowInTz = (() => {
    if (!timezone.trim()) return null;
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone.trim(),
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());
    } catch {
      return null;
    }
  })();

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div>
        <div className="flex items-center gap-2 px-1 pb-2">
          <Globe className="h-4 w-4 text-indigo-400" />
          <span className="text-sm font-semibold text-slate-100">
            Your timezone
          </span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <p className="text-xs leading-relaxed text-slate-400">
              MIKE resolves &ldquo;tomorrow at 3pm&rdquo; and daily agendas in
              this timezone.
            </p>
            <input
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
                setSaved(false);
              }}
              placeholder="e.g. Africa/Kampala"
              list="tz-suggestions"
              className={`${inputCls} font-mono text-xs`}
            />
            <datalist id="tz-suggestions">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            {nowInTz && (
              <p className="text-xs text-indigo-300">Now: {nowInTz}</p>
            )}
            {error && <p className="text-xs text-red-300">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : saved ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
                {saved ? 'Saved' : 'Save'}
              </button>
              <button
                type="button"
                onClick={useBrowserTimezone}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
                title="Fill in your browser's timezone"
              >
                Detect
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="px-1 pb-2 text-sm font-semibold text-slate-100">
          Intelligence
        </div>
        <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/60 p-3 font-mono text-xs text-slate-300">
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">provider</span>
            <span>{provider}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">model</span>
            <span className="truncate">{model}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">mode</span>
            <span className={demoMode ? 'text-amber-300' : 'text-emerald-300'}>
              {demoMode ? 'demo (no API key)' : 'live AI'}
            </span>
          </div>
        </div>
        {demoMode && (
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-slate-500">
            Add OPENAI_API_KEY or ANTHROPIC_API_KEY via your host&apos;s
            Secrets Management panel (or <code>.env</code> locally) for full
            AI.
          </p>
        )}
      </div>
    </div>
  );
}
