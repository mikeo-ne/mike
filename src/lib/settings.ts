/**
 * Profile preferences helpers (server-only). Backed by `user_preferences`.
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';

export interface ProfilePreferences {
  timezone: string | null;
  schedulingRules: string | null;
  systemInstructions: string | null;
  workdayStart: string | null;
  workdayEnd: string | null;
  preferredCalendar: 'local' | 'google';
  agentName: string;
  disabledTools: string[];
}

export const DEFAULT_PREFERENCES: ProfilePreferences = {
  timezone: null,
  schedulingRules: null,
  systemInstructions: null,
  workdayStart: null,
  workdayEnd: null,
  preferredCalendar: 'local',
  agentName: '1ne',
  disabledTools: [],
};

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function cleanDisabledTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (name && seen.size < 60) seen.add(name);
  }
  return [...seen];
}

/** Best-effort lookup of the profile's preferences (defaults when absent). */
export async function getProfilePreferences(
  profileId: string,
): Promise<ProfilePreferences> {
  try {
    const { db } = await getDb();
    const rows = await db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.profileId, profileId))
      .limit(1);
    const row = rows[0];
    if (!row) return { ...DEFAULT_PREFERENCES, disabledTools: [] };
    const tz = row.timezone?.trim();
    return {
      timezone: tz && isValidTimezone(tz) ? tz : null,
      schedulingRules: row.schedulingRules?.trim() || null,
      systemInstructions: row.systemInstructions?.trim() || null,
      workdayStart: row.workdayStart?.trim() || null,
      workdayEnd: row.workdayEnd?.trim() || null,
      preferredCalendar:
        row.preferredCalendar === 'google' ? 'google' : 'local',
      agentName: row.agentName?.trim() || '1ne',
      disabledTools: cleanDisabledTools(row.disabledTools),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES, disabledTools: [] };
  }
}

/** Best-effort lookup of the profile's saved IANA timezone. */
export async function getProfileTimezone(
  profileId: string,
): Promise<string | null> {
  return (await getProfilePreferences(profileId)).timezone;
}
