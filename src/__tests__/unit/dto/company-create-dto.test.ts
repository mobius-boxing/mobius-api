import { describe, it, expect } from "@jest/globals";
import { CompanyCreateInputDTO } from "../../../dto/input/company/CompanyCreateInputDTO";

/**
 * Regression for a name-only company create 400ing with "Param description is
 * missing": `build()` used to assign the optional `description` key even when
 * absent, and `inputValidator` treats any own key holding `undefined` as
 * missing. See UserCreateInputDTO for the same strip-undefined-keys pattern.
 */
describe("CompanyCreateInputDTO", () => {
  it("builds a name-only company without an own `description` key", () => {
    const built = new CompanyCreateInputDTO({
      name: "Acme Cajas",
    }).build();

    expect(built.name).toBe("Acme Cajas");
    expect(Object.prototype.hasOwnProperty.call(built, "description")).toBe(
      false,
    );
    expect(built.description).toBeUndefined();
  });

  it("keeps a provided description", () => {
    const built = new CompanyCreateInputDTO({
      name: "Acme Cajas",
      description: "Cardboard boxes",
    }).build();

    expect(built.description).toBe("Cardboard boxes");
  });
});
