import { describe, it, expect } from "@jest/globals";
import {
  CustomerCreateInputDTO,
  CustomerUpdateInputDTO,
} from "../../../dto/input/customer";

/** customer-address-delivery D-1: `address` is required at the API. */
describe("Customer DTOs — address is required", () => {
  const base = { companyId: 1, name: "Cliente" };

  it("create: rejects a missing or blank address", () => {
    expect(() => new CustomerCreateInputDTO(base).build()).toThrow(
      /dirección es obligatorio/,
    );
    expect(() =>
      new CustomerCreateInputDTO({ ...base, address: "   " }).build(),
    ).toThrow(/dirección es obligatorio/);
  });

  it("create: trims the address", () => {
    const dto = new CustomerCreateInputDTO({
      ...base,
      address: "  Calle 1  ",
    }).build();
    expect(dto.address).toBe("Calle 1");
  });

  it("update: leaves an absent address alone but rejects a blank one", () => {
    const untouched = new CustomerUpdateInputDTO({ name: "Otro" }).build();
    expect("address" in untouched).toBe(false);
    expect(() => new CustomerUpdateInputDTO({ address: "" }).build()).toThrow(
      /dirección es obligatorio/,
    );
  });
});
