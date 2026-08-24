import { validate as isUuid } from "uuid";
import { CountdownRecurrenceUnit } from "../../../interfaces/countdown/countdown.interfaces";
import { toUuidList } from "./CountdownAssignmentsInputDTO";

export const COUNTDOWN_RECURRENCE_UNITS: CountdownRecurrenceUnit[] = [
  "day",
  "month",
  "year",
];

/**
 * Empty inputs arrive as "" from the browser's own form controls — an unchosen
 * <select> or a cleared text box — which must mean "not provided", not "set to
 * empty".
 */
export function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

export function optionalText(
  value: unknown,
  max: number,
  label: string,
): string | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new Error(`${label} debe ser texto`);
  const trimmed = raw.trim();
  if (trimmed.length > max) {
    throw new Error(`${label} no puede superar los ${max} caracteres`);
  }
  return trimmed;
}

/**
 * Calendar date, 'YYYY-MM-DD'. Rejects impossible dates like 2026-02-31, which
 * `new Date()` would happily roll into March — a due date that silently moves is
 * exactly what this module exists to prevent.
 */
export function assertCalendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Formato de fecha inválido (YYYY-MM-DD)");
  }
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Fecha inexistente");
  }
  return value;
}

export function assertUuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw new Error(message);
  return value;
}

/** Money crosses the wire as integer cents — never a float, never a string. */
export function toAmountCents(value: unknown): number | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error("El importe debe ser un número entero de centavos");
  }
  if (parsed < 0) throw new Error("El importe no puede ser negativo");
  return parsed;
}

export function toCurrency(value: unknown): string | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new Error("Moneda inválida");
  const currency = raw.trim().toUpperCase();
  if (currency.length !== 3) throw new Error("La moneda debe tener 3 letras");
  return currency;
}

export function toRecurrenceCount(value: unknown): number | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error("Indicá cada cuántos días, meses o años se repite");
  }
  if (parsed < 1) throw new Error("Mínimo 1");
  if (parsed > 365) throw new Error("Máximo 365");
  return parsed;
}

/**
 * How many days before the due date this document starts being reported, and
 * keeps being reported for — the window has no lower bound, so an overdue
 * document stays in every digest until somebody resolves it.
 *
 * 0 is legal and means "only from the due date onward". Absent means "leave it
 * to the column default" (7): a create payload that never mentions the field
 * must not start failing (D-8).
 *
 * The 0..365 bounds live here and only here — the column carries no CHECK
 * constraint (host rule), so this IS the constraint. 365 mirrors the recurrence
 * bound above.
 */
export function toReminderDays(value: unknown): number | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error("Los días de aviso deben ser un número entero");
  }
  if (parsed < 0) throw new Error("Mínimo 0 días de aviso");
  if (parsed > 365) throw new Error("Máximo 365 días de aviso");
  return parsed;
}

export function toRecurrenceUnit(
  value: unknown,
): CountdownRecurrenceUnit | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  if (
    typeof raw !== "string" ||
    !COUNTDOWN_RECURRENCE_UNITS.includes(raw as CountdownRecurrenceUnit)
  ) {
    throw new Error("Indicá cada cuántos días, meses o años se repite");
  }
  return raw as CountdownRecurrenceUnit;
}

/**
 * Recurrence is a count plus a unit — "every 2 months" — and the two travel
 * together or not at all. The database carries no CHECK constraint for it (host
 * rule), so this is the only thing standing between the table and a count with
 * no unit, which means nothing.
 */
export function assertRecurrencePair(
  count: number | undefined,
  unit: CountdownRecurrenceUnit | undefined,
): void {
  if ((count === undefined) !== (unit === undefined)) {
    throw new Error("Indicá cada cuántos días, meses o años se repite");
  }
}

export class CountdownDocumentCreateInputDTO {
  title: string;
  issuer?: string;
  referenceNumber?: string;
  /**
   * Optional: a company that has not finished classifying its paperwork must
   * still be able to file an expiration. Absent, `""` and `null` all mean "no
   * rubro" and are filed as such; only a present, non-empty, non-uuid value is
   * an error, and it says `"Rubro inválido"` rather than `"Elegí un rubro"` —
   * not choosing one is legal now (D-3).
   */
  category?: string;
  /** Optional, and refused by the service unless a rubro travels with it. */
  subcategory?: string;
  notes?: string;
  amountCents?: number;
  currency: string;
  dueDate: string;
  recurrenceCount?: number;
  recurrenceUnit?: CountdownRecurrenceUnit;
  /** Absent means "use the column default" — never a 400 (D-8). */
  reminderDays?: number;
  resolverUsers: string[];
  resolverGroups: string[];
  watcherUsers: string[];
  watcherGroups: string[];

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.title = typeof source.title === "string" ? source.title.trim() : "";
    const issuer = optionalText(source.issuer, 200, "El emisor");
    if (issuer !== undefined) this.issuer = issuer;
    const referenceNumber = optionalText(
      source.referenceNumber,
      100,
      "El número de referencia",
    );
    if (referenceNumber !== undefined) this.referenceNumber = referenceNumber;
    // `null` is the frontend's "no rubro" (an empty <select> becomes
    // `value || null`, AC-16) and must not be mistaken for a malformed uuid on
    // create either — that is the whole of the create-side trap.
    const category = emptyToUndefined(source.category);
    if (category !== undefined && category !== null) {
      this.category = assertUuid(category, "Rubro inválido");
    }
    const subcategory = emptyToUndefined(source.subcategory);
    if (subcategory !== undefined && subcategory !== null) {
      this.subcategory = assertUuid(subcategory, "Sub-rubro inválido");
    }
    const notes = optionalText(source.notes, 5000, "Las notas");
    if (notes !== undefined) this.notes = notes;
    const amountCents = toAmountCents(source.amountCents);
    if (amountCents !== undefined) this.amountCents = amountCents;
    this.currency = toCurrency(source.currency) ?? "ARS";
    this.dueDate = typeof source.dueDate === "string" ? source.dueDate : "";
    const recurrenceCount = toRecurrenceCount(source.recurrenceCount);
    if (recurrenceCount !== undefined) this.recurrenceCount = recurrenceCount;
    const recurrenceUnit = toRecurrenceUnit(source.recurrenceUnit);
    if (recurrenceUnit !== undefined) this.recurrenceUnit = recurrenceUnit;
    const reminderDays = toReminderDays(source.reminderDays);
    if (reminderDays !== undefined) this.reminderDays = reminderDays;
    this.resolverUsers = toUuidList(source.resolverUsers, "resolverUsers");
    this.resolverGroups = toUuidList(source.resolverGroups, "resolverGroups");
    this.watcherUsers = toUuidList(source.watcherUsers, "watcherUsers");
    this.watcherGroups = toUuidList(source.watcherGroups, "watcherGroups");
  }

  /** Throws on anything the table would accept but the business would not. */
  public build(): this {
    if (this.title.length === 0) throw new Error("El título es obligatorio");
    if (this.title.length > 200) {
      throw new Error("El título no puede superar los 200 caracteres");
    }
    assertCalendarDate(this.dueDate);
    assertRecurrencePair(this.recurrenceCount, this.recurrenceUnit);
    return this;
  }
}
