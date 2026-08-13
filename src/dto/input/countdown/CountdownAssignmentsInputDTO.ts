import { validate as isUuid } from "uuid";

/** A document may not name more subjects than this per bucket. */
const MAX_ASSIGNMENT_TARGETS = 50;

/**
 * Assignment targets arrive as uuids. A single value may arrive bare rather than
 * in an array (that is what a one-option <select> posts), so both shapes
 * normalise to a list. Absent or empty means "no targets", which is how a caller
 * clears a bucket — the PUT replaces the whole set.
 */
export function toUuidList(value: unknown, field: string): string[] {
  if (value === undefined || value === null || value === "") return [];
  const raw = Array.isArray(value) ? value : [value];
  if (raw.length > MAX_ASSIGNMENT_TARGETS) {
    throw new Error(
      `Máximo ${MAX_ASSIGNMENT_TARGETS} destinatarios en ${field}`,
    );
  }
  return raw.map((entry) => {
    if (typeof entry !== "string" || !isUuid(entry)) {
      throw new Error(`Identificador inválido en ${field}`);
    }
    return entry;
  });
}

/**
 * Who may resolve a document (`resolvers`) and who is reminded about it
 * (`watchers`). Every bucket defaults to an empty list: this DTO backs a PUT that
 * replaces the whole assignment set, so "not sent" has to mean "nobody", not
 * "leave as is".
 */
export class CountdownAssignmentsInputDTO {
  resolverUsers: string[];
  resolverGroups: string[];
  watcherUsers: string[];
  watcherGroups: string[];

  constructor(data: any) {
    this.resolverUsers = toUuidList(data?.resolverUsers, "resolverUsers");
    this.resolverGroups = toUuidList(data?.resolverGroups, "resolverGroups");
    this.watcherUsers = toUuidList(data?.watcherUsers, "watcherUsers");
    this.watcherGroups = toUuidList(data?.watcherGroups, "watcherGroups");
  }

  public build(): this {
    return this;
  }
}
