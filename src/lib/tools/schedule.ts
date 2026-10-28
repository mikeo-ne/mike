/**
 * Structured schedule tools:
 *  - get_calendar_schedule   — day/week/month timelines (ISO or date params).
 *  - modify_calendar_schedule — create / reschedule / update / delete events.
 */
import { z } from 'zod';
import {
  createLocalEvent,
  deleteLocalEvent,
  updateLocalEvent,
  type LocalEventDto,
} from '@/lib/calendar/local';
import {
  createGoogleEvent,
  deleteGoogleEvent,
  listGoogleEvents,
  updateGoogleEvent,
} from '@/lib/calendar/google';
import { getDb, schema } from '@/db';
import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import {
  todayInTz,
  ymdInTz,
  zonedDayRange,
  zonedMonthRange,
  zonedWeekRange,
} from '@/lib/calendar/tz';
import { notifyCalendarWebhook } from '@/lib/calendar/webhook';
import { defineTool, type ToolContext } from './registry';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isoDateTime = z
  .string()
  .max(64)
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'Must be a valid ISO 8601 date-time.',
  });

const calendarSource = z
  .enum(['local', 'google'])
  .optional()
  .default('local')
  .describe(
    'Which calendar to use: "local" (1ne\'s built-in calendar) or "google" (the connected Google Calendar).',
  );

type TimelineEvent = LocalEventDto & { calendar: 'local' | 'google' };

async function fetchWindow(
  profileId: string,
  calendar: 'local' | 'google',
  start: Date,
  end: Date,
): Promise<TimelineEvent[]> {
  if (calendar === 'google') {
    const res = await listGoogleEvents(profileId, {
      from: start.toISOString(),
      to: end.toISOString(),
      limit: 250,
    });
    return res.events.map((e) => ({ ...e, calendar: 'google' as const }));
  }
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.profileId, profileId),
        lt(schema.calendarEvents.startsAt, end),
        or(gt(schema.calendarEvents.endsAt, start), isNull(schema.calendarEvents.endsAt)),
      ),
    )
    .orderBy(asc(schema.calendarEvents.startsAt))
    .limit(250);
  return rows.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    starts_at: e.startsAt.toISOString(),
    ends_at: e.endsAt ? e.endsAt.toISOString() : null,
    all_day: e.allDay,
    calendar: 'local' as const,
  }));
}

// ------------------------------------------------------- get schedule ---
export const getCalendarScheduleSchema = z.object({
  calendar: calendarSource,
  range: z
    .enum(['day', 'week', 'month'])
    .optional()
    .default('day')
    .describe(
      'Timeline granularity. Ignored when from/to are given (custom window).',
    ),
  date: z
    .string()
    .regex(DATE_RE, 'Must be a calendar date like "2026-10-28".')
    .optional()
    .describe(
      'Anchor day (YYYY-MM-DD) for the range. Defaults to today in the timezone.',
    ),
  from: isoDateTime
    .optional()
    .describe('Custom window start (absolute ISO string).'),
  to: isoDateTime.optional().describe('Custom window end (absolute ISO string).'),
  timezone: z
    .string()
    .max(64)
    .optional()
    .describe(
      'IANA timezone for day boundaries and grouping. Defaults to the user\'s saved timezone, else UTC.',
    ),
});

defineTool({
  name: 'get_calendar_schedule',
  description:
    'Retrieve a day, week, or month timeline. Takes an anchor date plus a range, or absolute ISO from/to for a custom window (max 62 days). Returns events grouped by day, total scheduled minutes, and any overlaps found in the window.',
  parameters: getCalendarScheduleSchema,
  execute: async (args, ctx) => {
    const calendar = args.calendar ?? 'local';
    const timezone = args.timezone?.trim() || ctx.timezone || 'UTC';
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new Error(
        `Unknown timezone "${timezone}". Use an IANA name like "Africa/Kampala".`,
      );
    }
    let start: Date;
    let end: Date;
    let range: string = args.range ?? 'day';
    if (args.from || args.to) {
      start = args.from ? new Date(args.from) : new Date();
      end = args.to
        ? new Date(args.to)
        : new Date(start.getTime() + 7 * 86400_000);
      if (!(end > start)) throw new Error('to must be after from.');
      if (end.getTime() - start.getTime() > 62 * 86400_000) {
        throw new Error('Window too large — maximum 62 days.');
      }
      range = 'custom';
    } else {
      const dateStr = args.date ?? todayInTz(timezone);
      const window =
        range === 'week'
          ? zonedWeekRange(dateStr, timezone)
          : range === 'month'
            ? zonedMonthRange(dateStr, timezone)
            : zonedDayRange(dateStr, timezone);
      start = window.start;
      end = window.end;
    }

    const events = await fetchWindow(ctx.profileId, calendar, start, end);

    // Group by day in the target timezone + scheduled minutes + overlaps.
    const byDay = new Map<string, TimelineEvent[]>();
    let scheduledMinutes = 0;
    for (const e of events) {
      const key = ymdInTz(new Date(e.starts_at), timezone);
      const list = byDay.get(key) ?? [];
      list.push(e);
      byDay.set(key, list);
      const s = new Date(e.starts_at).getTime();
      const t = e.ends_at ? new Date(e.ends_at).getTime() : s + 3600_000;
      const overlapStart = Math.max(s, start.getTime());
      const overlapEnd = Math.min(t, end.getTime());
      if (overlapEnd > overlapStart) {
        scheduledMinutes += Math.round((overlapEnd - overlapStart) / 60000);
      }
    }
    const sorted = [...events].sort(
      (a, b) => +new Date(a.starts_at) - +new Date(b.starts_at),
    );
    const conflicts: Array<Record<string, unknown>> = [];
    for (let i = 0; i < sorted.length && conflicts.length < 20; i += 1) {
      const a = sorted[i];
      const aEnd = a.ends_at
        ? new Date(a.ends_at).getTime()
        : new Date(a.starts_at).getTime() + 3600_000;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j];
        const bStart = new Date(b.starts_at).getTime();
        if (bStart >= aEnd) break;
        conflicts.push({
          first: { id: a.id, title: a.title, starts_at: a.starts_at },
          second: { id: b.id, title: b.title, starts_at: b.starts_at },
        });
        if (conflicts.length >= 20) break;
      }
    }

    return {
      calendar,
      timezone,
      range,
      window: { from: start.toISOString(), to: end.toISOString() },
      count: events.length,
      scheduled_minutes: scheduledMinutes,
      days: [...byDay.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, dayEvents]) => ({ date, events: dayEvents })),
      conflicts,
      conflicts_count: conflicts.length,
    };
  },
});

// ---------------------------------------------------------- modify ----------
export const modifyCalendarScheduleSchema = z.object({
  calendar: calendarSource,
  action: z
    .enum(['create', 'reschedule', 'update', 'delete', 'cancel'])
    .describe(
      'create: new event (needs title + starts_at). reschedule: move an event (needs id + starts_at). update: change fields (needs id). delete/cancel: remove (needs id).',
    ),
  id: z.string().max(256).optional().describe('Event id (all actions except create).'),
  title: z.string().trim().min(1).max(200).optional(),
  starts_at: isoDateTime.optional(),
  ends_at: isoDateTime.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  all_day: z.boolean().optional(),
});

defineTool({
  name: 'modify_calendar_schedule',
  description:
    'Create, reschedule, update, or delete/cancel a calendar event in one structured call. Handles timezone transformations via ISO 8601 date-times. Results include "conflicts" for time changes — always surface them and propose nearby free slots instead of double-booking.',
  parameters: modifyCalendarScheduleSchema,
  execute: async (args, ctx: ToolContext) => {
    const calendar = args.calendar ?? 'local';
    const need = (cond: unknown, message: string) => {
      if (!cond) throw new Error(message);
    };

    if (args.action === 'create') {
      need(args.title, 'action "create" requires "title".');
      need(args.starts_at, 'action "create" requires "starts_at" (ISO 8601).');
      const input = {
        title: args.title as string,
        starts_at: args.starts_at as string,
        ends_at: args.ends_at,
        description: args.description ?? undefined,
        location: args.location ?? undefined,
        all_day: args.all_day,
      };
      const result =
        calendar === 'google'
          ? await createGoogleEvent(ctx.profileId, input, ctx.timezone)
          : await createLocalEvent(ctx.profileId, input);
      notifyCalendarWebhook({
        action: 'created',
        calendar,
        event: result.event as unknown as Record<string, unknown>,
        conflicts: result.conflicts as unknown as Array<Record<string, unknown>>,
      });
      return { action: 'created', calendar, ...result };
    }

    if (args.action === 'reschedule') {
      need(args.id, 'action "reschedule" requires "id".');
      need(args.starts_at, 'action "reschedule" requires the new "starts_at" (ISO 8601).');
      const patch = { starts_at: args.starts_at, ends_at: args.ends_at };
      const result =
        calendar === 'google'
          ? await updateGoogleEvent(ctx.profileId, args.id as string, patch, ctx.timezone)
          : await updateLocalEvent(ctx.profileId, args.id as string, patch);
      notifyCalendarWebhook({
        action: 'rescheduled',
        calendar,
        event: result.event as unknown as Record<string, unknown>,
        conflicts: result.conflicts as unknown as Array<Record<string, unknown>>,
      });
      return { action: 'rescheduled', calendar, ...result };
    }

    if (args.action === 'update') {
      need(args.id, 'action "update" requires "id".');
      const patch = {
        title: args.title,
        starts_at: args.starts_at,
        ends_at: args.ends_at,
        description: args.description ?? undefined,
        location: args.location ?? undefined,
        all_day: args.all_day,
      };
      const result =
        calendar === 'google'
          ? await updateGoogleEvent(ctx.profileId, args.id as string, patch, ctx.timezone)
          : await updateLocalEvent(ctx.profileId, args.id as string, patch);
      notifyCalendarWebhook({
        action: 'updated',
        calendar,
        event: result.event as unknown as Record<string, unknown>,
        conflicts: result.conflicts as unknown as Array<Record<string, unknown>>,
      });
      return { action: 'updated', calendar, ...result };
    }

    need(args.id, `action "${args.action}" requires "id".`);
    const result =
      calendar === 'google'
        ? await deleteGoogleEvent(ctx.profileId, args.id as string)
        : await deleteLocalEvent(ctx.profileId, args.id as string);
    const webhookAction =
      args.action === 'cancel' ? ('cancelled' as const) : ('deleted' as const);
    notifyCalendarWebhook({
      action: webhookAction,
      calendar,
      event: { id: args.id as string },
    });
    return { action: webhookAction, calendar, ...result };
  },
});
