/**
 * Local (Postgres-backed) calendar store. Shared by the calendar tools,
 * the schedule tools, and the agenda tool so every path has identical
 * semantics. Server-only.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, ilike, isNull, lt, lte, or } from 'drizzle-orm';
import { getDb, schema } from '@/db';

export interface LocalEventDto {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}

export function toLocalDto(
  e: typeof schema.calendarEvents.$inferSelect,
): LocalEventDto {
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

/**
 * Finds events overlapping [startsAt, endsAt). Events with no end are treated
 * as 1 hour long for overlap purposes.
 */
export async function findLocalConflicts(
  profileId: string,
  startsAt: Date,
  endsAt: Date,
  excludeId?: string,
): Promise<LocalEventDto[]> {
  const { db } = await getDb();
  const candidates = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.profileId, profileId),
        lt(schema.calendarEvents.startsAt, endsAt),
        or(
          gt(schema.calendarEvents.endsAt, startsAt),
          isNull(schema.calendarEvents.endsAt),
        ),
      ),
    )
    .orderBy(asc(schema.calendarEvents.startsAt))
    .limit(25);
  return candidates
    .filter((e) => e.id !== excludeId)
    .filter((e) => {
      const existingEnd = e.endsAt ?? new Date(e.startsAt.getTime() + 3600_000);
      return e.startsAt < endsAt && existingEnd > startsAt;
    })
    .map(toLocalDto);
}

export interface LocalListArgs {
  from?: string;
  to?: string;
  query?: string;
  limit: number;
}

export async function listLocalEvents(
  profileId: string,
  args: LocalListArgs,
): Promise<{ events: LocalEventDto[]; count: number }> {
  const { db } = await getDb();
  const conditions = [eq(schema.calendarEvents.profileId, profileId)];
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
  return { events: rows.map(toLocalDto), count: rows.length };
}

export interface LocalCreateArgs {
  title: string;
  starts_at: string;
  ends_at?: string;
  description?: string;
  location?: string;
  all_day?: boolean;
}

export async function createLocalEvent(
  profileId: string,
  args: LocalCreateArgs,
): Promise<{
  event: LocalEventDto;
  conflicts: LocalEventDto[];
  conflicts_count: number;
}> {
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
      profileId,
      title: args.title,
      description: args.description ?? null,
      location: args.location ?? null,
      startsAt,
      endsAt,
      allDay: args.all_day ?? false,
    })
    .returning();
  const conflicts = await findLocalConflicts(profileId, startsAt, endsAt, row.id);
  return {
    event: toLocalDto(row),
    conflicts,
    conflicts_count: conflicts.length,
  };
}

export interface LocalUpdateArgs {
  title?: string;
  starts_at?: string;
  ends_at?: string;
  description?: string | null;
  location?: string | null;
  all_day?: boolean;
}

export async function updateLocalEvent(
  profileId: string,
  id: string,
  args: LocalUpdateArgs,
): Promise<{
  event: LocalEventDto;
  conflicts: LocalEventDto[];
  conflicts_count: number;
}> {
  const { db } = await getDb();
  const existing = await db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.id, id),
        eq(schema.calendarEvents.profileId, profileId),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    throw new Error(`No calendar event found with id "${id}".`);
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
      description:
        args.description !== undefined ? args.description : existing[0].description,
      location:
        args.location !== undefined ? args.location : existing[0].location,
      startsAt,
      endsAt,
      allDay: args.all_day ?? existing[0].allDay,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.calendarEvents.id, id),
        eq(schema.calendarEvents.profileId, profileId),
      ),
    )
    .returning();
  const effectiveEnd = row.endsAt ?? new Date(row.startsAt.getTime() + 3600_000);
  const conflicts =
    args.starts_at || args.ends_at
      ? await findLocalConflicts(profileId, row.startsAt, effectiveEnd, row.id)
      : [];
  return {
    event: toLocalDto(row),
    conflicts,
    conflicts_count: conflicts.length,
  };
}

export async function deleteLocalEvent(
  profileId: string,
  id: string,
): Promise<{ deleted: boolean; id: string }> {
  const { db } = await getDb();
  const deleted = await db
    .delete(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.id, id),
        eq(schema.calendarEvents.profileId, profileId),
      ),
    )
    .returning({ id: schema.calendarEvents.id });
  if (deleted.length === 0) {
    throw new Error(`No calendar event found with id "${id}".`);
  }
  return { deleted: true, id };
}
