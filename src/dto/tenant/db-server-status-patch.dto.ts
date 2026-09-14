import { collect } from "../input/shared/ValidationError";
import { oneOfText } from "../input/shared/fieldValidators";

/**
 * `PATCH /api/db-servers/:uuid` body (model, T10/D-50). Status changes are the
 * ONLY thing this endpoint accepts — `{ "status": "draining" }` and nothing
 * else (brief AC-61: "any other body returns 400"), so the allowed set is one
 * value, not the full `DB_SERVER_STATUSES` CHECK: `active`/`retired` are never
 * reached through this endpoint in this feature.
 */
export class DbServerStatusPatchInputDTO {
  status: "draining";

  constructor(data: any) {
    this.status = data?.status;
  }

  public build(): this {
    collect((field) => {
      this.status = field("status", () =>
        oneOfText(this.status, ["draining"] as const, "El estado"),
      );
    });
    return this;
  }
}
