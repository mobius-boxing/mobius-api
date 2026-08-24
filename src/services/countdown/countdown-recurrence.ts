import { CountdownRecurrenceUnit } from "../../interfaces/countdown/countdown.interfaces";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function format(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The next due date for a recurring document.
 *
 * A due date is a *calendar* date, so every step of this runs on UTC parts and
 * never on a local-time Date — the same reason `countdown_documents.dueDate` is
 * DATE and not TIMESTAMPTZ.
 *
 * Month and year steps clamp to the end of the target month: 31 January plus one
 * month is 28 February, not 3 March. Plain `Date` arithmetic overflows into the
 * following month, which would silently walk a monthly invoice's due date
 * forward a few days every year.
 */
export function nextDueDate(
  dueDate: string,
  count: number,
  unit: CountdownRecurrenceUnit,
): string {
  const parts = ISO_DATE.exec(dueDate);
  if (!parts) throw new Error(`[recurrence] not a calendar date: ${dueDate}`);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`[recurrence] step must be a positive integer: ${count}`);
  }

  const year = Number(parts[1]);
  const month = Number(parts[2]) - 1;
  const day = Number(parts[3]);

  if (unit === "day") {
    return format(new Date(Date.UTC(year, month, day + count)));
  }

  const months = unit === "year" ? count * 12 : count;
  const absolute = year * 12 + month + months;
  const targetYear = Math.floor(absolute / 12);
  const targetMonth = absolute - targetYear * 12;

  // Day 0 of the *next* month is the last day of the target one.
  const lastDayOfTarget = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  return format(
    new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDayOfTarget))),
  );
}

/** Spanish, for the row and the export: "cada 2 meses". */
export function describeRecurrence(
  count: number,
  unit: CountdownRecurrenceUnit,
): string {
  const plural = count !== 1;
  const noun =
    unit === "day"
      ? plural
        ? "días"
        : "día"
      : unit === "month"
        ? plural
          ? "meses"
          : "mes"
        : plural
          ? "años"
          : "año";
  return plural ? `cada ${count} ${noun}` : `cada ${noun}`;
}
