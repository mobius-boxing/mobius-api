import { CountdownRecurrenceUnit } from "../../../interfaces/countdown/countdown.interfaces";
import {
  assertCalendarDate,
  assertRecurrencePair,
  assertUuid,
  emptyToUndefined,
  optionalText,
  toAmountCents,
  toCurrency,
  toRecurrenceCount,
  toRecurrenceUnit,
  toReminderDays,
} from "./CountdownDocumentCreateInputDTO";

/**
 * Patch shape: only the fields actually sent are set, and `build()` strips the
 * rest so the DAO never writes a column the caller did not mention.
 *
 * Assignments are deliberately absent: they are replaced through
 * `PUT /documents/:uuid/assignments`, which is permission-gated. Accepting them
 * here and ignoring them (as the original schema did) is the accepted-but-ignored
 * parameter trap (L-007).
 */
export class CountdownDocumentUpdateInputDTO {
  title?: string;
  issuer?: string;
  referenceNumber?: string;
  category?: string;
  subcategory?: string;
  notes?: string;
  amountCents?: number;
  currency?: string;
  dueDate?: string;
  recurrenceCount?: number;
  recurrenceUnit?: CountdownRecurrenceUnit;
  /** Same 0..365 rule as on create; sent alone it is a complete patch. */
  reminderDays?: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (emptyToUndefined(source.title) !== undefined) {
      this.title = String(source.title).trim();
    }
    const issuer = optionalText(source.issuer, 200, "El emisor");
    if (issuer !== undefined) this.issuer = issuer;
    const referenceNumber = optionalText(
      source.referenceNumber,
      100,
      "El número de referencia",
    );
    if (referenceNumber !== undefined) this.referenceNumber = referenceNumber;
    if (emptyToUndefined(source.category) !== undefined) {
      this.category = assertUuid(source.category, "Elegí un rubro");
    }
    if (emptyToUndefined(source.subcategory) !== undefined) {
      this.subcategory = assertUuid(source.subcategory, "Sub-rubro inválido");
    }
    const notes = optionalText(source.notes, 5000, "Las notas");
    if (notes !== undefined) this.notes = notes;
    const amountCents = toAmountCents(source.amountCents);
    if (amountCents !== undefined) this.amountCents = amountCents;
    const currency = toCurrency(source.currency);
    if (currency !== undefined) this.currency = currency;
    if (emptyToUndefined(source.dueDate) !== undefined) {
      this.dueDate = assertCalendarDate(source.dueDate);
    }
    const recurrenceCount = toRecurrenceCount(source.recurrenceCount);
    if (recurrenceCount !== undefined) this.recurrenceCount = recurrenceCount;
    const recurrenceUnit = toRecurrenceUnit(source.recurrenceUnit);
    if (recurrenceUnit !== undefined) this.recurrenceUnit = recurrenceUnit;
    const reminderDays = toReminderDays(source.reminderDays);
    if (reminderDays !== undefined) this.reminderDays = reminderDays;
  }

  public build(): this {
    if (this.title !== undefined && this.title.length === 0) {
      throw new Error("El título es obligatorio");
    }
    if (this.title !== undefined && this.title.length > 200) {
      throw new Error("El título no puede superar los 200 caracteres");
    }
    // Both or neither, on the patch too: sending only a count would leave the
    // stored pair inconsistent with itself.
    assertRecurrencePair(this.recurrenceCount, this.recurrenceUnit);

    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    if (Object.keys(self).length === 0) {
      throw new Error("No hay cambios para aplicar");
    }
    return this;
  }
}
