import { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../database/registry";
import {
  CountdownAssignmentKind,
  ICountdownAssignmentInput,
  ICountdownAssignments,
  emptyCountdownAssignments,
} from "../../interfaces/countdown/countdown.interfaces";
import { diffSets } from "../../utils/setDiff";

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

/** A stored assignment, read back for the diff in `replace()`. */
interface IStoredAssignmentRow {
  id: number;
  kind: CountdownAssignmentKind;
  userId: number | null;
  groupId: number | null;
}

/** One target of an assignment: a user or a group, never both. */
interface IAssignmentTarget {
  kind: CountdownAssignmentKind;
  userId?: number;
  groupId?: number;
}

/**
 * Identity of an assignment row, as the two partial unique indexes define it:
 * `("documentId", kind, "userId") where "userId" is not null` and the same for
 * `"groupId"`. `documentId` is fixed for a whole diff, so the key is the kind
 * plus the subject; the `u:` / `g:` prefixes keep the two key spaces disjoint,
 * so a user and a group of the same kind never collide.
 *
 * "A row is a user assignment or a group assignment" is an application
 * invariant with no CHECK behind it. A stored row that breaks it — both columns
 * null — keys on a groupId of `null`, which no incoming target can produce, so
 * it is treated as removed and cleaned up rather than silently kept.
 */
function assignmentKey(row: {
  kind: CountdownAssignmentKind;
  userId?: number | null;
  groupId?: number | null;
}): string {
  return row.userId !== null && row.userId !== undefined
    ? `${row.kind}|u:${row.userId}`
    : `${row.kind}|g:${row.groupId}`;
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

    const knex = db("countdown");
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

    const knex = db("countdown");
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

  /**
   * Sets every assignment of a document. Transactional by necessity.
   *
   * A diff, not a rewrite (audit P1b): the four input arrays become one set of
   * `(kind, subject)` targets, which is diffed against what is stored. An
   * assignment row has no updatable column — it *is* its key — so this emits at
   * most one bulk DELETE and one bulk INSERT and never an UPDATE, and an
   * unchanged assignment set writes nothing. Editing only the watcher groups
   * leaves the resolver rows, and their ids and uuids, untouched.
   *
   * Called three ways, and the signature is load-bearing for all of them: with
   * the caller's transaction from the renewal copy, without one from
   * `setAssignments()`, and against a brand-new document (nothing stored, so
   * the diff is all inserts) from `create()`.
   */
  async replace(
    documentId: number,
    input: ICountdownAssignmentInput,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const knex = db("countdown");
    const targets: IAssignmentTarget[] = [
      ...input.resolverUserIds.map((userId) => ({
        kind: "resolver" as const,
        userId,
      })),
      ...input.resolverGroupIds.map((groupId) => ({
        kind: "resolver" as const,
        groupId,
      })),
      ...input.watcherUserIds.map((userId) => ({
        kind: "watcher" as const,
        userId,
      })),
      ...input.watcherGroupIds.map((groupId) => ({
        kind: "watcher" as const,
        groupId,
      })),
    ];

    const run = async (executor: Knex | Knex.Transaction): Promise<void> => {
      const existing: IStoredAssignmentRow[] = await executor(ASSIGNMENTS_TABLE)
        .select("id", "kind", "userId", "groupId")
        .where({ documentId });

      const { inserts, deletes } = diffSets(targets, existing, {
        keyOfIncoming: assignmentKey,
        keyOfExisting: assignmentKey,
      });

      // By id, because the two unique indexes are partial: `whereIn` on a key
      // spanning three columns, one of which is null half the time, is neither.
      if (deletes.length > 0) {
        await executor(ASSIGNMENTS_TABLE)
          .whereIn(
            "id",
            deletes.map((row) => row.id),
          )
          .delete();
      }

      // Server-side uuid (AC-9), like every other row this phase inserts.
      if (inserts.length > 0) {
        await executor(ASSIGNMENTS_TABLE).insert(
          inserts.map((target) => ({
            uuid: uuidv4(),
            documentId,
            kind: target.kind,
            userId: target.userId ?? null,
            groupId: target.groupId ?? null,
          })),
        );
      }
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
    const knex = db("countdown");
    const rows: { id: number }[] = await knex(GROUPS_TABLE)
      .select("id")
      .whereIn("uuid", uuids)
      .andWhere({ companyId });
    return rows.map((row) => row.id);
  }
}
