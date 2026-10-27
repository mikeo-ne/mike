/**
 * Calendar tools — fetch, create, update, and delete events stored in
 * Postgres. Every operation is scoped to `ctx.profileId`.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { defineTool, type ToolContext } from './registry';

const isoDateTime = z
  .string()
  .max(64)
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'Must be a valid ISO 8601 date-time, e.g. "2026-10-28T12:30:00".',
  });

const eventId = z.string().uuid({ message: 'Must be a valid event id (UUID).' });

function toDto(e: typeof schema.calendarEvents.$inferSelect) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    starts_at: e.startsAt.toISOString(),
    ends_at: e.endsAt ? e.endsAt.toISOString() : null,
    all_day: e.allDay,
  };
}

// ---------------------------------------------------------------- list ---
export const listCalendarEventsSchema = z.object({
  from: isoDateTime
    .optional()
    .describe('Only include events starting at or after this ISO date-time.'),
  to: isoDateTime
    .optional()
    .describe('Only include events starting at or before this ISO date-time.'),
  query: z
    .string()
    .max(200)
    .optional()
    .describe('Case-insensitive search across title, description, and location.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum events to return (1-100, default 20).'),
});

async function listCalendarEvents(
  args: z.infer<typeof listCalendarEventsSchema>,
  ctx: ToolContext,
) {
  const { db } = await getDb();
  const conditions = [eq(schema.calendarEvents.profileId, ctx.profileId)];
  if (args.from) {
    conditions.push(gte(schema.calendarEvents.startsAt, new Date(args.from)));
  }
  if (args.to) {
    conditions.push(lte(schema.calendarEvents.startsAt, new Date(args.to)));
  }
  if (args.query?.trim()) {
    const q = `%${args.query.trim()}%`;
    conditions.push(
      or(
        ilike(schema.calendarEvents.title, q),
        ilike(schema.calendarEvents.description, q),
        ilike(schema.calendarEvents.location, q),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(schema.calendarEvents)
    .where(and(...conditions))
    .orderBy(asc(schema.calendarEvents.startsAt))
    .limit(args.limit);
  return { events: rows.map(toDto), count: rows.length };
}

defineTool({
  name: 'list_calendar_events',
  description:
    'List calendar events, optionally filtered by date range and/or a text query. Use this to answer "what is on my calendar" questions and to find an event id before updating or deleting.',
  parameters: listCalendarEventsSchema,
  execute: listCalendarEvents,
});

// --------------------------------------------------------------- create ---
export const createCalendarEventSchema = z.object({
  title: z.string().trim().min(1).max(200).describe('Event title.'),
  starts_at: isoDateTime.describe(
    'Start date-time in ISO 8601, e.g. "2026-10-28T12:30:00". Include a timezone offset when known.',
  ),
  ends_at: isoDateTime
    .optional()
    .describe('End date-time in ISO 8601. Defaults to 1 hour after starts_at.'),
  description: z.string().trim().max(2000).optional().describe('Notes / agenda.'),
  location: z.string().trim().max(300).optional().describe('Where it happens.'),
  all_day: z.boolean().optional().describe('True for an all-day event.'),
});

async function createCalendarEvent(
  args: z.infer<typeof createCalendarEventSchema>,
  ctx: ToolContext,
) {
  const startsAt = new Date(args.starts_at);
  const endsAt = args.ends_at
    ? new Date(args.ends_at)
    : new Date(startsAt.getTime() + 60 * 60 * 1000);
  if (endsAt <= startsAt) {
    throw new Error('ends_at must be after starts_at.');
  }
  const { db } = await getDb();
  const [row] = await db
    .insert(schema.calendarEvents)
    .values({
      id: randomUUID(),
      profileId: ctx.profileId,
      title: args.title,
      description: args.description ?? null,
      location: args.location ?? null,
      startsAt,
      endsAt,
      allDay: args.all_day ?? false,
    })
    .returning();
  return { event: toDto(row) };
}

defineTool({
  name: 'create_calendar_event',
  description:
    'Create a calendar event. Resolve relative dates ("tomorrow at 3pm") to an exact ISO date-time first — call get_current_time when unsure what today is.',
  parameters: createCalendarEventSchema,
  execute: createCalendarEvent,
});

// --------------------------------------------------------------- update ---
export const updateCalendarEventSchema = z.object({
  id: eventId.describe('Id of the event to update (from list_calendar_events).'),
  title: z.string().trim().min(1).max(200).optional(),
  starts_at: isoDateTime.optional(),
  ends_at: isoDateTime.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  all_day: z.boolean().optional(),
});

async function updateCalendarEvent(
  args: z.infer<typeof updateCalendarEventSchema>,
  ctx: ToolContext,
) {
  const { db } = await getDb();
  const existing = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.id, args.id),
        eq(schema.calendarEvents.profileId, ctx.profileId),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    throw new Error(`No calendar event found with id "${args.id}".`);
  }
  const startsAt = args.starts_at ? new Date(args.starts_at) : existing[0].startsAt;
  const endsAt = args.ends_at
    ? new Date(args.ends_at)
    : args.starts_at && !args.ends_at
      ? new Date(startsAt.getTime() + 60 * 60 * 1000)
      : existing[0].endsAt;
  if (endsAt && endsAt <= startsAt) {
    throw new Error('ends_at must be after starts_at.');
  }
  const [row] = await db
    .update(schema.calendarEvents)
    .set({
      title: args.title ?? existing[0].title,
      description: args.description !== undefined ? args.description : existing[0].description,
      location: args.location !== undefined ? args.location : existing[0].location,
      startsAt,
      endsAt,
      allDay: args.all_day ?? existing[0].allDay,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.calendarEvents.id, args.id),
        eq(schema.calendarEvents.profileId, ctx.profileId),
      ),
    )
    .returning();
  return { event: toDto(row) };
}

defineTool({
  name: 'update_calendar_event',
  description:
    'Update an existing calendar event. Only the provided fields change; call list_calendar_events first to get the event id.',
  parameters: updateCalendarEventSchema,
  execute: updateCalendarEvent,
});

// --------------------------------------------------------------- delete ---
export const deleteCalendarEventSchema = z.object({
  id: eventId.describe('Id of the event to delete (from list_calendar_events).'),
});

async function deleteCalendarEvent(
  args: z.infer<typeof deleteCalendarEventSchema>,
  ctx: ToolContext,
) {
  const { db } = await getDb();
  const deleted = await db
    .delete(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.id, args.id),
        eq(schema.calendarEvents.profileId, ctx.profileId),
      ),
    )
    .returning({ id: schema.calendarEvents.id });
  if (deleted.length === 0) {
    throw new Error(`No calendar event found with id "${args.id}".`);
  }
  return { deleted: true, id: args.id };
}

defineTool({
  name: 'delete_calendar_event',
  description:
    'Delete a calendar event by id. Call list_calendar_events first to confirm the id and title with the user when ambiguous.',
  parameters: deleteCalendarEventSchema,
  execute: deleteCalendarEvent,
});
