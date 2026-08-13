import { validate as isUuid } from "uuid";

/**
 * A grupo is a notification/resolution shortcut, not an org chart: 50 members is
 * far past any real use and caps the membership rewrite.
 */
const MAX_MEMBERS = 50;

/**
 * `PUT /groups/:uuid/members` — the full replacement set, as user uuids.
 *
 * An empty array is valid and means "leave the grupo without members"; a missing
 * or non-array `members` is a mistake and is refused, because answering 200 to a
 * malformed body would quietly wipe the membership.
 */
export class CountdownGroupMembersInputDTO {
  members!: string[];

  constructor(data: Record<string, unknown>) {
    const raw: unknown = data?.members;
    if (!Array.isArray(raw)) return;
    // A non-string entry leaves `members` unset, so build() refuses the body
    // instead of quietly rewriting the membership from a malformed list.
    if (!raw.every((entry): entry is string => typeof entry === "string")) {
      return;
    }

    // Deduplicated on the way in: the (groupId, userId) unique index would
    // otherwise turn a repeated uuid into a 409 the user cannot act on.
    // Lower-cased so the same uuid in two casings counts once.
    const seen = new Set<string>();
    const members: string[] = [];
    for (const entry of raw) {
      const uuid = entry.trim().toLowerCase();
      if (seen.has(uuid)) continue;
      seen.add(uuid);
      members.push(uuid);
    }
    this.members = members;
  }

  public build(): this {
    if (!Array.isArray(this.members)) {
      throw new Error("members debe ser una lista de uuids");
    }
    if (this.members.length > MAX_MEMBERS) {
      throw new Error(`Un grupo no puede tener más de ${MAX_MEMBERS} miembros`);
    }
    for (const member of this.members) {
      if (!isUuid(member)) {
        throw new Error("Cada miembro debe ser un uuid válido");
      }
    }
    return this;
  }
}
