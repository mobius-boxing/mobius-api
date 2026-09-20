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

  describe("create: inline deliveryLocations (amendment 2)", () => {
    const withAddress = { ...base, address: "Calle 1" };
    const zone = "6f1d2c3a-1111-4222-8333-444455556666";

    it("keeps a valid list, trimmed, and drops absent optionals", () => {
      const dto = new CustomerCreateInputDTO({
        ...withAddress,
        deliveryLocations: [
          { address: "  Depósito 2 ", deliveryZoneUuid: zone, latitude: "-34.6" },
        ],
      }).build();
      expect(dto.deliveryLocations).toEqual([
        { address: "Depósito 2", deliveryZoneUuid: zone, latitude: -34.6 },
      ]);
    });

    it("pins each failing item field", () => {
      let caught: any;
      try {
        new CustomerCreateInputDTO({
          ...withAddress,
          deliveryLocations: [
            { address: "", deliveryZoneUuid: "nope" },
            { address: "ok", deliveryZoneUuid: zone, longitude: 500 },
          ],
        }).build();
      } catch (error) {
        caught = error;
      }
      expect(caught?.errors.map((e: any) => e.field)).toEqual([
        "deliveryLocations.0.address",
        "deliveryLocations.0.deliveryZoneUuid",
        "deliveryLocations.1.longitude",
      ]);
    });

    it("rejects a non-list and leaves an absent list undefined", () => {
      expect(() =>
        new CustomerCreateInputDTO({ ...withAddress, deliveryLocations: {} }).build(),
      ).toThrow(/deben ser una lista/);
      expect(
        "deliveryLocations" in new CustomerCreateInputDTO(withAddress).build(),
      ).toBe(false);
    });
  });
});
