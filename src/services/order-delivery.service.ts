import type { Knex } from "knex";
import { OrderDeliveryDAO } from "../dao/order-delivery/order-delivery.dao";
import {
  DELIVERY_AMOUNT_TYPES,
  DeliveryAmountType,
  DeliveryParentColumn,
  IDelivery,
  IDeliveryInput,
  IDeliveryRow,
  IDeliveryStoredRow,
  IDeliverySummary,
} from "../interfaces/order-delivery/order-delivery.interfaces";

/**
 * The one place deliveries are validated, resolved, replaced and derived from —
 * quotations and sales orders both go through it (model-r2 §API contracts).
 * A percentage row is resolved against the parent's quantity on every read and
 * never stored as a quantity (I-20).
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Float comparison tolerance for `deliveriesMatch` (L-010: no rounding anywhere). */
const MATCH_TOLERANCE = 1e-9;

const MAX_DELIVERIES = 100;

export type DeliveryResolution =
  | { ok: true; rows: IDeliveryRow[] }
  | { ok: false; message: string };

export class OrderDeliveryService {
  private dao = new OrderDeliveryDAO();

  /** `undefined` when the key is absent; throws a plain `Error` (a 400) on a bad body. */
  static parseInput(raw: unknown): IDeliveryInput[] | undefined {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) throw new Error("deliveries must be an array");
    if (raw.length > MAX_DELIVERIES) {
      throw new Error(`deliveries accepts at most ${MAX_DELIVERIES} rows`);
    }
    return raw.map((item, index) => {
      const at = `deliveries[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`${at} must be an object`);
      }
      const body = item as Record<string, unknown>;

      if (
        typeof body.deliveryDate !== "string" ||
        Number.isNaN(new Date(body.deliveryDate).getTime())
      ) {
        throw new Error(`${at}.deliveryDate must be an ISO date`);
      }

      let deliveryLocationUuid: string | null = null;
      if (
        body.deliveryLocationUuid != null &&
        body.deliveryLocationUuid !== ""
      ) {
        if (
          typeof body.deliveryLocationUuid !== "string" ||
          !UUID_PATTERN.test(body.deliveryLocationUuid.trim())
        ) {
          throw new Error(`${at}.deliveryLocationUuid must be a uuid`);
        }
        deliveryLocationUuid = body.deliveryLocationUuid.trim().toLowerCase();
      }

      if (
        !(DELIVERY_AMOUNT_TYPES as readonly unknown[]).includes(body.amountType)
      ) {
        throw new Error(
          `${at}.amountType must be one of ${DELIVERY_AMOUNT_TYPES.join(", ")}`,
        );
      }
      const amountType = body.amountType as DeliveryAmountType;

      const amount =
        typeof body.amount === "string" && body.amount.trim() !== ""
          ? Number(body.amount)
          : body.amount;
      if (typeof amount !== "number" || !Number.isFinite(amount)) {
        throw new Error(`${at}.amount must be a number`);
      }
      if (amount <= 0) {
        throw new Error(`${at}.amount must be greater than zero`);
      }
      if (amountType === "percentage" && amount > 100) {
        throw new Error(`${at}.amount cannot exceed 100 for a percentage`);
      }

      return {
        deliveryDate: body.deliveryDate,
        deliveryLocationUuid,
        amountType,
        amount,
      };
    });
  }

  /** Maps each location uuid to its id; a location outside the company or of another customer is refused. */
  async resolve(
    inputs: IDeliveryInput[],
    customerId: number,
    companyId: number,
  ): Promise<DeliveryResolution> {
    const uuids = [
      ...new Set(
        inputs
          .map((i) => i.deliveryLocationUuid)
          .filter((u): u is string => u !== null),
      ),
    ];
    const locations = await this.dao.locationsByUuid(uuids, companyId);
    const rows: IDeliveryRow[] = [];
    for (const [index, input] of inputs.entries()) {
      let deliveryLocationId: number | null = null;
      if (input.deliveryLocationUuid !== null) {
        const location = locations.get(input.deliveryLocationUuid);
        if (!location) {
          return {
            ok: false,
            message: `deliveries[${index}].deliveryLocationUuid: delivery location not found`,
          };
        }
        if (location.customerId !== customerId) {
          return {
            ok: false,
            message: `deliveries[${index}].deliveryLocationUuid: delivery location does not belong to the selected customer`,
          };
        }
        deliveryLocationId = location.id;
      }
      rows.push({
        deliveryDate: input.deliveryDate,
        deliveryLocationId,
        amountType: input.amountType,
        amount: input.amount,
      });
    }
    return { ok: true, rows };
  }

  static quantityOf(
    row: { amountType: DeliveryAmountType; amount: number },
    parentQuantity: number,
  ): number {
    return row.amountType === "percentage"
      ? (parentQuantity * row.amount) / 100
      : row.amount;
  }

  /** Earliest date; ties go to the lowest position (rows arrive ordered by position). */
  static earliest<T extends { deliveryDate: Date | string }>(
    rows: T[],
  ): T | null {
    let best: T | null = null;
    for (const row of rows) {
      if (
        best === null ||
        new Date(row.deliveryDate).getTime() <
          new Date(best.deliveryDate).getTime()
      ) {
        best = row;
      }
    }
    return best;
  }

  /** `deliveries` / `deliveriesTotal` / `deliveriesMatch` for many parents, one query. */
  async summaries(
    column: DeliveryParentColumn,
    parents: { id: number; quantity: number }[],
  ): Promise<Map<number, IDeliverySummary>> {
    const stored = await this.dao.listByParents(
      column,
      parents.map((p) => p.id),
    );
    const result = new Map<number, IDeliverySummary>();
    for (const parent of parents) {
      const deliveries: IDelivery[] = (stored.get(parent.id) ?? []).map(
        (row) => ({
          ...row,
          quantity: OrderDeliveryService.quantityOf(row, parent.quantity),
        }),
      );
      const deliveriesTotal = deliveries.reduce(
        (sum, d) => sum + d.quantity,
        0,
      );
      result.set(parent.id, {
        deliveries,
        deliveriesTotal,
        deliveriesMatch:
          deliveries.length === 0 ||
          Math.abs(deliveriesTotal - parent.quantity) < MATCH_TOLERANCE,
      });
    }
    return result;
  }

  async replaceTrx(
    trx: Knex.Transaction,
    parent: { column: DeliveryParentColumn; id: number },
    companyId: number,
    rows: IDeliveryRow[],
  ): Promise<void> {
    await this.dao.replaceTrx(trx, parent, companyId, rows);
  }

  /** Stored rows in write shape, to copy quote → order or feed generation. */
  rowsOf(parent: {
    column: DeliveryParentColumn;
    id: number;
  }): Promise<IDeliveryStoredRow[]> {
    return this.dao.rowsOf(parent);
  }

  /**
   * I-21, inside the sales order's own transaction: replace the rows when sent,
   * then — whenever the stored set is non-empty — write the derived date and
   * location, so nothing a caller sent can leave them out of step.
   */
  async syncSalesOrderTrx(
    trx: Knex.Transaction,
    order: { id: number; orderDataId: number | null; companyId: number },
    rows?: IDeliveryRow[],
  ): Promise<void> {
    const parent = { column: "salesOrderId" as const, id: order.id };
    if (rows !== undefined) {
      await this.dao.replaceTrx(trx, parent, order.companyId, rows);
    }
    const first = OrderDeliveryService.earliest(
      await this.dao.rowsOf(parent, trx),
    );
    if (!first) return;
    await trx("sales_orders")
      .where("id", order.id)
      .update({ deliveryDate: first.deliveryDate, updatedAt: trx.fn.now() });
    if (order.orderDataId !== null) {
      await trx("order_data").where("id", order.orderDataId).update({
        deliveryLocationId: first.deliveryLocationId,
        updatedAt: trx.fn.now(),
      });
    }
  }
}
