/**
 * AC-14 / AC-15 — `validateProductionOrder`, one case per rule V1…V6 plus the
 * V1 short-circuit (divergence D-3).
 *
 * The messages are asserted LITERALLY rather than through
 * VALIDATION_MESSAGES: an accidental edit of the constant would otherwise
 * update the expectation with it, and these strings are the parity contract.
 */
import { describe, it, expect } from "@jest/globals";
import { validateProductionOrder } from "../../../services/production-order-validator.service";
import { IProductionOrderValidationContext } from "../../../interfaces/production-order/production-order.interfaces";

/** A context in which nothing is wrong. */
const okContext: IProductionOrderValidationContext = {
  routeStageCount: 3,
  partApproved: true,
  customerActive: true,
  maxQuantity: 0,
};

const okOrder = { partId: 42, quantity: 100 };

describe("validateProductionOrder — Problemas() parity (AC-14)", () => {
  it("returns no problems for a complete, valid order", () => {
    const { problems } = validateProductionOrder(okOrder, okContext, {
      isNew: true,
    });

    expect(problems).toEqual([]);
  });

  it("V1 — a missing part", () => {
    const { problems } = validateProductionOrder(
      { partId: null, quantity: 100 },
      okContext,
      { isNew: true },
    );

    expect(problems).toContain("Debe especificar una parte!");
  });

  it("V2 — an effective route with no stages", () => {
    const { problems } = validateProductionOrder(
      okOrder,
      { ...okContext, routeStageCount: 0 },
      { isNew: true },
    );

    expect(problems).toEqual(["La ruta de la orden debe tener etapas!"]);
  });

  it.each([0, -5])("V3 — quantity %s is not greater than zero", (quantity) => {
    const { problems } = validateProductionOrder(
      { partId: 42, quantity },
      okContext,
      { isNew: true },
    );

    expect(problems).toEqual(["Debe especificar una cantidad mayor que cero!"]);
  });

  it("V4 — an unapproved part", () => {
    const { problems } = validateProductionOrder(
      okOrder,
      { ...okContext, partApproved: false },
      { isNew: true },
    );

    expect(problems).toEqual(["La parte no está aprobada!"]);
  });

  it("V5 — an inactive customer, on create only", () => {
    const context = { ...okContext, customerActive: false };

    const created = validateProductionOrder(okOrder, context, { isNew: true });
    const updated = validateProductionOrder(okOrder, context, { isNew: false });

    expect(created.problems).toEqual([
      "El cliente asociado al producto no está activo!",
    ]);
    expect(updated.problems).toEqual([]);
  });

  it("V6 — a quantity above CantidadMaximaEnOrdenes, interpolating the max", () => {
    const { problems } = validateProductionOrder(
      { partId: 42, quantity: 5001 },
      { ...okContext, maxQuantity: 5000 },
      { isNew: true },
    );

    expect(problems).toEqual([
      "No se permiten órdenes de producción mayores a 5000 unidades.",
    ]);
  });

  it("V6 — a max of 0 disables the ceiling entirely", () => {
    const { problems } = validateProductionOrder(
      { partId: 42, quantity: 1_000_000 },
      { ...okContext, maxQuantity: 0 },
      { isNew: true },
    );

    expect(problems).toEqual([]);
  });

  it("collects every failing rule at once", () => {
    const { problems } = validateProductionOrder(
      { partId: 42, quantity: 9000 },
      {
        routeStageCount: 0,
        partApproved: false,
        customerActive: false,
        maxQuantity: 5000,
      },
      { isNew: true },
    );

    expect(problems).toEqual([
      "La ruta de la orden debe tener etapas!",
      "La parte no está aprobada!",
      "El cliente asociado al producto no está activo!",
      "No se permiten órdenes de producción mayores a 5000 unidades.",
    ]);
  });
});

describe("V1 short-circuits the part-dependent rules (AC-15, D-3)", () => {
  it("reports only V1 when the part is missing, even with everything else broken", () => {
    // Procusto would NullReference here; this must be one clean problem.
    const run = () =>
      validateProductionOrder(
        { partId: null, quantity: 100 },
        {
          routeStageCount: 0,
          partApproved: false,
          customerActive: false,
          maxQuantity: 0,
        },
        { isNew: true },
      );

    expect(run).not.toThrow();
    expect(run().problems).toEqual(["Debe especificar una parte!"]);
    expect(run().problems).toHaveLength(1);
  });

  it("still reports V3 alongside V1 — quantity does not depend on the part", () => {
    const { problems } = validateProductionOrder(
      { partId: null, quantity: 0 },
      okContext,
      { isNew: true },
    );

    expect(problems).toEqual([
      "Debe especificar una parte!",
      "Debe especificar una cantidad mayor que cero!",
    ]);
  });
});
