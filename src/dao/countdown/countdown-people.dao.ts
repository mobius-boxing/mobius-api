import KnexManager from "../../database/KnexConnection";
import { INamedRef } from "../../interfaces/countdown/countdown.interfaces";

const USERS_TABLE = "users";

interface IPersonRow {
  uuid: string;
  firstName: string | null;
  lastName: string | null;
}

/** Mobius users have firstName/lastName; countdown's pickers print one string. */
function displayName(row: IPersonRow): string {
  return `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
}

/**
 * The roster the assignment pickers read: the company's active users, uuid and
 * printable name only.
 *
 * It exists as its own read because `GET /api/users` is admin-only, while
 * assigning a resolver or a watcher is an everyday action for any module user.
 * Nothing here exposes emails, roles or ids — just enough to draw a chip.
 */
export class CountdownPeopleDAO {
  async list(companyId: number): Promise<INamedRef[]> {
    const knex = KnexManager.getConnection();
    const rows = (await knex(USERS_TABLE)
      .where({ companyId, isActive: true })
      .select("uuid", "firstName", "lastName")
      // Ordering on the name parts matches ordering on "firstName lastName".
      .orderBy([
        { column: "firstName" },
        { column: "lastName" },
      ])) as IPersonRow[];

    return rows.map((row) => ({ uuid: row.uuid, name: displayName(row) }));
  }

  /**
   * Resolve member uuids to serial ids, keeping only ACTIVE users of this
   * company. Callers compare the result length against the input length and
   * refuse the whole request on a mismatch: silently dropping a uuid that
   * belongs to another tenant would hide a cross-company attempt (L-009).
   */
  async activeIdsByUuids(
    companyId: number,
    uuids: string[],
  ): Promise<number[]> {
    if (uuids.length === 0) return [];
    const knex = KnexManager.getConnection();
    const rows = (await knex(USERS_TABLE)
      .where({ companyId, isActive: true })
      .whereIn("uuid", uuids)
      .select("id")) as { id: number }[];
    return rows.map((row) => row.id);
  }
}
