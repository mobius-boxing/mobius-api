export interface IStoreOrderItemInput {
  itemType: string;
  sourceUuid: string;
  quantity: number;
}

// Shape-level validation only (items present, notes normalized). Deep per-item
// validation (type/qty/source resolution/limits) happens in the controller,
// consistent with the house pattern of post-inputValidator manual checks.
export class StoreOrderCreateInputDTO {
  items: IStoreOrderItemInput[];
  notes: string | null;

  constructor(data: any) {
    this.items = data.items;
    // Normalize notes to null (allowed by inputValidator) so an absent optional
    // field never trips the "Param notes is missing" check. Trim + cap at 500 chars.
    const rawNotes = data.notes;
    if (typeof rawNotes === "string" && rawNotes.trim().length > 0) {
      this.notes = rawNotes.trim().slice(0, 500);
    } else {
      this.notes = null;
    }
  }

  public build(): this {
    return this;
  }
}
