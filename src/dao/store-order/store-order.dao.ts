import KnexManager from "../../database/KnexConnection";
import {
  IStoreOrder,
  IStoreOrderItem,
  IStoreOrderWithItems,
  IStoreOrderWithItemCount,
  StoreOrderStatus,
} from "../../interfaces/store-order/store-order.interfaces";
import { v4 as uuidv4 } from "uuid";

// StoreOrderDAO does NOT implement IBaseDAO<IStoreOrder>: create has a two-arg
// (order, items) signature and there is no update/delete/getById in v1 scope.
// Local-DAO style (KnexManager.getConnection() per call) with private mappers.
export class StoreOrderDAO {
  private tableName = "store_orders";
  private itemsTableName = "store_order_items";

  // Atomic: the order row and all its item rows are inserted together, or not at all.
  // `order.companyId` and `order.storeUserId` are NUMERIC ids resolved by the controller
  // (store JWT company UUID -> companies.id; store user id from the JWT/lookup).
  async create(
    order: IStoreOrder,
    items: IStoreOrderItem[],
  ): Promise<IStoreOrderWithItems> {
    const knex = KnexManager.getConnection();

    const result = await knex.transaction(async (trx) => {
      const [newOrder] = await trx(this.tableName)
        .insert({
          uuid: order.uuid ?? uuidv4(),
          companyId: order.companyId,
          storeUserId: order.storeUserId ?? null,
          status: order.status ?? "pending",
          notes: order.notes ?? null,
        })
        .returning("*");

      const itemRows = items.map((item) => ({
        uuid: item.uuid ?? uuidv4(),
        orderId: newOrder.id,
        itemType: item.itemType,
        sourceUuid: item.sourceUuid ?? null,
        description: item.description, // snapshot
        quantity: item.quantity,
        unitsPerPallet: item.unitsPerPallet ?? null, // snapshot (boxes only)
      }));

      let insertedItems: any[] = [];
      if (itemRows.length > 0) {
        // Single batched INSERT ... RETURNING * — one roundtrip, no per-item loop.
        insertedItems = await trx(this.itemsTableName)
          .insert(itemRows)
          .returning("*");
      }

      return { order: newOrder, items: insertedItems };
    });

    return {
      ...this.mapToInterface(result.order),
      items: result.items.map((i) => this.mapItemToInterface(i)),
    };
  }

  // Company-scoped fetch of one order plus its items.
  // Two queries (order, then items) — acceptable: a single order has few items and
  // joining would duplicate the order row per item. Returns null if not found / wrong company.
  async getByUuid(
    uuid: string,
    companyId: number,
  ): Promise<IStoreOrderWithItems | null> {
    const knex = KnexManager.getConnection();

    // LEFT JOIN store_users to surface the buyer email on the detail view.
    // storeUserId may be null (SET NULL on store-user delete) -> LEFT JOIN, email nullable.
    // Only su.email is selected — passwordHash is never exposed.
    const order = await knex(this.tableName + " as o")
      .leftJoin("store_users as su", "su.id", "o.storeUserId")
      .where("o.uuid", uuid)
      .andWhere("o.companyId", companyId) // scoping — prevents cross-company reads
      .select("o.*", "su.email as storeUserEmail")
      .first();

    if (!order) return null;

    const items = await knex(this.itemsTableName)
      .where("orderId", order.id)
      .orderBy("id", "asc");

    return {
      ...this.mapToInterface(order),
      storeUserEmail: order.storeUserEmail ?? undefined,
      items: items.map((i) => this.mapItemToInterface(i)),
    };
  }

  // A store user's own orders (company-scoped defense-in-depth), newest first.
  // Single query: LEFT JOIN + GROUP BY computes itemCount in the DB — no N+1.
  async getAllForStoreUser(
    storeUserId: number,
    companyId: number,
  ): Promise<IStoreOrderWithItemCount[]> {
    const knex = KnexManager.getConnection();

    const rows = await knex(this.tableName + " as o")
      .leftJoin(this.itemsTableName + " as i", "i.orderId", "o.id")
      .where("o.storeUserId", storeUserId)
      .andWhere("o.companyId", companyId)
      .groupBy("o.id")
      .select("o.*")
      .count("i.id as itemCount")
      .orderBy("o.createdAt", "desc");

    return rows.map((r) => ({
      ...this.mapToInterface(r),
      itemCount: parseInt(r.itemCount as string) || 0,
    }));
  }

  // Admin list: every order for a company, newest first, each with its item count
  // and the buyer's email. Single query — LEFT JOIN items (aggregated to itemCount)
  // + LEFT JOIN store_users for the email. No N+1. storeUserId may be null
  // (store user deleted -> SET NULL), so the join is LEFT and email may be null.
  // Only su.email is selected — passwordHash is never exposed.
  async getAllForCompany(
    companyId: number,
  ): Promise<IStoreOrderWithItemCount[]> {
    const knex = KnexManager.getConnection();

    const rows = await knex(this.tableName + " as o")
      .leftJoin(this.itemsTableName + " as i", "i.orderId", "o.id")
      .leftJoin("store_users as su", "su.id", "o.storeUserId")
      .where("o.companyId", companyId)
      .groupBy("o.id", "su.email")
      .select("o.*", "su.email as storeUserEmail")
      .count("i.id as itemCount")
      .orderBy("o.createdAt", "desc");

    return rows.map((r) => ({
      ...this.mapToInterface(r),
      itemCount: parseInt(r.itemCount as string) || 0,
      storeUserEmail: (r.storeUserEmail as string | null) ?? undefined,
    }));
  }

  // Company-scoped status advance. One UPDATE, scoped by uuid AND companyId so a
  // company's admin can never touch another company's order. Returns null when no
  // row matched (wrong company / unknown uuid) -> controller 404s. On success returns
  // the full order with items (same shape as getByUuid, incl. buyer email) by re-reading
  // via getByUuid for response-shape parity. Single UPDATE -> no transaction.
  // `status` is validated against STORE_ORDER_STATUSES in the controller/DTO BEFORE this call.
  async updateStatus(
    uuid: string,
    companyId: number,
    status: StoreOrderStatus,
  ): Promise<IStoreOrderWithItems | null> {
    const knex = KnexManager.getConnection();

    const [updated] = await knex(this.tableName)
      .where("uuid", uuid)
      .andWhere("companyId", companyId)
      .update({ status, updatedAt: knex.fn.now() })
      .returning("*");

    if (!updated) return null;

    // Re-read via getByUuid so the response shape (incl. storeUserEmail) matches the detail view.
    return this.getByUuid(uuid, companyId);
  }

  private mapToInterface(record: any): IStoreOrder {
    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.companyId,
      storeUserId: record.storeUserId,
      status: record.status,
      notes: record.notes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private mapItemToInterface(record: any): IStoreOrderItem {
    return {
      id: record.id,
      uuid: record.uuid,
      orderId: record.orderId,
      itemType: record.itemType,
      sourceUuid: record.sourceUuid,
      description: record.description,
      quantity: record.quantity,
      unitsPerPallet: record.unitsPerPallet,
      createdAt: record.createdAt,
    };
  }
}
