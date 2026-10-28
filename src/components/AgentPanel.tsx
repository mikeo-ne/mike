'use client';

import { useEffect, useState } from 'react';
import { api, type ToolInfo } from '@/lib/client-api';

export default function AgentPanel() {
  const [agentName, setAgentName] = useState('1ne');
  const [persona, setPersona] = useState('');
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [settings, catalogue] = await Promise.all([
          api.getSettings(),
          api.listTools(),
        ]);
        setAgentName(settings.agentName || '1ne');
        setPersona(settings.systemInstructions || '');
        setTools(catalogue);
        setDisabled(settings.disabledTools ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleTool(name: string) {
    setDisabled((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const { settings: updated } = await api.patchSettings({
        agentName: agentName.trim() || null,
        systemInstructions: persona.trim() || null,
        disabledTools: disabled,
      });
      setAgentName(updated.agentName || '1ne');
      setPersona(updated.systemInstructions || '');
      setDisabled(updated.disabledTools ?? []);
      setStatus('Agent updated. It applies to new chats and briefings.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-xs text-zinc-500">Loading agent…</p>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Customize 1ne
      </h3>
      {error && (
        <p className="rounded-lg border border-red-400/20 bg-red-400/10 p-2 text-[11px] text-red-200">
          {error}
        </p>
      )}
      {status && (
        <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-2 text-[11px] text-emerald-200">
          {status}
        </p>
      )}
      <label className="block text-[11px] text-zinc-400">
        Agent name
        <input
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          maxLength={40}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
          placeholder="1ne"
        />
      </label>
      <label className="block text-[11px] text-zinc-400">
        Persona &amp; instructions
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          rows={5}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
          placeholder="e.g. Be terse. Push back on vague plans. Always confirm before scheduling on Google Calendar."
        />
      </label>
      <div>
        <p className="mb-1 text-[11px] text-zinc-400">
          Abilities — uncheck any tool 1ne must never use
        </p>
        <div className="space-y-1">
          {tools.map((tool) => (
            <label
              key={tool.name}
              className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/5 p-2 text-[11px] text-zinc-300"
              title={tool.description}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!disabled.includes(tool.name)}
                onChange={() => toggleTool(tool.name)}
              />
              <span>
                <span className="font-mono text-zinc-100">{tool.name}</span>
                {tool.description && (
                  <span className="block text-[10px] text-zinc-500">
                    {tool.description.length > 90
                      ? `${tool.description.slice(0, 90)}…`
                      : tool.description}
                  </span>
                )}
              </span>
            </label>
          ))}
          {tools.length === 0 && (
            <p className="text-[11px] text-zinc-500">
              No tools found — the catalogue may have failed to load.
            </p>
          )}
        </div>
      </div>
      <button
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded-lg bg-emerald-400/20 px-2 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/30 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save agent'}
      </button>
    </div>
  );
}
