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
}

export const DEFAULT_PREFERENCES: ProfilePreferences = {
  timezone: null,
  schedulingRules: null,
  systemInstructions: null,
  workdayStart: null,
  workdayEnd: null,
  preferredCalendar: 'local',
};

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
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
    if (!row) return { ...DEFAULT_PREFERENCES };
    const tz = row.timezone?.trim();
    return {
      timezone: tz && isValidTimezone(tz) ? tz : null,
      schedulingRules: row.schedulingRules?.trim() || null,
      systemInstructions: row.systemInstructions?.trim() || null,
      workdayStart: row.workdayStart?.trim() || null,
      workdayEnd: row.workdayEnd?.trim() || null,
      preferredCalendar:
        row.preferredCalendar === 'google' ? 'google' : 'local',
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Best-effort lookup of the profile's saved IANA timezone. */
export async function getProfileTimezone(
  profileId: string,
): Promise<string | null> {
  return (await getProfilePreferences(profileId)).timezone;
}
