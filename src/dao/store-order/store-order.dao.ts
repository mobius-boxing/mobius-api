import KnexManager from "../../database/KnexConnection";
import { Knex } from "knex";
import { IDataPaginator } from "../../database/d.types";
import {
  IStoreOrder,
  IStoreOrderItem,
  IStoreOrderWithItems,
  IStoreOrderWithItemCount,
  StoreOrderStatus,
} from "../../interfaces/store-order/store-order.interfaces";
import { v4 as uuidv4 } from "uuid";

// Shared list-query params for both admin and customer list variants.
// All optional: the controller resolves defaults via paginationHelper and
// validates `status` against STORE_ORDER_STATUSES before passing it here.
export interface IStoreOrderListParams {
  page: number;
  limit: number;
  status?: StoreOrderStatus;
  search?: string; // ILIKE on o.uuid::text (+ su.email for the admin variant)
  sortBy?: "createdAt" | "status";
  sortOrder?: "asc" | "desc";
}

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

  // Single source of truth for list scoping/filtering/search, shared by both list
  // variants AND by their data + count queries. Mutates and returns the builder so
  // the caller can chain GROUP BY / select / count. `joinStoreUsers` is true only for
  // the admin variant (it needs su.email for output + search); for the customer
  // variant ownership is enforced by the storeUserId param, so the join is skipped.
  //
  // DRY guarantee: the exact same WHERE/ILIKE predicates are applied to the data
  // query and the count query, so a filtered list and its total can never disagree.
  private applyListScope(
    knex: Knex,
    builder: Knex.QueryBuilder,
    params: {
      companyId: number;
      storeUserId?: number; // customer variant only
      status?: StoreOrderStatus;
      search?: string;
      joinStoreUsers: boolean;
    },
  ): Knex.QueryBuilder {
    builder.where("o.companyId", params.companyId);
    if (params.storeUserId !== undefined) {
      builder.andWhere("o.storeUserId", params.storeUserId);
    }
    if (params.status) {
      builder.andWhere("o.status", params.status);
    }
    if (params.search && params.search.trim().length > 0) {
      const term = `%${params.search.trim()}%`;
      builder.andWhere((qb) => {
        qb.whereRaw("o.uuid::text ILIKE ?", [term]);
        if (params.joinStoreUsers) {
          qb.orWhereRaw("su.email ILIKE ?", [term]);
        }
      });
    }
    return builder;
  }

  // Distinct-order total for the paginator. Reuses applyListScope so the count
  // matches the filtered/searched data set exactly. countDistinct over o.id
  // because the items LEFT JOIN would otherwise multiply rows.
  private async countList(
    knex: Knex,
    params: {
      companyId: number;
      storeUserId?: number;
      status?: StoreOrderStatus;
      search?: string;
      joinStoreUsers: boolean;
    },
  ): Promise<number> {
    let builder = knex(this.tableName + " as o");
    if (params.joinStoreUsers) {
      builder = builder.leftJoin("store_users as su", "su.id", "o.storeUserId");
    }
    builder = this.applyListScope(knex, builder, params);
    const row = await builder.countDistinct("o.id as count").first();
    return parseInt((row?.count as string) ?? "0", 10) || 0;
  }

  private resolveSort(params: IStoreOrderListParams): {
    column: string;
    order: "asc" | "desc";
  } {
    const column = params.sortBy === "status" ? "o.status" : "o.createdAt"; // default createdAt
    const order = params.sortOrder === "asc" ? "asc" : "desc"; // default desc
    return { column, order };
  }

  // A store user's own orders (company-scoped defense-in-depth), paginated.
  // Single data query: LEFT JOIN + GROUP BY computes itemCount in the DB — no N+1.
  // Returns the standard IDataPaginator shape; count query reuses applyListScope.
  async getAllForStoreUser(
    storeUserId: number,
    companyId: number,
    params: IStoreOrderListParams,
  ): Promise<IDataPaginator<IStoreOrderWithItemCount>> {
    const knex = KnexManager.getConnection();
    const { page, limit } = params;
    const offset = (page - 1) * limit;
    const scope = {
      companyId,
      storeUserId,
      status: params.status,
      search: params.search,
      joinStoreUsers: false,
    };
    const sort = this.resolveSort(params);

    let dataQuery = knex(this.tableName + " as o").leftJoin(
      this.itemsTableName + " as i",
      "i.orderId",
      "o.id",
    );
    dataQuery = this.applyListScope(knex, dataQuery, scope);

    const [rows, totalCount] = await Promise.all([
      dataQuery
        .groupBy("o.id")
        .select("o.*")
        .count("i.id as itemCount")
        .orderBy(sort.column, sort.order)
        .limit(limit)
        .offset(offset),
      this.countList(knex, scope),
    ]);

    const data = rows.map((r) => ({
      ...this.mapToInterface(r),
      itemCount: parseInt(r.itemCount as string) || 0,
    }));

    return {
      success: true,
      data,
      page,
      limit,
      count: data.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  // Admin list: every order for a company, paginated, each with its item count and
  // the buyer's email. Single data query — LEFT JOIN items (aggregated to itemCount)
  // + LEFT JOIN store_users for the email/search. No N+1. storeUserId may be null
  // (store user deleted -> SET NULL), so the join is LEFT and email may be null.
  // Only su.email is selected — passwordHash is never exposed.
  async getAllForCompany(
    companyId: number,
    params: IStoreOrderListParams,
  ): Promise<IDataPaginator<IStoreOrderWithItemCount>> {
    const knex = KnexManager.getConnection();
    const { page, limit } = params;
    const offset = (page - 1) * limit;
    const scope = {
      companyId,
      status: params.status,
      search: params.search,
      joinStoreUsers: true,
    };
    const sort = this.resolveSort(params);

    let dataQuery = knex(this.tableName + " as o")
      .leftJoin(this.itemsTableName + " as i", "i.orderId", "o.id")
      .leftJoin("store_users as su", "su.id", "o.storeUserId");
    dataQuery = this.applyListScope(knex, dataQuery, scope);

    const [rows, totalCount] = await Promise.all([
      dataQuery
        .groupBy("o.id", "su.email")
        .select("o.*", "su.email as storeUserEmail")
        .count("i.id as itemCount")
        .orderBy(sort.column, sort.order)
        .limit(limit)
        .offset(offset),
      this.countList(knex, scope),
    ]);

    const data = rows.map((r) => ({
      ...this.mapToInterface(r),
      itemCount: parseInt(r.itemCount as string) || 0,
      storeUserEmail: (r.storeUserEmail as string | null) ?? undefined,
    }));

    return {
      success: true,
      data,
      page,
      limit,
      count: data.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
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
