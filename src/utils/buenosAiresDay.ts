/**
 * "Today" for the countdown module, in the customer's calendar.
 *
 * The standalone app set `TIME ZONE 'America/Argentina/Buenos_Aires'` on every
 * pooled connection, so SQL `current_date` already meant the customer's today.
 * Mobius sets no session timezone (the server runs UTC), and changing that
 * globally would move every other module's timestamps — so the module computes
 * the day here instead and binds it as a parameter everywhere the original SQL
 * said `current_date`.
 *
 * Every "overdue" derivation, the dashboard summary, the reminder offsets and
 * the daily run claim MUST go through `todayInBuenosAires()`. One definition of
 * today, or a document is overdue in one query and not in the next.
 */
const TIMEZONE = "America/Argentina/Buenos_Aires";

/** 'YYYY-MM-DD' for the Buenos Aires calendar day containing `now`. */
export function todayInBuenosAires(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the wire format we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Whole calendar days from `from` to `to`, both 'YYYY-MM-DD'. Negative when `to`
 * is the earlier date.
 *
 * Parsed by `split("-")` + `Date.UTC`, never `new Date(string)`: both dates
 * become UTC midnights, so the subtraction is exact integer arithmetic and
 * agrees by construction with SQL's `date - date`. That agreement is the whole
 * point — the reminder batch computes an offset in SQL and re-derives it here
 * when it writes the digest, and the two must never disagree.
 */
export function calendarDaysBetween(from: string, to: string): number {
  const asUtc = (value: string): number => {
    const [year, month, day] = value.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    return Date.UTC(year, month - 1, day);
  };
  return (asUtc(to) - asUtc(from)) / 86_400_000;
}

/**
 * Argentina has kept a fixed UTC-3 offset (no DST) since 2009, so a BA
 * calendar day's midnight is always exactly 3 hours after that same
 * calendar date's UTC midnight — no `Intl` round-trip needed to invert it.
 */
const BA_UTC_OFFSET_HOURS = 3;

/**
 * UTC instant of local midnight starting the given Buenos Aires calendar day
 * (`'YYYY-MM-DD'`), optionally shifted by whole days. Column filters use this
 * for half-open day-range bounds: `dayRangeFilters`'s `To` bound is this same
 * day shifted by +1, compared with `<`, so a row timestamped anywhere in the
 * BA calendar day is included exactly once.
 */
export function startOfBuenosAiresDayUtc(day: string, daysToAdd = 0): Date {
  const [year, month, dayOfMonth] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(
    Date.UTC(year, month - 1, dayOfMonth + daysToAdd, BA_UTC_OFFSET_HOURS),
  );
}

/** Hour of the Buenos Aires day, 0–23. */
export function baLocalHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
}

/**
 * 0 Sunday … 6 Saturday, for the *Buenos Aires* calendar day. Read the local
 * date first and rebuild it in UTC: asking a Date for getDay() directly would
 * answer for the server's timezone, which is not the customer's.
 */
export function baLocalWeekday(now: Date): number {
  const [year, month, day] = todayInBuenosAires(now).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
