import { collect } from "../input/shared/ValidationError";
import { requiredText } from "../input/shared/fieldValidators";

/**
 * `POST /api/companies/:uuid/tenant-database/suspend` body (model, T10).
 * `reason` is required text, ≤ 500 chars (brief AC-60) — an operator always
 * records why a tenant went dark, since the same string surfaces later on the
 * registry row (`suspendReason`).
 */
export const TENANT_SUSPEND_LIMITS = { reason: 500 };
export const TENANT_SUSPEND_LABELS = { reason: "El motivo" };

export class TenantSuspendInputDTO {
  reason: string;

  constructor(data: any) {
    this.reason = data?.reason;
  }

  public build(): this {
    collect((field) => {
      this.reason = field("reason", () =>
        requiredText(
          this.reason,
          TENANT_SUSPEND_LIMITS.reason,
          TENANT_SUSPEND_LABELS.reason,
        ),
      );
    });
    return this;
  }
}
