/** The name column is varchar(80) in every countdown_* table that has one. */
const MAX_NAME_LENGTH = 80;

/**
 * Same shape for rubros, sub-rubros and grupos — a name is all any of them
 * carries. Messages are Spanish because they are shown verbatim to the admin
 * who typed the name.
 *
 * Trimming happens here, once, so the clash check and the stored value can
 * never disagree about what " IVA " is.
 */
export class CountdownNameInputDTO {
  name!: string;

  constructor(data: Record<string, unknown>) {
    if (typeof data?.name === "string") this.name = data.name.trim();
  }

  public build(): this {
    if (typeof this.name !== "string" || this.name.length === 0) {
      throw new Error("El nombre es obligatorio");
    }
    if (this.name.length > MAX_NAME_LENGTH) {
      throw new Error(
        `El nombre no puede tener más de ${MAX_NAME_LENGTH} caracteres`,
      );
    }
    return this;
  }
}
