/**
 * Review payload: `{ values: { <fieldKey>: <raw value> } }`.
 *
 * The values are NOT typed here — they are coerced against the workflow's own
 * declared field types by the same coercion the extraction path uses, which is
 * the only place that knows what each key is supposed to be. This DTO's job is
 * to guarantee the service receives a plain object it can iterate.
 */
export class NodeFilesRunReviewInputDTO {
  values: Record<string, unknown>;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    const values = source.values;
    if (
      values === null ||
      typeof values !== "object" ||
      Array.isArray(values)
    ) {
      throw new Error("Enviá los valores revisados en 'values'");
    }
    this.values = values as Record<string, unknown>;
  }

  public build(): this {
    if (Object.keys(this.values).length === 0) {
      throw new Error("No hay valores para confirmar");
    }
    return this;
  }
}
