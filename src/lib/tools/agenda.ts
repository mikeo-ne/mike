/**
 * Daily agenda tool — answers "what does my day / tomorrow morning look like?"
 * with the events overlapping a calendar day in a given IANA timezone.
 * Works against the local calendar or the connected Google Calendar.
 */
import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { listGoogleEvents } from '@/lib/calendar/google';
import { defineTool } from './registry';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Offset of `tz` at instant `d`, in minutes east of UTC. */
function offsetMinutesAt(d: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - d.getTime()) / 60000);
}

/**
 * UTC [start, end) covering calendar day `dateStr` in `tz`.
 * Two-pass refinement handles DST transitions inside the day.
 */
function zonedDayRange(dateStr: string, tz: string): { start: Date; end: Date } {
  const midnightUtc = Date.parse(`${dateStr}T00:00:00Z`);
  let offset = offsetMinutesAt(new Date(midnightUtc), tz);
  let startMs = midnightUtc - offset * 60000;
  offset = offsetMinutesAt(new Date(startMs), tz);
  startMs = midnightUtc - offset * 60000;
  return { start: new Date(startMs), end: new Date(startMs + 24 * 3600 * 1000) };
}

export const getDailyAgendaSchema = z.object({
  calendar: z
    .enum(['local', 'google'])
    .optional()
    .default('local')
    .describe(
      'Which calendar to use: "local" (MIKE\'s built-in calendar) or "google" (the connected Google Calendar).',
    ),
  date: z
    .string()
    .regex(DATE_RE, 'Must be a calendar date like "2026-10-28".')
    .optional()
    .describe(
      'Calendar day to summarize (YYYY-MM-DD). Defaults to today in the given timezone.',
    ),
  timezone: z
    .string()
    .max(64)
    .optional()
    .describe(
      'IANA timezone the day is interpreted in, e.g. "Africa/Kampala". Defaults to the user\'s saved timezone, else UTC.',
    ),
});

interface AgendaEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}

defineTool({
  name: 'get_daily_agenda',
  description:
    'Get the daily agenda: all events overlapping one calendar day (defaults to today), plus the total scheduled time. Use for "what does my day / tomorrow morning look like" questions.',
  parameters: getDailyAgendaSchema,
  execute: async (args, ctx) => {
    const timezone = args.timezone?.trim() || ctx.timezone || 'UTC';
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new Error(
        `Unknown timezone "${timezone}". Use an IANA name like "Africa/Kampala".`,
      );
    }
    const dateStr =
      args.date ??
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    const { start, end } = zonedDayRange(dateStr, timezone);

    let events: AgendaEvent[];
    if (args.calendar === 'google') {
      const res = await listGoogleEvents(ctx.profileId, {
        from: start.toISOString(),
        to: end.toISOString(),
        limit: 100,
      });
      events = res.events;
    } else {
      const { db } = await getDb();
      const rows = await db
        .select()
        .from(schema.calendarEvents)
        .where(
          and(
            eq(schema.calendarEvents.profileId, ctx.profileId),
            lt(schema.calendarEvents.startsAt, end),
            or(
              gt(schema.calendarEvents.endsAt, start),
              isNull(schema.calendarEvents.endsAt),
            ),
          ),
        )
        .orderBy(asc(schema.calendarEvents.startsAt))
        .limit(100);
      events = rows.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        location: e.location,
        starts_at: e.startsAt.toISOString(),
        ends_at: e.endsAt ? e.endsAt.toISOString() : null,
        all_day: e.allDay,
      }));
    }

    let scheduledMinutes = 0;
    for (const e of events) {
      const eStart = new Date(e.starts_at).getTime();
      const eEnd = e.ends_at
        ? new Date(e.ends_at).getTime()
        : eStart + 3600_000;
      const overlapStart = Math.max(eStart, start.getTime());
      const overlapEnd = Math.min(eEnd, end.getTime());
      if (overlapEnd > overlapStart) {
        scheduledMinutes += Math.round((overlapEnd - overlapStart) / 60000);
      }
    }

    return {
      date: dateStr,
      timezone,
      calendar: args.calendar,
      day_starts_at: start.toISOString(),
      day_ends_at: end.toISOString(),
      count: events.length,
      scheduled_minutes: scheduledMinutes,
      events,
    };
  },
});
