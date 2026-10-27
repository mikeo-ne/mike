import { z } from 'zod';
import { defineTool } from './registry';

export const getCurrentTimeSchema = z.object({
  timezone: z
    .string()
    .max(64)
    .optional()
    .describe(
      'IANA timezone for the human-readable time, e.g. "Africa/Kampala" or "America/New_York". Defaults to the server timezone.',
    ),
});

defineTool({
  name: 'get_current_time',
  description:
    'Get the current date and time. Use this before interpreting relative dates like "today", "tomorrow", or "next Friday".',
  parameters: getCurrentTimeSchema,
  execute: async (args) => {
    const now = new Date();
    let timezone = args.timezone?.trim() || undefined;
    if (timezone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch {
        throw new Error(
          `Unknown timezone "${timezone}". Use an IANA name like "Africa/Kampala".`,
        );
      }
    } else {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);
    return {
      iso: now.toISOString(),
      unix_ms: now.getTime(),
      timezone,
      local,
    };
  },
});
