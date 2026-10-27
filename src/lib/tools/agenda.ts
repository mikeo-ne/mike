/**
 * Daily agenda tool — answers "what does my day / tomorrow morning look like?"
 * with the events overlapping a calendar day in a given IANA timezone.
 */
import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
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

    let scheduledMinutes = 0;
    const events = rows.map((e) => {
      const eEnd = e.endsAt ?? new Date(e.startsAt.getTime() + 3600_000);
      const overlapStart = e.startsAt > start ? e.startsAt : start;
      const overlapEnd = eEnd < end ? eEnd : end;
      if (overlapEnd > overlapStart) {
        scheduledMinutes += Math.round(
          (overlapEnd.getTime() - overlapStart.getTime()) / 60000,
        );
      }
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        location: e.location,
        starts_at: e.startsAt.toISOString(),
        ends_at: e.endsAt ? e.endsAt.toISOString() : null,
        all_day: e.allDay,
      };
    });

    return {
      date: dateStr,
      timezone,
      day_starts_at: start.toISOString(),
      day_ends_at: end.toISOString(),
      count: events.length,
      scheduled_minutes: scheduledMinutes,
      events,
    };
  },
});
