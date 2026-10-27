/**
 * Demo mode: used when no API key is configured for the selected provider.
 * Rule-based replies, but REAL tool execution — calendar reads/writes work
 * end-to-end so the tool framework can be evaluated without a key.
 * Server-only.
 */
import { randomUUID } from 'node:crypto';
import { executeTool, type ToolContext } from '@/lib/tools';
import { safeJson } from '@/lib/utils';
import type { AgentMessage } from './types';
import type { Emit } from './agent';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function streamText(emit: Emit, text: string, signal?: AbortSignal) {
  const words = text.split(/(\s+)/);
  let buf = '';
  for (const w of words) {
    if (signal?.aborted) return;
    buf += w;
    if (buf.length >= 12 || w.includes('\n')) {
      emit({ type: 'text', delta: buf });
      buf = '';
      await sleep(18);
    }
  }
  if (buf) emit({ type: 'text', delta: buf });
}

function parseDateTime(input: string, now: Date): Date | null {
  const lower = input.toLowerCase();
  // Time: "3pm", "3:30pm", "15:30", "at 9 am"
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  // Explicit ISO date present?
  const isoMatch = input.match(
    /(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (isoMatch) {
    const d = new Date(
      isoMatch[2] ? `${isoMatch[1]}T${isoMatch[2]}:${isoMatch[3]}:00` : isoMatch[1],
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let dayOffset: number | null = null;
  if (/\btoday\b/.test(lower)) dayOffset = 0;
  else if (/\btomorrow\b/.test(lower)) dayOffset = 1;
  else {
    const weekdays = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    for (let i = 0; i < 7; i += 1) {
      if (lower.includes(weekdays[i])) {
        const diff = (i - now.getDay() + 7) % 7 || 7;
        dayOffset = diff;
        break;
      }
    }
  }
  if (dayOffset === null || !timeMatch) return null;
  let hour = Number.parseInt(timeMatch[1], 10);
  const minute = timeMatch[2] ? Number.parseInt(timeMatch[2], 10) : 0;
  const meridiem = timeMatch[3];
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function guessTitle(input: string): string {
  const m = input.match(
    /(?:schedule|create|add|book)\s+(.+?)\s+(?:for|on|at|tomorrow|today|next|on \w+day)/i,
  );
  if (m?.[1]) {
    const t = m[1].replace(/^(an?|the)\s+/i, '').trim();
    if (t) return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return 'New event';
}

export async function runDemoAgent(
  input: string,
  ctx: ToolContext,
  emit: Emit,
  signal?: AbortSignal,
): Promise<AgentMessage[]> {
  const produced: AgentMessage[] = [];
  const lower = input.toLowerCase();
  const wantsList =
    /(what'?s on|what is on|show|list|upcoming|agenda|calendar|events?|schedule\?|my day|my week)/.test(
      lower,
    );
  const wantsCreate =
    /(schedule|create|add|book|remind|set up|plan)\b/.test(lower) &&
    !/what/.test(lower);
  const wantsDelete = /(delete|remove|cancel)\b/.test(lower);

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const id = `call_${randomUUID()}`;
    produced.push({
      role: 'assistant',
      content: '',
      toolCalls: [{ id, name, args }],
    });
    emit({ type: 'tool_call', id, name, args });
    let result: unknown;
    try {
      result = await executeTool(name, args, ctx);
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
    emit({ type: 'tool_result', id, name, result });
    produced.push({
      role: 'tool',
      content: safeJson(result),
      toolName: name,
      toolCallId: id,
    });
    return result as Record<string, unknown>;
  };

  let reply = '';

  if (wantsList && !wantsCreate) {
    const windowDays = /week/.test(lower) ? 7 : 3;
    const now = new Date();
    const to = new Date(now.getTime() + windowDays * 24 * 3600 * 1000);
    const res = await callTool('list_calendar_events', {
      from: now.toISOString(),
      to: to.toISOString(),
      limit: 20,
    });
    const events = (res.events ?? []) as Array<{
      title: string;
      starts_at: string;
      ends_at: string | null;
      location: string | null;
    }>;
    reply =
      events.length === 0
        ? `I checked your calendar for the next ${windowDays} days — nothing scheduled. Want me to add something? (Demo mode: add an API key for full AI.)`
        : `Here's what's coming up in the next ${windowDays} days:\n\n${events
            .map((e) => {
              const d = new Date(e.starts_at);
              const when = d.toLocaleString('en-GB', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });
              return `• **${e.title}** — ${when}${e.location ? ` @ ${e.location}` : ''}`;
            })
            .join('\n')}\n\n(Demo mode: add an API key for full AI.)`;
  } else if (wantsCreate) {
    const when = parseDateTime(input, new Date());
    if (!when) {
      reply =
        'I can create that event — what date and time should I use? For example: "Schedule dentist tomorrow at 3pm". (Demo mode understands "today/tomorrow/weekday + time" or ISO dates; add an API key for full natural-language AI.)';
    } else {
      const res = await callTool('create_calendar_event', {
        title: guessTitle(input),
        starts_at: when.toISOString(),
      });
      const event = res.event as { title: string; starts_at: string } | undefined;
      reply = event
        ? `Done — created **${event.title}** for ${new Date(
            event.starts_at,
          ).toLocaleString('en-GB', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}. (Demo mode: add an API key for full AI.)`
        : 'I tried to create the event but something went wrong.';
    }
  } else if (wantsDelete) {
    const res = await callTool('list_calendar_events', { limit: 10 });
    const events = (res.events ?? []) as Array<{ id: string; title: string }>;
    const match = events.find((e) =>
      lower.includes(e.title.toLowerCase().split(' ')[0]),
    );
    if (match) {
      await callTool('delete_calendar_event', { id: match.id });
      reply = `Deleted **${match.title}**. (Demo mode: add an API key for full AI.)`;
    } else if (events.length === 0) {
      reply = 'Your calendar is empty — nothing to delete.';
    } else {
      reply = `Which event should I delete?\n\n${events
        .map((e) => `• ${e.title}`)
        .join('\n')}\n\nReply with the exact title. (Demo mode is literal — an API key enables full AI.)`;
    }
  } else if (/(time|date|today)/.test(lower)) {
    const res = await callTool('get_current_time', {});
    reply = `It's **${(res as { local?: string }).local ?? 'unknown'}** (${(res as { timezone?: string }).timezone ?? ''}). (Demo mode: add an API key for full AI.)`;
  } else if (/(help|what can you|who are you|hi|hello|hey)\b/.test(lower)) {
    reply =
      "Hi! I'm **MIKE**, your hyper-organized executive assistant (running in **demo mode** — no API key configured). I can still:\n\n• Show your calendar (\"what's on this week?\")\n• Create events (\"schedule gym tomorrow at 7am\")\n• Delete events (\"delete gym\")\n• Tell the time\n\nAdd `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to your secrets for full AI with real function calling.";
  } else {
    reply = `Demo mode only handles simple calendar requests, so I can't fully answer that yet.\n\nYou said: "${input.length > 200 ? `${input.slice(0, 200)}…` : input}"\n\nTry "what's on my calendar?" or "schedule lunch tomorrow at 12:30" — or add an API key to \`.env\` for full AI.`;
  }

  await streamText(emit, reply, signal);
  produced.push({ role: 'assistant', content: reply });
  return produced;
}
