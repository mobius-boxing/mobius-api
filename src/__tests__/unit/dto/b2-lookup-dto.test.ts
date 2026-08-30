import { describe, it, expect } from "@jest/globals";
import {
  BoxTypeCreateInputDTO,
  BoxTypeUpdateInputDTO,
} from "../../../dto/input/boxType";
import {
  ColorTypeCreateInputDTO,
  ColorTypeUpdateInputDTO,
} from "../../../dto/input/colorType";
import {
  ComplementCreateInputDTO,
  ComplementUpdateInputDTO,
} from "../../../dto/input/complement";
import {
  CorrugationClassCreateInputDTO,
  CorrugationClassUpdateInputDTO,
} from "../../../dto/input/corrugationClass";
import {
  CustomerCategoryCreateInputDTO,
  CustomerCategoryUpdateInputDTO,
} from "../../../dto/input/customerCategory";
import {
  DeliveryZoneCreateInputDTO,
  DeliveryZoneUpdateInputDTO,
} from "../../../dto/input/delivery";
import {
  FlapTypeCreateInputDTO,
  FlapTypeUpdateInputDTO,
} from "../../../dto/input/flapType";
import {
  FscTypeCreateInputDTO,
  FscTypeUpdateInputDTO,
} from "../../../dto/input/fscType";
import {
  GlueTypeCreateInputDTO,
  GlueTypeUpdateInputDTO,
} from "../../../dto/input/glueType";
import {
  ManufacturerCreateInputDTO,
  ManufacturerUpdateInputDTO,
} from "../../../dto/input/manufacturer";
import {
  PaperTypeCreateInputDTO,
  PaperTypeUpdateInputDTO,
} from "../../../dto/input/paperType";
import {
  ProductTypeCreateInputDTO,
  ProductTypeUpdateInputDTO,
} from "../../../dto/input/productType";
import {
  StrappingTypeCreateInputDTO,
  StrappingTypeUpdateInputDTO,
} from "../../../dto/input/strappingType";
import {
  TraceTypeCreateInputDTO,
  TraceTypeUpdateInputDTO,
} from "../../../dto/input/traceType";
import { ValidationError } from "../../../dto/input/shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/__tests__/validation/b2Lookups.test.ts`.
 * The two files carry the same table on purpose: a rule that exists on only one
 * side is the failure mode this batch is meant to close.
 *
 * `codeMax` / `nameMax` are the LIVE column widths from
 * `information_schema.columns` (2026-08-29). They are stated per entity, never
 * shared, because this one batch spans varchar(50), varchar(100)
 * (`manufacturers`) and varchar(400) (`delivery_zones`, `fsc_types`).
 */
type Ctor = new (data: Record<string, unknown>) => { build(): unknown };

interface Entity {
  name: string;
  create: Ctor;
  update: Ctor;
  /** Absent on `customer_categories` and on `color_types` (no `code` column). */
  codeMax?: number;
  /** Absent on the code+description tables. */
  nameMax?: number;
  hasDescription: boolean;
  /** A real row from `traffic_production`. */
  seeded: Record<string, unknown>;
}

const ENTITIES: Entity[] = [
  {
    name: "boxType",
    create: BoxTypeCreateInputDTO as unknown as Ctor,
    update: BoxTypeUpdateInputDTO as unknown as Ctor,
    codeMax: 50,
    nameMax: 255,
    hasDescription: false,
    seeded: { code: "QD-TCJ-001", name: "FEFCO 0201 base" },
  },
  {
    name: "colorType",
    create: ColorTypeCreateInputDTO as unknown as Ctor,
    update: ColorTypeUpdateInputDTO as unknown as Ctor,
    nameMax: 255,
    hasDescription: true,
    seeded: {
      name: "Flexográfica proceso",
      description: "Familia de tintas flexográfica proceso",
    },
  },
  {
    name: "complement",
    create: ComplementCreateInputDTO as unknown as Ctor,
    update: ComplementUpdateInputDTO as unknown as Ctor,
    codeMax: 50,
    hasDescription: true,
    seeded: { code: "QD-CMP-001", description: "Manija troquelada" },
  },
  {
    name: "corrugationClass",
    create: CorrugationClassCreateInputDTO as unknown as Ctor,
    update: CorrugationClassUpdateInputDTO as unknown as Ctor,
    codeMax: 50,
    hasDescription: true,
    seeded: { code: "QD-CLC-001", description: "Simple liviana" },
  },
  {
    name: "deliveryZone",
    create: DeliveryZoneCreateInputDTO as unknown as Ctor,
    update: DeliveryZoneUpdateInputDTO as unknown as Ctor,
    codeMax: 400,
    hasDescription: true,
    seeded: { code: "QD-ZON-001", description: "Zona Rosario" },
  },
  {
    name: "flapType",
    create: FlapTypeCreateInputDTO as unknown as Ctor,
    update: FlapTypeUpdateInputDTO as unknown as Ctor,
    codeMax: 50,
    hasDescription: true,
    seeded: { code: "QD-SOL-001", description: "Solapa simple" },
  },
  {
    name: "fscType",
    create: FscTypeCreateInputDTO as unknown as Ctor,
    update: FscTypeUpdateInputDTO as unknown as Ctor,
    codeMax: 400,
    hasDescription: true,
    seeded: { code: "QD-FSC-001", description: "FSC 100% credit" },
  },
  {
    name: "glueType",
    create: GlueTypeCreateInputDTO as unknown as Ctor,
    update: GlueTypeUpdateInputDTO as unknown as Ctor,
    codeMax: 50,
    hasDescription: true,
    seeded: { code: "QD-PEG-001", description: "Adhesivo vinílico" },
  },
  {
    name: "manufacturer",
    create: ManufacturerCreateInputDTO as unknown as Ctor,
    update: ManufacturerUpdateInputDTO as unknown as Ctor,
    codeMax: 100,
    nameMax: 255,
    hasDescription: false,
    seeded: { code: "QD-FAB-001", name: "Papelera del Litoral" },
  },
  {
    name: "paperType",
    create: PaperTypeCreateInputDTO as unknown as Ctor,
    update: PaperTypeUpdateInputDTO as unknown as Ctor,
    codeMax: 50,
    hasDescription: true,
    seeded: { code: "QD-PAP-001", description: "Kraft Virgen" },
  },
  {
    name: "productType",
    create: ProductTypeCreateInputDTO as unknown as Ctor,
    update: ProductTypeUpdateInputDTO as unknown as Ctor,
    codeMax: 50,
    nameMax: 255,
    hasDescription: false,
    seeded: { code: "QD-TPR-001", name: "Caja regular" },
  },
  {
    name: "strappingType",
    create: StrappingTypeCreateInputDTO as unknown as Ctor,
    update: StrappingTypeUpdateInputDTO as unknown as Ctor,
    codeMax: 50,
    hasDescription: true,
    seeded: { code: "QD-FLJ-001", description: "Fleje polipropileno" },
  },
  {
    name: "traceType",
    create: TraceTypeCreateInputDTO as unknown as Ctor,
    update: TraceTypeUpdateInputDTO as unknown as Ctor,
    codeMax: 50,
    hasDescription: true,
    seeded: { code: "QD-HEN-001", description: "Hendido simple" },
  },
];

const failure = (fn: () => unknown): ValidationError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("expected build() to throw a ValidationError");
};

describe("B2 lookup DTOs", () => {
  it("covers the 13 BaseCrudController entities plus customerCategory", () => {
    // customerCategory is asserted separately: its controller is hand-rolled
    // and its DTO carries a resolved companyId the others never see.
    expect(ENTITIES).toHaveLength(13);
  });

  ENTITIES.forEach((entity) => {
    describe(entity.name, () => {
      it("round-trips a real seeded row through create", () => {
        expect(new entity.create(entity.seeded).build()).toEqual(entity.seeded);
      });

      it("round-trips the same row through update, unchanged (Risk 2)", () => {
        expect(new entity.update(entity.seeded).build()).toEqual(entity.seeded);
      });

      it("trims instead of storing surrounding whitespace", () => {
        const padded = Object.fromEntries(
          Object.entries(entity.seeded).map(([key, value]) => [
            key,
            `  ${value as string}  `,
          ]),
        );
        expect(new entity.create(padded).build()).toEqual(entity.seeded);
      });

      it("sets only the fields an update actually carried", () => {
        const dto = new entity.update({}).build();
        expect(Object.keys(dto as object)).toEqual([]);
      });

      if (entity.codeMax !== undefined) {
        it("requires the code, in Spanish, with the field name attached", () => {
          const error = failure(() =>
            new entity.create({ ...entity.seeded, code: "  " }).build(),
          );
          expect(error.statusCode).toBe(400);
          expect(error.errors).toEqual([
            { field: "code", message: "El código es obligatorio" },
          ]);
        });

        it(`bounds the code by the live varchar(${entity.codeMax})`, () => {
          const max = entity.codeMax as number;
          const ok = new entity.create({
            ...entity.seeded,
            code: "x".repeat(max),
          }).build() as { code: string };
          expect(ok.code).toHaveLength(max);

          const error = failure(() =>
            new entity.create({
              ...entity.seeded,
              code: "x".repeat(max + 1),
            }).build(),
          );
          expect(error.errors).toEqual([
            {
              field: "code",
              message: `El código no puede superar los ${max} caracteres`,
            },
          ]);
        });

        it("still validates a code that an update carries", () => {
          expect(
            failure(() => new entity.update({ code: "" }).build()).errors,
          ).toEqual([{ field: "code", message: "El código es obligatorio" }]);
        });

        // AC #4: the client's `code` primitive enforces `/^[\w.\-/ ]*$/`.
        // Until this batch the API took `A+B` the form had already rejected,
        // so the character class had to be re-stated here — on create AND on
        // update, since an update is the other door into the same column.
        it("rejects a code character the client's class forbids", () => {
          const error = failure(() =>
            new entity.create({ ...entity.seeded, code: "A+B" }).build(),
          );
          expect(error.statusCode).toBe(400);
          expect(error.errors).toEqual([
            { field: "code", message: "El código tiene un formato inválido" },
          ]);
        });

        it("rejects a bad code character on update too", () => {
          expect(
            failure(() => new entity.update({ code: "A+B" }).build()).errors,
          ).toEqual([
            { field: "code", message: "El código tiene un formato inválido" },
          ]);
        });

        it("accepts the whole class the client allows, padding trimmed", () => {
          const dto = new entity.create({
            ...entity.seeded,
            code: "  AB_1.2-3/4 X  ",
          }).build() as { code: string };
          expect(dto.code).toBe("AB_1.2-3/4 X");
        });
      }

      if (entity.nameMax !== undefined) {
        it("requires the name and bounds it by the live column", () => {
          const max = entity.nameMax as number;
          expect(
            failure(() =>
              new entity.create({ ...entity.seeded, name: " " }).build(),
            ).errors,
          ).toEqual([{ field: "name", message: "El nombre es obligatorio" }]);

          expect(
            failure(() =>
              new entity.create({
                ...entity.seeded,
                name: "x".repeat(max + 1),
              }).build(),
            ).errors,
          ).toEqual([
            {
              field: "name",
              message: `El nombre no puede superar los ${max} caracteres`,
            },
          ]);
        });
      }

      if (entity.hasDescription) {
        it("drops an absent description instead of sending an undefined key", () => {
          // `inputValidator` rejects any own key holding `undefined`
          // ("Param description is missing"), which used to 400 a create that
          // merely left the optional description blank.
          const { description, ...rest } = entity.seeded;
          const dto = new entity.create(rest).build() as object;
          expect(Object.keys(dto)).not.toContain("description");
        });

        it("keeps an empty description so the field stays clearable", () => {
          const dto = new entity.update({ description: "" }).build() as {
            description?: string;
          };
          expect(dto.description).toBe("");
        });

        it("caps the description at the 10000-char text convention", () => {
          expect(
            failure(() =>
              new entity.create({
                ...entity.seeded,
                description: "x".repeat(10001),
              }).build(),
            ).errors,
          ).toEqual([
            {
              field: "description",
              message: "La descripción no puede superar los 10000 caracteres",
            },
          ]);
        });
      }

      it("reports every bad field at once, not just the first", () => {
        const bad = Object.fromEntries(
          Object.keys(entity.seeded).map((key) => [key, "x".repeat(10001)]),
        );
        const error = failure(() => new entity.create(bad).build());
        expect(error.errors).toHaveLength(Object.keys(entity.seeded).length);
      });

      it("leaves companyId alone for the controller to inject (L-009)", () => {
        const dto = new entity.create({
          ...entity.seeded,
          companyId: 7,
        }).build() as Record<string, unknown>;
        // The DTO neither validates nor forwards companyId: the controller
        // sets it from the caller's token AFTER buildCreateDTO returns.
        expect(dto).not.toHaveProperty("companyId");
      });
    });
  });
});

/**
 * The per-entity facts the loop above cannot express. Each is a decision from
 * the signed-off rule table, so a future "let's just template it" pass has to
 * break a named test rather than a comment.
 */
describe("B2 sign-off decisions that resist templating", () => {
  it("keeps deliveryZone.code required even though the column is NULLABLE", () => {
    expect(
      failure(() =>
        new DeliveryZoneCreateInputDTO({ description: "Zona Rosario" }).build(),
      ).errors,
    ).toEqual([{ field: "code", message: "El código es obligatorio" }]);
  });

  it("keeps fscType.code required even though the column is NULLABLE", () => {
    expect(
      failure(() =>
        new FscTypeCreateInputDTO({ description: "FSC 100% credit" }).build(),
      ).errors,
    ).toEqual([{ field: "code", message: "El código es obligatorio" }]);
  });

  it("gives manufacturer the varchar(100) bound, not the sibling 50", () => {
    const dto = new ManufacturerCreateInputDTO({
      code: "x".repeat(100),
      name: "Papelera del Litoral",
    }).build();
    expect(dto.code).toHaveLength(100);
  });

  it("gives colorType no code field at all", () => {
    const dto = new ColorTypeCreateInputDTO({
      name: "UV Pantone",
      code: "IGNORED",
    }).build();
    expect(dto).toEqual({ name: "UV Pantone" });
  });
});

describe("CustomerCategoryCreateInputDTO", () => {
  it("round-trips a real seeded row with the company the controller resolved", () => {
    const dto = new CustomerCategoryCreateInputDTO({
      name: "Alimenticia A",
      companyId: 1,
    }).build();

    expect(dto).toEqual({ name: "Alimenticia A", companyId: 1 });
  });

  it("keeps the stricter UI cap of 100, not the column's 255", () => {
    // Sign-off #2: the column width is the ceiling, not the target.
    expect(
      new CustomerCategoryCreateInputDTO({
        name: "x".repeat(100),
        companyId: 1,
      }).build().name,
    ).toHaveLength(100);

    expect(
      failure(() =>
        new CustomerCategoryCreateInputDTO({
          name: "x".repeat(101),
          companyId: 1,
        }).build(),
      ).errors,
    ).toEqual([
      {
        field: "name",
        message: "El nombre no puede superar los 100 caracteres",
      },
    ]);
  });

  it("keeps the UI-only minLength of 2", () => {
    // Sign-off #3: no CHECK constraint backs it; it is kept where it already
    // exists and added to no other entity.
    expect(
      failure(() =>
        new CustomerCategoryCreateInputDTO({ name: "A", companyId: 1 }).build(),
      ).errors,
    ).toEqual([
      { field: "name", message: "El nombre debe tener al menos 2 caracteres" },
    ]);
  });

  it("requires the name", () => {
    expect(
      failure(() =>
        new CustomerCategoryCreateInputDTO({
          name: "   ",
          companyId: 1,
        }).build(),
      ).errors,
    ).toEqual([{ field: "name", message: "El nombre es obligatorio" }]);
  });

  it("resolves a stringified companyId the hand-rolled controller passed on", () => {
    expect(
      new CustomerCategoryCreateInputDTO({
        name: "Agro C",
        companyId: "3",
      }).build().companyId,
    ).toBe(3);
  });
});

describe("CustomerCategoryUpdateInputDTO", () => {
  it("saves a real seeded row unchanged (Risk 2)", () => {
    expect(
      new CustomerCategoryUpdateInputDTO({ name: "Alimenticia A" }).build(),
    ).toEqual({ name: "Alimenticia A" });
  });

  it("sets nothing when the request carried nothing", () => {
    expect(Object.keys(new CustomerCategoryUpdateInputDTO({}).build())).toEqual(
      [],
    );
  });

  it("never lets an update carry a tenant move (L-009)", () => {
    expect(
      new CustomerCategoryUpdateInputDTO({
        name: "Agro C",
        companyId: 99,
      }).build(),
    ).not.toHaveProperty("companyId");
  });

  it("still validates a name that is present", () => {
    expect(
      failure(() => new CustomerCategoryUpdateInputDTO({ name: "A" }).build())
        .errors,
    ).toEqual([
      { field: "name", message: "El nombre debe tener al menos 2 caracteres" },
    ]);
  });
});
