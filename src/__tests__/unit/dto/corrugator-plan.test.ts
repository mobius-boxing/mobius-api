import { describe, it, expect } from "@jest/globals";
import {
  CorrugatorPlanCreateInputDTO,
  CorrugatorPlanUpdateInputDTO,
  CorrugatorPlanOrdersCreateInputDTO,
  CorrugatorPlanOrderUpdateInputDTO,
  CorrugatorCombinationCreateInputDTO,
  CorrugatorCombinationUpdateInputDTO,
  CorrugatorRegisterInputDTO,
} from "../../../dto/corrugator-plan";

describe("CorrugatorPlanCreateInputDTO", () => {
  const valid = {
    name: "Onda C",
    productionOrderUuids: ["b7d2f7d0-0000-4000-8000-000000000001"],
    machines: [{ machineUuid: "8c1e0000-0000-4000-8000-000000000002" }],
  };

  it("accepts a minimal valid payload", () => {
    expect(() => new CorrugatorPlanCreateInputDTO(valid).build()).not.toThrow();
  });

  it("rejects an empty productionOrderUuids array", () => {
    expect(() =>
      new CorrugatorPlanCreateInputDTO({
        ...valid,
        productionOrderUuids: [],
      }).build(),
    ).toThrow(/productionOrderUuids/);
  });

  it("rejects a missing machines array", () => {
    const { machines: _machines, ...rest } = valid;
    expect(() => new CorrugatorPlanCreateInputDTO(rest as any).build()).toThrow(
      /machines/,
    );
  });

  it("rejects a machines entry without machineUuid", () => {
    expect(() =>
      new CorrugatorPlanCreateInputDTO({
        ...valid,
        machines: [{}],
      } as any).build(),
    ).toThrow(/machineUuid/);
  });

  it("rejects negative widths (D-23: each width must be > 0)", () => {
    expect(() =>
      new CorrugatorPlanCreateInputDTO({
        ...valid,
        machines: [
          { machineUuid: valid.machines[0].machineUuid, widths: [-1] },
        ],
      }).build(),
    ).toThrow(/widths/);
  });

  it("rejects a non-object parameters value", () => {
    expect(() =>
      new CorrugatorPlanCreateInputDTO({
        ...valid,
        parameters: "nope",
      } as any).build(),
    ).toThrow(/parameters/);
  });
});

describe("CorrugatorPlanUpdateInputDTO", () => {
  it("accepts an empty update (all fields optional)", () => {
    expect(() => new CorrugatorPlanUpdateInputDTO({}).build()).not.toThrow();
  });

  it("rejects an empty machines array when supplied", () => {
    expect(() =>
      new CorrugatorPlanUpdateInputDTO({ machines: [] }).build(),
    ).toThrow(/machines/);
  });
});

describe("CorrugatorPlanOrdersCreateInputDTO", () => {
  it("requires at least one uuid", () => {
    expect(() =>
      new CorrugatorPlanOrdersCreateInputDTO({
        productionOrderUuids: [],
      }).build(),
    ).toThrow();
  });
  it("accepts a populated array", () => {
    expect(() =>
      new CorrugatorPlanOrdersCreateInputDTO({
        productionOrderUuids: ["a"],
      }).build(),
    ).not.toThrow();
  });
});

describe("CorrugatorPlanOrderUpdateInputDTO", () => {
  it("accepts every documented field", () => {
    expect(() =>
      new CorrugatorPlanOrderUpdateInputDTO({
        requestedSheets: 500,
        sheetsPerUnit: 1.5,
        underrunPercentage: 2,
        overrunPercentage: 5,
        priority: "mandatory",
        partialProduction: false,
        allowsRotation: true,
        position: 0,
      }).build(),
    ).not.toThrow();
  });

  it("rejects requestedSheets < 1", () => {
    expect(() =>
      new CorrugatorPlanOrderUpdateInputDTO({ requestedSheets: 0 }).build(),
    ).toThrow();
  });

  it("rejects a non-integer requestedSheets", () => {
    expect(() =>
      new CorrugatorPlanOrderUpdateInputDTO({ requestedSheets: 1.5 }).build(),
    ).toThrow();
  });

  it("rejects sheetsPerUnit <= 0", () => {
    expect(() =>
      new CorrugatorPlanOrderUpdateInputDTO({ sheetsPerUnit: 0 }).build(),
    ).toThrow();
  });

  it("rejects an unknown priority", () => {
    expect(() =>
      new CorrugatorPlanOrderUpdateInputDTO({
        priority: "urgent",
      } as any).build(),
    ).toThrow(/priority/);
  });
});

describe("CorrugatorCombinationCreateInputDTO", () => {
  const valid = {
    machineKey: "m:1800",
    items: [{ orderUuid: "o1", count: 2 }],
  };

  it("accepts a valid payload", () => {
    expect(() =>
      new CorrugatorCombinationCreateInputDTO(valid).build(),
    ).not.toThrow();
  });
  it("requires machineKey", () => {
    const { machineKey: _mk, ...rest } = valid;
    expect(() =>
      new CorrugatorCombinationCreateInputDTO(rest as any).build(),
    ).toThrow(/machineKey/);
  });
  it("requires at least one item", () => {
    expect(() =>
      new CorrugatorCombinationCreateInputDTO({ ...valid, items: [] }).build(),
    ).toThrow(/items/);
  });
  it("rejects count < 1", () => {
    expect(() =>
      new CorrugatorCombinationCreateInputDTO({
        machineKey: "m:1800",
        items: [{ orderUuid: "o1", count: 0 }],
      }).build(),
    ).toThrow(/count/);
  });
  it("rejects a negative meters", () => {
    expect(() =>
      new CorrugatorCombinationCreateInputDTO({ ...valid, meters: -1 }).build(),
    ).toThrow(/meters/);
  });
});

describe("CorrugatorCombinationUpdateInputDTO (exactly one of four fields)", () => {
  it("accepts meters alone", () => {
    expect(() =>
      new CorrugatorCombinationUpdateInputDTO({ meters: 10 }).build(),
    ).not.toThrow();
  });
  it("accepts plannedSheets alone", () => {
    expect(() =>
      new CorrugatorCombinationUpdateInputDTO({
        plannedSheets: { itemUuid: "i1", value: 100 },
      }).build(),
    ).not.toThrow();
  });
  it("accepts sequence alone", () => {
    expect(() =>
      new CorrugatorCombinationUpdateInputDTO({ sequence: 2 }).build(),
    ).not.toThrow();
  });
  it("accepts machineKey alone (D-44)", () => {
    expect(() =>
      new CorrugatorCombinationUpdateInputDTO({ machineKey: "m:2000" }).build(),
    ).not.toThrow();
  });
  it("rejects an empty body", () => {
    expect(() => new CorrugatorCombinationUpdateInputDTO({}).build()).toThrow(
      /Exactly one/,
    );
  });
  it("rejects two fields at once", () => {
    expect(() =>
      new CorrugatorCombinationUpdateInputDTO({
        meters: 10,
        sequence: 2,
      }).build(),
    ).toThrow(/Exactly one/);
  });
  it("rejects a non-integer sequence", () => {
    expect(() =>
      new CorrugatorCombinationUpdateInputDTO({ sequence: 1.5 }).build(),
    ).toThrow();
  });
});

describe("CorrugatorRegisterInputDTO", () => {
  it("accepts an empty body (force defaults elsewhere)", () => {
    expect(() => new CorrugatorRegisterInputDTO({}).build()).not.toThrow();
  });
  it("accepts force:true", () => {
    expect(() =>
      new CorrugatorRegisterInputDTO({ force: true }).build(),
    ).not.toThrow();
  });
  it("rejects a non-boolean force", () => {
    expect(() =>
      new CorrugatorRegisterInputDTO({ force: "yes" } as any).build(),
    ).toThrow(/force/);
  });
});
