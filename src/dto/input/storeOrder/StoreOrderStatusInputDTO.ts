// Shape-only input DTO for the admin status-update endpoint.
// inputValidator ensures `status` is present (non-undefined); the allowed-value
// set is enforced in the controller via STORE_ORDER_STATUSES.includes(...).
export class StoreOrderStatusInputDTO {
  status: string;

  constructor(data: any) {
    this.status =
      typeof data?.status === "string" ? data.status.trim() : data?.status;
  }

  public build(): this {
    return this;
  }
}
