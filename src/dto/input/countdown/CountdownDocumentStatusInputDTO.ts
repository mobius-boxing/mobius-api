import { CountdownDocumentStatus } from "../../../interfaces/countdown/countdown.interfaces";
import {
  assertCalendarDate,
  emptyToUndefined,
} from "./CountdownDocumentCreateInputDTO";

const STATUSES: CountdownDocumentStatus[] = ["pending", "resolved"];

/**
 * Resolving may also create the next occurrence. `nextDueDate` overrides what the
 * recurrence would compute, so the person resolving can correct a date the
 * supplier moved.
 */
export class CountdownDocumentStatusInputDTO {
  status: CountdownDocumentStatus;
  renew: boolean;
  nextDueDate?: string;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    const status = source.status;
    if (
      typeof status !== "string" ||
      !STATUSES.includes(status as CountdownDocumentStatus)
    ) {
      throw new Error("Estado inválido: usá pending o resolved");
    }
    this.status = status as CountdownDocumentStatus;
    this.renew = source.renew === true;
    const nextDueDate = emptyToUndefined(source.nextDueDate);
    if (nextDueDate !== undefined) {
      this.nextDueDate = assertCalendarDate(nextDueDate);
    }
  }

  public build(): this {
    // Reopening and renewing at once would produce two live copies of the same
    // obligation.
    if (this.renew && this.status !== "resolved") {
      throw new Error("Sólo se puede renovar al resolver");
    }
    return this;
  }
}
