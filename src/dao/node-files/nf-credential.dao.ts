import { Request } from "express";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  INodeFilesCredential,
  INodeFilesCredentialRow,
  NodeFilesCredentialType,
} from "../../interfaces/node-files/node-files.interfaces";
import {
  buildCountQuery,
  buildQuery,
  createQueryConfig,
  parseQueryParams,
  type FilterConfigs,
  type ParsedQuery,
  type QueryBuilderConfig,
  type SortConfigs,
} from "../../utils/queryBuilder";
import { toCountOut } from "../../utils/numbers";

const TABLE = "nf_credentials";
const JOIN_TABLE = "nf_workflow_credentials";

/** Filter/sort configs live OUTSIDE the class (house rule). */
const CREDENTIAL_FILTERS: FilterConfigs = {
  type: { column: "type", operator: "=" },
};

const CREDENTIAL_SORTING: SortConfigs = {
  name: { column: "name" },
  type: { column: "type" },
  createdAt: { column: "createdAt" },
  lastUsedAt: { column: "lastUsedAt" },
};

const CREDENTIAL_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(TABLE, {
  filters: CREDENTIAL_FILTERS,
  sorting: CREDENTIAL_SORTING,
  search: { columns: ["name"], operator: "ILIKE" },
  defaultSort: { column: "createdAt", order: "desc" },
});

export interface INodeFilesCredentialWriteInput {
  uuid: string;
  companyId: number;
  name: string;
  type: NodeFilesCredentialType;
  headerName: string | null;
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
  createdByUserId: number | null;
  createdByName: string | null;
}

/** The three columns the executor needs to rebuild a secret, and nothing else. */
export interface INodeFilesCredentialSecret {
  uuid: string;
  name: string;
  type: NodeFilesCredentialType;
  headerName: string | null;
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
}

/**
 * Credentials — company-scoped like every DAO here (L-009), and **write-only**
 * with respect to the secret.
 *
 * The write-only rule is enforced structurally rather than by remembering:
 * `mapToInterface` is the only path out of this class for an HTTP response and
 * it has no branch that can emit a ciphertext, an IV, a tag, or a length. The
 * one method that reads those columns, `getSecretByUuid`, returns a different
 * type, is not reachable from a controller, and is called only by the executor.
 * There is no "masked" representation on purpose: a mask is a promise about
 * how much of a secret it is safe to show, and this module makes no such
 * promise.
 */
export class NfCredentialDAO {
  private scoped(companyId: number) {
    return db("nodefiles")(TABLE).where(`${TABLE}.companyId`, companyId);
  }

  async create(
    input: INodeFilesCredentialWriteInput,
  ): Promise<INodeFilesCredential> {
    const [row] = await db("nodefiles")(TABLE)
      .insert({
        uuid: input.uuid,
        companyId: input.companyId,
        name: input.name,
        type: input.type,
        headerName: input.headerName,
        secretCiphertext: input.secretCiphertext,
        secretIv: input.secretIv,
        secretTag: input.secretTag,
        createdByUserId: input.createdByUserId,
        createdByName: input.createdByName,
      })
      .returning("*");
    return this.mapToInterface(row as INodeFilesCredentialRow);
  }

  async getAllWithFilters(
    req: Request,
    companyId: number,
  ): Promise<IDataPaginator<INodeFilesCredential>> {
    const knex = db("nodefiles");
    const parsedQuery: ParsedQuery = parseQueryParams(req);
    // superAdmins pin the tenant with ?companyId=<uuid>, already resolved here.
    delete parsedQuery.filters.companyId;

    const dataQuery = knex(TABLE)
      .select(`${TABLE}.*`)
      .where(`${TABLE}.companyId`, companyId);
    buildQuery(dataQuery, parsedQuery, CREDENTIAL_QUERY_CONFIG);

    const countQuery = knex(TABLE).where(`${TABLE}.companyId`, companyId);
    buildCountQuery(countQuery, parsedQuery, CREDENTIAL_QUERY_CONFIG);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = toCountOut(totalResult?.count);

    return {
      success: true,
      data: (rows as INodeFilesCredentialRow[]).map((row) =>
        this.mapToInterface(row),
      ),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /** The secret-free view of one credential, company-scoped. */
  async getByUuid(
    uuid: string,
    companyId: number,
  ): Promise<INodeFilesCredential | null> {
    const row = await this.scoped(companyId)
      .where(`${TABLE}.uuid`, uuid)
      .first();
    return row ? this.mapToInterface(row as INodeFilesCredentialRow) : null;
  }

  /** Resolved explicitly — the mapper strips numeric ids (L-005). */
  async getIdByUuid(uuid: string, companyId: number): Promise<number | null> {
    const row = await this.scoped(companyId)
      .where(`${TABLE}.uuid`, uuid)
      .select(`${TABLE}.id`)
      .first();
    return row ? (row.id as number) : null;
  }

  /**
   * uuid → id for a whole list, in ONE query, company-scoped.
   *
   * Used when a definition is saved: a credential belonging to another tenant
   * simply does not come back, and the validator turns the gap into "esa
   * credencial no existe" — cross-tenant reference and typo are the same
   * answer, which is what keeps existence from leaking (L-009).
   */
  async idsByUuids(
    uuids: string[],
    companyId: number,
  ): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const rows = await this.scoped(companyId)
      .whereIn(`${TABLE}.uuid`, uuids)
      .select("id", "uuid");
    return new Map(
      (rows as Array<{ id: number; uuid: string }>).map((row) => [
        row.uuid,
        row.id,
      ]),
    );
  }

  /**
   * The executor's read: the encrypted columns, by uuid, scoped to the run's
   * own company. Not reachable from any controller — see the class comment.
   */
  async getSecretByUuid(
    uuid: string,
    companyId: number,
  ): Promise<INodeFilesCredentialSecret | null> {
    const row = await this.scoped(companyId)
      .where(`${TABLE}.uuid`, uuid)
      .select(
        "uuid",
        "name",
        "type",
        "headerName",
        "secretCiphertext",
        "secretIv",
        "secretTag",
      )
      .first();
    return (row as INodeFilesCredentialSecret) ?? null;
  }

  /** Bookkeeping only, in its own short statement after the node is over. */
  async touchLastUsed(uuid: string, companyId: number): Promise<void> {
    const knex = db("nodefiles");
    await this.scoped(companyId)
      .where(`${TABLE}.uuid`, uuid)
      .update({ lastUsedAt: knex.fn.now(), updatedAt: knex.fn.now() });
  }

  /** How many workflows reference this credential (the 409 says the number). */
  async countWorkflowsUsing(
    credentialId: number,
    companyId: number,
  ): Promise<number> {
    const result = await db("nodefiles")(JOIN_TABLE)
      .where({ credentialId, companyId })
      .count("* as count")
      .first();
    return toCountOut(result?.count);
  }

  async delete(id: number, companyId: number): Promise<boolean> {
    const deleted = await this.scoped(companyId)
      .where(`${TABLE}.id`, id)
      .delete();
    return deleted > 0;
  }

  /**
   * UUID-only, and secret-free. Every column not listed here is one that must
   * never leave the API — which is the entire point of this mapper.
   */
  private mapToInterface(row: INodeFilesCredentialRow): INodeFilesCredential {
    return {
      uuid: row.uuid,
      name: row.name,
      type: row.type,
      headerName: row.headerName,
      lastUsedAt: row.lastUsedAt,
      createdByName: row.createdByName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
