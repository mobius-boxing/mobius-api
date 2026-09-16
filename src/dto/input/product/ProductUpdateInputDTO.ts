import { ProductBaseInputDTO } from "./ProductCreateInputDTO";

/**
 * `PUT /product/:uuid`: any subset of the create keys; only sent keys are
 * validated and written (I-3). `code`/`customerId` are optional here — the
 * base class already types them optional, so nothing extra to declare.
 */
export class ProductUpdateInputDTO extends ProductBaseInputDTO {
  public build(): this {
    this.validateShared();
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}
