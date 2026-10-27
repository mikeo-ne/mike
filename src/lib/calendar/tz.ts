/**
 * Timezone-correct calendar window helpers (no external deps).
 */

/** Offset of `tz` at instant `d`, in minutes east of UTC. */
export function offsetMinutesAt(d: Date, tz: string): number {
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

/** YYYY-MM-DD of instant `d` in `tz`. */
export function ymdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Today's YYYY-MM-DD in `tz`. */
export function todayInTz(tz: string): string {
  return ymdInTz(new Date(), tz);
}

/**
 * UTC [start, end) covering calendar day `dateStr` in `tz`.
 * Two-pass refinement handles DST transitions inside the day.
 */
export function zonedDayRange(
  dateStr: string,
  tz: string,
): { start: Date; end: Date } {
  const midnightUtc = Date.parse(`${dateStr}T00:00:00Z`);
  let offset = offsetMinutesAt(new Date(midnightUtc), tz);
  let startMs = midnightUtc - offset * 60000;
  offset = offsetMinutesAt(new Date(startMs), tz);
  startMs = midnightUtc - offset * 60000;
  return { start: new Date(startMs), end: new Date(startMs + 24 * 3600 * 1000) };
}

function mondayBasedDow(d: Date, tz: string): number {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).format(d);
  const sunBased = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
  return (sunBased + 6) % 7; // 0 = Monday
}

/** UTC [start, end) covering the Monday–Sunday week containing `dateStr`. */
export function zonedWeekRange(
  dateStr: string,
  tz: string,
): { start: Date; end: Date } {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const ymd = ymdInTz(probe, tz);
  const backDays = mondayBasedDow(probe, tz);
  const mondayUtc = Date.parse(`${ymd}T00:00:00Z`) - backDays * 86400_000;
  const mondayYmd = new Date(mondayUtc).toISOString().slice(0, 10);
  const { start } = zonedDayRange(mondayYmd, tz);
  return { start, end: new Date(start.getTime() + 7 * 86400_000) };
}

/** UTC [start, end) covering the calendar month containing `dateStr`. */
export function zonedMonthRange(
  dateStr: string,
  tz: string,
): { start: Date; end: Date } {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const [y, m] = ymdInTz(probe, tz).split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const next =
    m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const { start } = zonedDayRange(first, tz);
  const { start: end } = zonedDayRange(next, tz);
  return { start, end };
}
