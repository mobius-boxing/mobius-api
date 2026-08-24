import {
  CountdownGroupDAO,
  ICountdownGroupRow,
} from "../../dao/countdown/countdown-group.dao";
import { CountdownPeopleDAO } from "../../dao/countdown/countdown-people.dao";
import { ICountdownGroup } from "../../interfaces/countdown/countdown.interfaces";
// The status-carrying error is defined once for the whole countdown module and
// shared from the categories service (see its definition for the contract).
import { CountdownServiceError } from "./countdown-categories.service";

export class CountdownGroupsService {
  private groups = new CountdownGroupDAO();
  private people = new CountdownPeopleDAO();

  /** A uuid from another company resolves to nothing ⇒ "no encontrado" (L-009). */
  private async requireGroupId(
    companyId: number,
    uuid: string,
  ): Promise<number> {
    const id = await this.groups.getIdByUuid(uuid, companyId);
    if (!id) throw new CountdownServiceError(404, "Grupo no encontrado");
    return id;
  }

  list(companyId: number): Promise<ICountdownGroup[]> {
    return this.groups.list(companyId);
  }

  async get(companyId: number, uuid: string): Promise<ICountdownGroup> {
    const group = (await this.groups.list(companyId)).find(
      (candidate) => candidate.uuid === uuid,
    );
    if (!group) throw new CountdownServiceError(404, "Grupo no encontrado");
    return group;
  }

  async create(
    companyId: number,
    uuid: string,
    name: string,
  ): Promise<ICountdownGroup> {
    if (await this.groups.findByName(companyId, name)) {
      throw new CountdownServiceError(409, "Ya existe un grupo con ese nombre");
    }
    const created = await this.groups.create(companyId, uuid, name);
    return {
      uuid: created.uuid,
      name: created.name,
      members: [],
      createdAt: created.createdAt,
    };
  }

  async rename(
    companyId: number,
    uuid: string,
    name: string,
  ): Promise<ICountdownGroup> {
    const id = await this.requireGroupId(companyId, uuid);

    const clash = await this.groups.findByName(companyId, name);
    if (clash && clash.id !== id) {
      throw new CountdownServiceError(409, "Ya existe un grupo con ese nombre");
    }

    await this.groups.rename(companyId, id, name);
    return this.get(companyId, uuid);
  }

  /**
   * Replaces the whole membership.
   *
   * Every uuid must belong to an ACTIVE user of this company; one that does not
   * fails the whole request instead of being dropped. Dropping it would let a
   * uuid from another tenant come back as a silent success — and the caller
   * would believe someone was added who never was.
   */
  async setMembers(
    companyId: number,
    uuid: string,
    memberUuids: string[],
  ): Promise<ICountdownGroup> {
    const id = await this.requireGroupId(companyId, uuid);

    const userIds = await this.people.activeIdsByUuids(companyId, memberUuids);
    if (userIds.length !== memberUuids.length) {
      throw new CountdownServiceError(
        400,
        "Algunos miembros no son usuarios activos de esta empresa",
      );
    }

    await this.groups.setMembers(id, userIds);
    return this.get(companyId, uuid);
  }

  /** Returns the deleted row so the caller can audit what disappeared. */
  async remove(companyId: number, uuid: string): Promise<ICountdownGroupRow> {
    const group = await this.groups.getByUuid(uuid, companyId);
    if (!group) throw new CountdownServiceError(404, "Grupo no encontrado");
    // Membership and any document assignments pointing at it cascade away, so a
    // document assigned only to this group falls back to "anyone can resolve".
    await this.groups.delete(companyId, group.id);
    return group;
  }
}
