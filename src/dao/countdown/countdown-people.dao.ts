import { INamedRef } from "../../interfaces/countdown/countdown.interfaces";
import { CoreClient } from "../../services/core-client.service";

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
    return [...(await CoreClient.listCompanyPeople(companyId))];
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
    return [...(await CoreClient.activeUserIdsByUuids(companyId, uuids))];
  }
}
