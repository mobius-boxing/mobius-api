import { v4 as uuidv4 } from "uuid";
import { db } from "../../database/registry";
import {
  ICountdownGroup,
  INamedRef,
} from "../../interfaces/countdown/countdown.interfaces";
import { diffSets } from "../../utils/setDiff";

const GROUPS_TABLE = "countdown_groups";
const MEMBERS_TABLE = "countdown_group_members";
const USERS_TABLE = "users";

/** Internal row shape — carries the serial id the API must never expose. */
export interface ICountdownGroupRow {
  id: number;
  uuid: string;
  companyId: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface IMemberRow {
  groupId: number;
  uuid: string;
  firstName: string | null;
  lastName: string | null;
}

/** Mobius users have firstName/lastName; countdown's UI prints one string. */
function displayName(row: {
  firstName: string | null;
  lastName: string | null;
}): string {
  return `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
}

export class CountdownGroupDAO {
  /** Grupos with their members, in two queries rather than one per group. */
  async list(companyId: number): Promise<ICountdownGroup[]> {
    const knex = db("countdown");

    const groups = await knex<ICountdownGroupRow>(GROUPS_TABLE)
      .where({ companyId })
      .orderBy("name");
    if (groups.length === 0) return [];

    // Only active users of the same company are listed: a deactivated member is
    // no longer a recipient or a resolver, and the companyId filter keeps a
    // stray membership row from ever printing another tenant's name.
    const members = (await knex(MEMBERS_TABLE)
      .join(USERS_TABLE, `${USERS_TABLE}.id`, `${MEMBERS_TABLE}.userId`)
      .whereIn(
        `${MEMBERS_TABLE}.groupId`,
        groups.map((group) => group.id),
      )
      .andWhere(`${USERS_TABLE}.isActive`, true)
      .andWhere(`${USERS_TABLE}.companyId`, companyId)
      .select(
        `${MEMBERS_TABLE}.groupId`,
        `${USERS_TABLE}.uuid`,
        `${USERS_TABLE}.firstName`,
        `${USERS_TABLE}.lastName`,
      )
      // Ordering on the name parts matches ordering on "firstName lastName".
      .orderBy([
        { column: `${USERS_TABLE}.firstName` },
        { column: `${USERS_TABLE}.lastName` },
      ])) as IMemberRow[];

    return groups.map((group) => ({
      uuid: group.uuid,
      name: group.name,
      createdAt: group.createdAt,
      members: members
        .filter((member) => member.groupId === group.id)
        .map(
          (member): INamedRef => ({
            uuid: member.uuid,
            name: displayName(member),
          }),
        ),
    }));
  }

  /**
   * (L-005) Serial ids are resolved explicitly. A uuid from another company
   * resolves to nothing, which the controller answers with 404.
   */
  async getIdByUuid(
    uuid: string,
    companyId: number,
  ): Promise<number | undefined> {
    const knex = db("countdown");
    const row = await knex<ICountdownGroupRow>(GROUPS_TABLE)
      .select("id")
      .where({ uuid, companyId })
      .first();
    return row?.id;
  }

  async getByUuid(
    uuid: string,
    companyId: number,
  ): Promise<ICountdownGroupRow | undefined> {
    const knex = db("countdown");
    return knex<ICountdownGroupRow>(GROUPS_TABLE)
      .where({ uuid, companyId })
      .first();
  }

  /** Clash check: per company and case-insensitive. */
  async findByName(
    companyId: number,
    name: string,
  ): Promise<ICountdownGroupRow | undefined> {
    const knex = db("countdown");
    return knex<ICountdownGroupRow>(GROUPS_TABLE)
      .where({ companyId })
      .whereRaw("lower(name) = lower(?)", [name.trim()])
      .first();
  }

  async create(
    companyId: number,
    uuid: string,
    name: string,
  ): Promise<ICountdownGroupRow> {
    const knex = db("countdown");
    const rows = await knex<ICountdownGroupRow>(GROUPS_TABLE)
      .insert({ uuid, companyId, name: name.trim() })
      .returning("*");
    const created = rows[0];
    if (!created) throw new Error("[CountdownGroupDAO] insert returned no row");
    return created;
  }

  async rename(companyId: number, id: number, name: string): Promise<void> {
    const knex = db("countdown");
    await knex<ICountdownGroupRow>(GROUPS_TABLE)
      .where({ id, companyId })
      .update({ name: name.trim(), updatedAt: knex.fn.now() });
  }

  async delete(companyId: number, id: number): Promise<void> {
    const knex = db("countdown");
    // Membership and any document assignments pointing at the group cascade
    // away, so a document assigned only to this group falls back to "anyone can
    // resolve". Neither side owns files or other state to clean up (L-006).
    await knex<ICountdownGroupRow>(GROUPS_TABLE)
      .where({ id, companyId })
      .delete();
  }

  /**
   * Sets the whole membership in one transaction: a half-applied member set is
   * worse than the old one. `groupId` and `userIds` are both already
   * tenant-resolved by the service.
   *
   * A diff, not a rewrite (audit P1b). Membership is a pure set — beyond
   * `(groupId, userId)` the row carries only `uuid` and its timestamps, so
   * nothing can "change" and there is no UPDATE branch: at most one bulk DELETE
   * of the members who left and one bulk INSERT of the ones who arrived. An
   * unchanged member list therefore writes **nothing at all**, which is the
   * point: the audit ledger must record who was added or removed, not a full
   * re-creation of the group on every save.
   */
  async setMembers(groupId: number, userIds: number[]): Promise<void> {
    const knex = db("countdown");
    await knex.transaction(async (trx) => {
      const existing: { userId: number }[] = await trx(MEMBERS_TABLE)
        .select("userId")
        .where({ groupId });

      const { inserts, deletes } = diffSets(userIds, existing, {
        keyOfIncoming: (userId) => String(userId),
        keyOfExisting: (row) => String(row.userId),
      });

      // Deleting by the natural key rather than by id: `UNIQUE(groupId, userId)`
      // makes the two identical, and the read above never has to carry an id.
      if (deletes.length > 0) {
        await trx(MEMBERS_TABLE)
          .where({ groupId })
          .whereIn(
            "userId",
            deletes.map((row) => row.userId),
          )
          .delete();
      }

      // The uuid is minted here rather than left to the column default so that
      // every row this DAO writes has a server-side identity (AC-9); it stays
      // internal and never reaches the API either way.
      if (inserts.length > 0) {
        await trx(MEMBERS_TABLE).insert(
          inserts.map((userId) => ({ uuid: uuidv4(), groupId, userId })),
        );
      }
    });
  }
}
