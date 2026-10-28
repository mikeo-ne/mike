/**
 * Per-action calendar tools (list/create/update/delete).
 *
 * Thin wrappers over the shared local store (`src/lib/calendar/local.ts`)
 * and the Google client. Mutations also emit a fire-and-forget payload to
 * the configured CALENDAR_WEBHOOK_URL (mock mode when unset).
 */
import { z } from 'zod';
import {
  createLocalEvent,
  deleteLocalEvent,
  listLocalEvents,
  updateLocalEvent,
} from '@/lib/calendar/local';
import {
  createGoogleEvent,
  deleteGoogleEvent,
  listGoogleEvents,
  updateGoogleEvent,
} from '@/lib/calendar/google';
import { notifyCalendarWebhook } from '@/lib/calendar/webhook';
import { defineTool, type ToolContext } from './registry';

const isoDateTime = z
  .string()
  .max(64)
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'Must be a valid ISO 8601 date-time, e.g. "2026-10-28T12:30:00".',
  });

const eventId = z.string().max(256);

const calendarSource = z
  .enum(['local', 'google'])
  .optional()
  .default('local')
  .describe(
    'Which calendar to use: "local" (1ne\'s built-in calendar) or "google" (the connected Google Calendar). Use "google" when the user refers to their Google Calendar.',
  );

// ---------------------------------------------------------------- list ---
export const listCalendarEventsSchema = z.object({
  calendar: calendarSource,
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
  if (args.calendar === 'google') {
    return listGoogleEvents(ctx.profileId, {
      from: args.from,
      to: args.to,
      query: args.query,
      limit: args.limit,
    });
  }
  return listLocalEvents(ctx.profileId, {
    from: args.from,
    to: args.to,
    query: args.query,
    limit: args.limit,
  });
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
  calendar: calendarSource,
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
  const calendar = args.calendar ?? 'local';
  const result =
    calendar === 'google'
      ? await createGoogleEvent(
          ctx.profileId,
          {
            title: args.title,
            starts_at: args.starts_at,
            ends_at: args.ends_at,
            description: args.description,
            location: args.location,
            all_day: args.all_day,
          },
          ctx.timezone,
        )
      : await createLocalEvent(ctx.profileId, {
          title: args.title,
          starts_at: args.starts_at,
          ends_at: args.ends_at,
          description: args.description,
          location: args.location,
          all_day: args.all_day,
        });
  notifyCalendarWebhook({
    action: 'created',
    calendar,
    event: result.event as unknown as Record<string, unknown>,
    conflicts: result.conflicts as unknown as Array<Record<string, unknown>>,
  });
  return result;
}

defineTool({
  name: 'create_calendar_event',
  description:
    'Create a calendar event. Resolve relative dates ("tomorrow at 3pm") to an exact ISO date-time first — call get_current_time when unsure what today is. The result includes "conflicts" (existing events overlapping the new one) — always check them and warn the user when non-empty.',
  parameters: createCalendarEventSchema,
  execute: createCalendarEvent,
});

// --------------------------------------------------------------- update ---
export const updateCalendarEventSchema = z.object({
  calendar: calendarSource,
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
  const calendar = args.calendar ?? 'local';
  const result =
    calendar === 'google'
      ? await updateGoogleEvent(
          ctx.profileId,
          args.id,
          {
            title: args.title,
            starts_at: args.starts_at,
            ends_at: args.ends_at,
            description: args.description ?? undefined,
            location: args.location ?? undefined,
            all_day: args.all_day,
          },
          ctx.timezone,
        )
      : await updateLocalEvent(ctx.profileId, args.id, {
          title: args.title,
          starts_at: args.starts_at,
          ends_at: args.ends_at,
          description: args.description ?? undefined,
          location: args.location ?? undefined,
          all_day: args.all_day,
        });
  notifyCalendarWebhook({
    action: 'updated',
    calendar,
    event: result.event as unknown as Record<string, unknown>,
    conflicts: result.conflicts as unknown as Array<Record<string, unknown>>,
  });
  return result;
}

defineTool({
  name: 'update_calendar_event',
  description:
    'Update an existing calendar event. Only the provided fields change; call list_calendar_events first to get the event id. When times change, the result includes "conflicts" (overlapping events) — always surface them to the user.',
  parameters: updateCalendarEventSchema,
  execute: updateCalendarEvent,
});

// --------------------------------------------------------------- delete ---
export const deleteCalendarEventSchema = z.object({
  calendar: calendarSource,
  id: eventId.describe('Id of the event to delete (from list_calendar_events).'),
});

async function deleteCalendarEvent(
  args: z.infer<typeof deleteCalendarEventSchema>,
  ctx: ToolContext,
) {
  const calendar = args.calendar ?? 'local';
  const result =
    calendar === 'google'
      ? await deleteGoogleEvent(ctx.profileId, args.id)
      : await deleteLocalEvent(ctx.profileId, args.id);
  notifyCalendarWebhook({
    action: 'deleted',
    calendar,
    event: { id: args.id },
  });
  return result;
}

defineTool({
  name: 'delete_calendar_event',
  description:
    'Delete a calendar event by id. Call list_calendar_events first to confirm the id and title with the user when ambiguous.',
  parameters: deleteCalendarEventSchema,
  execute: deleteCalendarEvent,
});
