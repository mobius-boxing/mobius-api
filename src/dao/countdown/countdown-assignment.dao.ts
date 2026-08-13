import { Knex } from "knex";
import KnexManager from "../../database/KnexConnection";
import {
  CountdownAssignmentKind,
  ICountdownAssignmentInput,
  ICountdownAssignments,
  emptyCountdownAssignments,
} from "../../interfaces/countdown/countdown.interfaces";

const ASSIGNMENTS_TABLE = "countdown_document_assignments";
const GROUPS_TABLE = "countdown_groups";
const GROUP_MEMBERS_TABLE = "countdown_group_members";
const USERS_TABLE = "users";

interface IJoinedAssignmentRow {
  documentId: number;
  kind: CountdownAssignmentKind;
  userUuid: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  groupUuid: string | null;
  groupName: string | null;
}

interface IEffectiveUserRow {
  documentId: number;
  effectiveUserId: number | null;
}

/** Same composition the reminder DAO uses, so a person reads the same everywhere. */
function personName(
  firstName: string | null,
  lastName: string | null,
): string | null {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name === "" ? null : name;
}

/**
 * Assignments of documents to people and groups.
 *
 * Tenant scoping (L-009) lives one level up: `documentId`s only ever come from
 * the company-scoped document DAO, so a document belonging to another company is
 * unreachable here — its id never gets produced. The two uuid resolvers below are
 * the exception, because they take client input: both filter by `companyId`, so a
 * user or group from another tenant silently resolves to nothing instead of being
 * assigned.
 */
export class CountdownAssignmentDAO {
  /** One query for a whole page of documents — never N+1 inside a list. */
  async forDocuments(
    documentIds: number[],
  ): Promise<Map<number, ICountdownAssignments>> {
    const result = new Map<number, ICountdownAssignments>();
    if (documentIds.length === 0) return result;

    const knex = KnexManager.getConnection();
    const rows: IJoinedAssignmentRow[] = await knex(
      `${ASSIGNMENTS_TABLE} as da`,
    )
      .leftJoin(`${USERS_TABLE} as u`, "u.id", "da.userId")
      .leftJoin(`${GROUPS_TABLE} as g`, "g.id", "da.groupId")
      .whereIn("da.documentId", documentIds)
      .select(
        "da.documentId",
        "da.kind",
        "u.uuid as userUuid",
        "u.firstName as userFirstName",
        "u.lastName as userLastName",
        "g.uuid as groupUuid",
        "g.name as groupName",
      );

    for (const row of rows) {
      const entry = result.get(row.documentId) ?? emptyCountdownAssignments();
      const bucket = row.kind === "resolver" ? entry.resolvers : entry.watchers;
      const userName = personName(row.userFirstName, row.userLastName);
      if (row.userUuid && userName) {
        bucket.users.push({ uuid: row.userUuid, name: userName });
      } else if (row.groupUuid && row.groupName) {
        bucket.groups.push({ uuid: row.groupUuid, name: row.groupName });
      }
      result.set(row.documentId, entry);
    }
    return result;
  }

  /**
   * The effective set of user ids behind a kind, with groups expanded to their
   * membership **as it is right now** — that is what makes groups live: adding
   * someone to a group grants them access to documents assigned earlier.
   */
  async effectiveUserIds(
    documentIds: number[],
    kind: CountdownAssignmentKind,
  ): Promise<Map<number, Set<number>>> {
    const result = new Map<number, Set<number>>();
    if (documentIds.length === 0) return result;

    const knex = KnexManager.getConnection();
    const rows: IEffectiveUserRow[] = await knex(`${ASSIGNMENTS_TABLE} as da`)
      .leftJoin(`${GROUP_MEMBERS_TABLE} as gm`, "gm.groupId", "da.groupId")
      .where("da.kind", kind)
      .whereIn("da.documentId", documentIds)
      .select(
        "da.documentId",
        knex.raw('coalesce(da."userId", gm."userId") as "effectiveUserId"'),
      );

    for (const row of rows) {
      if (row.effectiveUserId === null) continue;
      const set = result.get(row.documentId) ?? new Set<number>();
      set.add(row.effectiveUserId);
      result.set(row.documentId, set);
    }
    return result;
  }

  /** Replaces every assignment for a document. Transactional by necessity. */
  async replace(
    documentId: number,
    input: ICountdownAssignmentInput,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const knex = KnexManager.getConnection();
    const run = async (executor: Knex | Knex.Transaction): Promise<void> => {
      await executor(ASSIGNMENTS_TABLE).where({ documentId }).delete();

      const rows = [
        ...input.resolverUserIds.map((userId) => ({
          documentId,
          kind: "resolver",
          userId,
        })),
        ...input.resolverGroupIds.map((groupId) => ({
          documentId,
          kind: "resolver",
          groupId,
        })),
        ...input.watcherUserIds.map((userId) => ({
          documentId,
          kind: "watcher",
          userId,
        })),
        ...input.watcherGroupIds.map((groupId) => ({
          documentId,
          kind: "watcher",
          groupId,
        })),
      ];
      if (rows.length > 0) await executor(ASSIGNMENTS_TABLE).insert(rows);
    };

    if (trx) return run(trx);
    return knex.transaction(run);
  }

  /**
   * SECURITY (L-009): group targets arrive as uuids from the client, so this
   * filters by the caller's company. A uuid from another tenant matches nothing
   * and is dropped — never assigned, never echoed back. (User uuids go through
   * `CountdownPeopleDAO.activeIdsByUuids`, which is the same guard plus the
   * active check the pickers already apply.)
   */
  async groupIdsByUuids(uuids: string[], companyId: number): Promise<number[]> {
    if (uuids.length === 0) return [];
    const knex = KnexManager.getConnection();
    const rows: { id: number }[] = await knex(GROUPS_TABLE)
      .select("id")
      .whereIn("uuid", uuids)
      .andWhere({ companyId });
    return rows.map((row) => row.id);
  }
}
