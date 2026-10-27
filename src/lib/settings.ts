/**
 * Profile settings helpers (server-only).
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Best-effort lookup of the profile's saved IANA timezone. */
export async function getProfileTimezone(
  profileId: string,
): Promise<string | null> {
  try {
    const { db } = await getDb();
    const rows = await db
      .select()
      .from(schema.profileSettings)
      .where(eq(schema.profileSettings.profileId, profileId))
      .limit(1);
    const tz = rows[0]?.timezone?.trim();
    return tz && isValidTimezone(tz) ? tz : null;
  } catch {
    return null;
  }
}
