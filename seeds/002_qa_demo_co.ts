import { Knex } from "knex";
import bcrypt from "bcryptjs";
import { RbacService } from "../src/services/rbac.service";
import { ADMIN_ROLE_NAME } from "../src/common/constants/permissions-catalog";

/**
 * "QA Demo CO" — a full main-module demo tenant.
 *
 * Purpose is feel, not fixtures: every ERP screen gets at least three pages of
 * plausible corrugated-box data (the SPA's `useEntityList` default is 20 rows),
 * with the derived states — sales-order approval, production-order scheduling,
 * part approval — spread across the whole vocabulary rather than all pending.
 * Nothing here is a test fixture; no suite may depend on it.
 *
 * Run:
 *   cd repos/mobius-api
 *   SQL_HOST=localhost NODE_ENV=development SEED_QA_DEMO=1 \
 *     npx knex seed:run --specific=002_qa_demo_co.ts --knexfile knexfile.ts
 *
 * The `SEED_QA_DEMO` gate is deliberate: `npm run seed:run` runs every file in
 * this directory, and a demo tenant must never appear in a real database by
 * accident. Re-running rebuilds the company from scratch — the delete leans on
 * `ON DELETE CASCADE` from `companies`, which every table below is rooted in.
 */

const COMPANY_NAME = "QA Demo CO";
const COMPANY_SLUG = "qa-demo-co";
const ADMIN_EMAIL = "admin@qa-demo-co.local";
const DEMO_PASSWORD = "QaDemo123!";
const ACTOR = "ana.demo";

/**
 * Several code columns (paper_types, suppliers, corrugations, …) are unique
 * across ALL companies, not per tenant, so every seeded code carries this
 * prefix to stay clear of whatever else lives in the database.
 */
const P = "QD";

/** Row counts. 46 clears three pages at the app's default limit of 20. */
const N = {
  catalog: 46,
  extraRoles: 30,
  users: 44,
  invitations: 18,
  customers: 64,
  paperSupplies: 64,
  products: 72,
  parts: 78,
  stock: 64,
  salesOrders: 86,
  productionOrders: 92,
};

/** Warehouses that get a real location grid (stock hangs off these). */
const WAREHOUSES_WITH_LOCATIONS = 8;

// ---------------------------------------------------------------------------
// Deterministic helpers — same command, same dataset, every run.
// ---------------------------------------------------------------------------

let rngState = 20260826;
const rnd = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};
const int = (min: number, max: number): number =>
  min + Math.floor(rnd() * (max - min + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
const chance = (p: number): boolean => rnd() < p;
const dec = (min: number, max: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round((min + rnd() * (max - min)) * factor) / factor;
};

const series = <T>(count: number, build: (i: number) => T): T[] =>
  Array.from({ length: count }, (_, i) => build(i));

const pad = (value: number, width = 3): string =>
  String(value).padStart(width, "0");

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * A step through `0..total-1` that is coprime with `total`, so walking it hits
 * every cell exactly once while landing far from where it started.
 */
const strideFor = (total: number): number => {
  for (let step = Math.max(1, Math.floor(total / 3)); step < total; step++) {
    if (gcd(step, total) === 1) return step;
  }
  return 1;
};

/**
 * `count` unique "<left> <right>" labels drawn from the left×right grid.
 *
 * The grid is walked by a coprime stride rather than in order: cycling the
 * left pool fastest makes eight consecutive rows read "Alimentos La Pampa,
 * Bodegas La Pampa, Frigorífico La Pampa …", which looks generated on any
 * screen that lists them in insert order.
 */
const combos = (
  count: number,
  left: readonly string[],
  right: readonly string[],
): string[] => {
  const total = left.length * right.length;
  if (count > total) {
    throw new Error(
      `combos: need ${count} labels but the pools only make ${total}`,
    );
  }
  const stride = strideFor(total);
  return series(count, (i) => {
    const cell = (i * stride) % total;
    const l = left[cell % left.length] as string;
    const r = right[Math.floor(cell / left.length)] as string;
    return `${l} ${r}`;
  });
};

/** Dates are relative to a fixed epoch so the dataset does not drift per run. */
const SEED_EPOCH = Date.UTC(2026, 7, 26);
const daysFrom = (days: number): Date =>
  new Date(SEED_EPOCH + days * 24 * 60 * 60 * 1000);

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, ".");

type Row = Record<string, unknown>;

/** Insert and return the generated ids, in insert order. */
const insertMany = async (
  trx: Knex,
  table: string,
  rows: Row[],
): Promise<number[]> => {
  if (rows.length === 0) return [];
  const inserted = await trx(table).insert(rows).returning("id");
  return inserted.map((r: unknown) =>
    typeof r === "number" ? r : Number((r as { id: number }).id),
  );
};

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Lucía",
  "Martín",
  "Sofía",
  "Mateo",
  "Valentina",
  "Joaquín",
  "Camila",
  "Benjamín",
  "Emilia",
  "Thiago",
  "Renata",
  "Bautista",
  "Isabella",
  "Facundo",
  "Julieta",
  "Santino",
  "Delfina",
  "Ignacio",
  "Catalina",
  "Lautaro",
  "Mora",
  "Tomás",
];
const LAST_NAMES = [
  "González",
  "Rodríguez",
  "Fernández",
  "López",
  "Martínez",
  "Pérez",
  "Gómez",
  "Sánchez",
  "Romero",
  "Álvarez",
  "Torres",
  "Ruiz",
  "Ramírez",
  "Flores",
  "Benítez",
  "Acosta",
  "Medina",
  "Herrera",
  "Suárez",
  "Aguirre",
  "Molina",
  "Silva",
];
const CITIES = [
  "Rosario",
  "Córdoba",
  "Mendoza",
  "La Plata",
  "Tucumán",
  "Salta",
  "Paraná",
  "Bahía Blanca",
  "Neuquén",
  "Santa Fe",
  "Mar del Plata",
  "San Juan",
];
const STREETS = [
  "Av. Circunvalación",
  "Ruta Provincial 9",
  "Calle Los Industriales",
  "Parque Industrial Norte",
  "Av. San Martín",
  "Camino a Pilar",
  "Colectora Este",
  "Av. de las Américas",
];

// ---------------------------------------------------------------------------

export async function seed(knex: Knex): Promise<void> {
  if (process.env.SEED_QA_DEMO !== "1") {
    console.log(
      "· 002_qa_demo_co skipped (set SEED_QA_DEMO=1 to seed the demo tenant)",
    );
    return;
  }

  let existing = await knex("companies").where({ slug: COMPANY_SLUG }).first();

  // A tenant by this slug may already exist and hold real rows — in a shared
  // database it may sit beside live customers. Default is therefore ADDITIVE:
  // adopt the company and add to it. Only SEED_QA_DEMO_RESET=1 deletes, and
  // that cascades away everything the company owns, so it is a local-only tool.
  if (existing && process.env.SEED_QA_DEMO_RESET === "1") {
    // Carry the old row's uuid onto the new one. Everything cascades from the
    // company, and a fresh uuid would strand any open session: the SPA pins the
    // superAdmin company switcher to a uuid in localStorage, so a rotated uuid
    // leaves it sending `?companyId=<gone>` on every list.
    const keepUuid = existing.uuid as string;
    console.log(
      `· RESET: deleting and rebuilding "${COMPANY_NAME}" (id ${existing.id}), keeping uuid ${keepUuid}`,
    );
    await knex("companies").where({ id: existing.id }).delete();
    existing = undefined;
    await knex.transaction(async (trx) => {
      await runSeed(trx, await seedCompany(trx, keepUuid));
    });
    console.log(
      `✓ "${COMPANY_NAME}" seeded — login ${ADMIN_EMAIL} / ${DEMO_PASSWORD}`,
    );
    return;
  }

  if (existing) {
    // Re-running additively would collide on this seed's fixed codes, so stop
    // with an explanation rather than a unique-violation stack trace.
    const alreadySeeded = await knex("customers")
      .where({ companyId: existing.id })
      .whereLike("code", `${P}-CLI-%`)
      .first();
    if (alreadySeeded) {
      throw new Error(
        `"${COMPANY_NAME}" (id ${existing.id}) already holds this seed's data. ` +
          `Re-run with SEED_QA_DEMO_RESET=1 to rebuild it from scratch — that ` +
          `DELETES the company and everything cascading from it.`,
      );
    }
    console.log(
      `· Adding demo data to the existing "${existing.name}" (id ${existing.id}), keeping its ${await knex(
        "customers",
      )
        .where({ companyId: existing.id })
        .count("* as n")
        .first()
        .then((r) => r?.n ?? 0)} existing customer(s)`,
    );
  }

  await knex.transaction(async (trx) => {
    const companyId = existing
      ? await adoptCompany(trx, existing.id as number)
      : await seedCompany(trx);
    await runSeed(trx, companyId);
  });

  console.log(
    `✓ "${COMPANY_NAME}" seeded — login ${ADMIN_EMAIL} / ${DEMO_PASSWORD}`,
  );
}

/** Everything below the company row, shared by the additive and reset paths. */
async function runSeed(trx: Knex, companyId: number): Promise<void> {
  {
    const people = await seedPeople(trx, companyId);
    const catalogs = await seedCatalogs(trx, companyId);
    const commercial = await seedCommercial(trx, companyId, people, catalogs);
    const production = await seedProduction(trx, companyId, catalogs);
    await seedStock(trx, catalogs);
    const engineering = await seedEngineering(
      trx,
      companyId,
      catalogs,
      commercial,
      production,
    );
    await seedOrders(
      trx,
      companyId,
      people,
      catalogs,
      commercial,
      production,
      engineering,
    );
  }
}

/**
 * Bring an existing tenant up to the baseline the demo data assumes — the core
 * module linked and the RBAC catalogue present — without touching a row it
 * already owns. Both operations are idempotent.
 */
async function adoptCompany(trx: Knex, companyId: number): Promise<number> {
  const core = await trx("modules").where({ slug: "core" }).first();
  if (core) {
    await trx("company_modules")
      .insert({ companyId, moduleId: core.id, enabled: true })
      .onConflict(["companyId", "moduleId"])
      .ignore();
  }
  await RbacService.seedCompanyRbac(trx, companyId);
  return companyId;
}

// ---------------------------------------------------------------------------
// Company provisioning
// ---------------------------------------------------------------------------

async function seedCompany(trx: Knex, keepUuid?: string): Promise<number> {
  const [companyId] = await insertMany(trx, "companies", [
    {
      ...(keepUuid ? { uuid: keepUuid } : {}),
      name: COMPANY_NAME,
      slug: COMPANY_SLUG,
      description:
        "Tenant de demostración para QA — datos ficticios de cartón corrugado.",
      isActive: true,
    },
  ]);
  if (companyId === undefined) throw new Error("company insert returned no id");

  // The same provisioning the companies controller performs on create: the
  // core module linked, then the cloned permission catalogue, the protected
  // Admin role and the Procusto profile templates.
  const core = await trx("modules").where({ slug: "core" }).first();
  if (core) {
    await trx("company_modules").insert({
      companyId,
      moduleId: core.id,
      enabled: true,
    });
  }
  await RbacService.seedCompanyRbac(trx, companyId);

  return companyId;
}

// ---------------------------------------------------------------------------
// Roles, users, invitations
// ---------------------------------------------------------------------------

type People = {
  adminUserId: number;
  userIds: number[];
  salesUserIds: number[];
};

async function seedPeople(trx: Knex, companyId: number): Promise<People> {
  // On top of the 16 roles the RBAC catalogue installs, so the Roles screen is
  // more than one page.
  await insertMany(
    trx,
    "roles",
    combos(
      N.extraRoles,
      ["Supervisor", "Operador", "Analista", "Jefe", "Auxiliar", "Referente"],
      [
        "de Corrugado",
        "de Impresión",
        "de Troquelado",
        "de Depósito",
        "de Calidad",
      ],
    ).map((name, i) => ({
      companyId,
      name,
      profileType: i % 3 === 0 ? "production" : "general",
      hasAccessToAllMachines: i % 4 !== 0,
      isProtected: false,
    })),
  );

  const adminRole = await trx("roles")
    .where({ companyId, name: ADMIN_ROLE_NAME })
    .first();
  const allRoles = await trx("roles").where({ companyId }).select("id");

  // The admin is the documented way in. The other 43 accounts exist so the
  // Users screen has rows to page through — they get an unguessable hash
  // instead of the shared demo password, so seeding a tenant never mints 43
  // usable logins on a database that also serves real customers.
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);
  const unusablePassword = await bcrypt.hash(
    `${DEMO_PASSWORD}-${Math.random()}-${process.pid}-no-login`,
    10,
  );

  const [adminUserId] = await insertMany(trx, "users", [
    {
      email: ADMIN_EMAIL,
      password,
      firstName: "Ana",
      lastName: "Demo",
      username: ACTOR,
      role: "admin",
      roleId: adminRole?.id ?? null,
      companyId,
      isActive: true,
      emailVerified: true,
    },
  ]);
  if (adminUserId === undefined) throw new Error("admin insert returned no id");

  const userIds = await insertMany(
    trx,
    "users",
    series(N.users - 1, (i) => {
      const firstName = FIRST_NAMES[i % FIRST_NAMES.length] as string;
      const lastName = LAST_NAMES[(i * 5 + 3) % LAST_NAMES.length] as string;
      const handle = slugify(`${firstName} ${lastName}`);
      return {
        email: `${handle}.${pad(i + 1, 2)}@qa-demo-co.local`,
        password: unusablePassword,
        firstName,
        lastName,
        username: `${handle}${pad(i + 1, 2)}`,
        role: i % 11 === 0 ? "admin" : "member",
        roleId: pick(allRoles).id as number,
        companyId,
        isActive: i % 9 !== 0,
        emailVerified: i % 5 !== 0,
        managerId: adminUserId,
      };
    }),
  );

  await insertMany(
    trx,
    "invitations",
    series(N.invitations, (i) => {
      const accepted = i % 3 === 0;
      return {
        email: `invitado.${pad(i + 1, 2)}@qa-demo-co.local`,
        token: `qa-demo-invite-${pad(i + 1, 4)}`,
        role: i % 7 === 0 ? "admin" : "member",
        companyId,
        invitedBy: adminUserId,
        expiresAt: daysFrom(i % 5 === 0 ? -3 : 14),
        acceptedAt: accepted ? daysFrom(-(i + 1)) : null,
        isUsed: accepted,
      };
    }),
  );

  // Every third member sells; customers and sales orders draw from this pool.
  const salesUserIds = userIds.filter((_, i) => i % 3 === 0);

  return { adminUserId, userIds, salesUserIds };
}

// ---------------------------------------------------------------------------
// Flat catalogues + the entities built directly on them
// ---------------------------------------------------------------------------

type Catalogs = {
  customerCategoryIds: number[];
  paperTypeIds: number[];
  fluteTypeIds: number[];
  flapTypeIds: number[];
  productTypeIds: number[];
  boxTypeIds: number[];
  paperClassIds: number[];
  manufacturerIds: number[];
  supplierIds: number[];
  warehouseIds: number[];
  locationsByWarehouse: Map<number, number[]>;
  corrugationClassIds: number[];
  glueTypeIds: number[];
  colorTypeIds: number[];
  colorIds: number[];
  fscTypeIds: number[];
  deliveryZoneIds: number[];
  machineTypeIds: number[];
  palletTypeIds: number[];
  strappingTypeIds: number[];
  traceTypeIds: number[];
  complementIds: number[];
  toolingTypeIds: number[];
  toolingIds: number[];
  consumableTypeIds: number[];
  consumableSupplyIds: number[];
  corrugationIds: number[];
  paperSupplyIds: number[];
  paperSheetIds: number[];
  machineIds: number[];
  palletizationIds: number[];
  modelIds: number[];
};

async function seedCatalogs(trx: Knex, companyId: number): Promise<Catalogs> {
  const customerCategoryIds = await insertMany(
    trx,
    "customer_categories",
    combos(
      N.catalog,
      [
        "Alimenticia",
        "Vitivinícola",
        "Automotriz",
        "Farmacéutica",
        "Logística",
        "Agro",
      ],
      [
        "A",
        "B",
        "C",
        "Premium",
        "Contrato",
        "Ocasional",
        "Exportación",
        "Retail",
      ],
    ).map((name) => ({ companyId, name })),
  );

  const paperTypeIds = await insertMany(
    trx,
    "paper_types",
    combos(
      N.catalog,
      [
        "Kraft",
        "Testliner",
        "White Top",
        "Semiquímico",
        "Reciclado",
        "Fluting",
      ],
      [
        "Virgen",
        "Nacional",
        "Importado",
        "Blanqueado",
        "Reforzado",
        "Estándar",
        "Premium",
        "Económico",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-PAP-${pad(i + 1)}`,
      description: label,
    })),
  );

  const fluteTypeIds = await insertMany(
    trx,
    "flute_types",
    series(N.catalog, (i) => {
      const letter = ["B", "C", "E", "F", "BC", "EB"][i % 6] as string;
      return {
        companyId,
        code: `${P}-ONDA-${letter}${pad(i + 1, 2)}`,
        description: `Onda ${letter} — paso ${dec(3, 9, 1)} mm`,
        fluteFactor: dec(1.25, 1.6, 3),
        length: dec(1.3, 1.55, 3),
        width: dec(1.3, 1.55, 3),
        height: dec(1.1, 4.9, 2),
      };
    }),
  );

  const flapTypeIds = await insertMany(
    trx,
    "flap_types",
    combos(
      N.catalog,
      ["Solapa", "Aleta", "Tapa", "Fondo", "Refuerzo", "Cierre"],
      [
        "simple",
        "doble",
        "encontrada",
        "superpuesta",
        "automática",
        "corta",
        "larga",
        "invertida",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-SOL-${pad(i + 1)}`,
      description: label,
    })),
  );

  const productTypeIds = await insertMany(
    trx,
    "product_types",
    combos(
      N.catalog,
      ["Caja", "Bandeja", "Separador", "Plancha", "Display", "Envase"],
      [
        "regular",
        "troquelada",
        "autoarmable",
        "de exportación",
        "reforzada",
        "impresa",
        "microcorrugada",
        "estándar",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-TPR-${pad(i + 1)}`,
      name,
    })),
  );

  const boxTypeIds = await insertMany(
    trx,
    "box_types",
    combos(
      N.catalog,
      [
        "FEFCO 0201",
        "FEFCO 0203",
        "FEFCO 0409",
        "FEFCO 0427",
        "FEFCO 0713",
        "FEFCO 0300",
      ],
      [
        "base",
        "variante A",
        "variante B",
        "reforzada",
        "con ventana",
        "apilable",
        "con asas",
        "sin impresión",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-TCJ-${pad(i + 1)}`,
      name,
    })),
  );

  const paperClassIds = await insertMany(
    trx,
    "paper_classes",
    combos(
      N.catalog,
      [
        "Liner",
        "Corrugado medio",
        "Cara externa",
        "Cara interna",
        "Onda",
        "Cubierta",
      ],
      ["120 g", "140 g", "160 g", "180 g", "200 g", "220 g", "250 g", "300 g"],
    ).map((name, i) => ({
      companyId,
      code: `${P}-CLP-${pad(i + 1)}`,
      name,
    })),
  );

  const manufacturerIds = await insertMany(
    trx,
    "manufacturers",
    combos(
      N.catalog,
      ["Papelera", "Cartonera", "Industrias", "Molino", "Celulosa", "Grupo"],
      [
        "del Litoral",
        "Andina",
        "del Plata",
        "Austral",
        "Central",
        "del Norte",
        "Pampeana",
        "Cuyana",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-FAB-${pad(i + 1)}`,
      name,
    })),
  );

  // `suppliers` has no name column — the code is its only label on the list
  // screen, so the code carries the trade name and the prefix keeps it unique.
  const supplierIds = await insertMany(
    trx,
    "suppliers",
    combos(
      N.catalog,
      [
        "Distribuidora",
        "Insumos",
        "Suministros",
        "Comercial",
        "Proveedora",
        "Abastecimientos",
      ],
      [
        "Rosario",
        "Córdoba",
        "Litoral",
        "Sur",
        "Norte",
        "Cuyo",
        "Delta",
        "Pampa",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${name} (${P}-${pad(i + 1)})`,
      suppliesSheets: i % 2 === 0,
      suppliesElaborated: i % 3 === 0,
      suppliesConsumables: i % 4 !== 0,
      suppliesPaper: i % 2 === 1,
      suppliesTooling: i % 5 === 0,
    })),
  );

  const warehouseIds = await insertMany(
    trx,
    "warehouses",
    combos(
      N.catalog,
      ["Depósito", "Almacén", "Playa", "Nave", "Sector", "Cámara"],
      [
        "Central",
        "Norte",
        "Sur",
        "de Bobinas",
        "de Planchas",
        "de Insumos",
        "de Producto Terminado",
        "de Tránsito",
      ],
    ).map((name, i) => ({
      company_id: companyId,
      name: `${name} ${pad(i + 1, 2)}`,
      grid_rows: 5,
      grid_cols: 5,
    })),
  );

  // A real 5×5 grid for the first few warehouses — enough to hang stock on
  // without generating a location row for all 46.
  const locationsByWarehouse = new Map<number, number[]>();
  for (const warehouseId of warehouseIds.slice(0, WAREHOUSES_WITH_LOCATIONS)) {
    const rows: Row[] = [];
    for (let row = 1; row <= 5; row++) {
      for (let col = 1; col <= 5; col++) {
        rows.push({
          warehouse_id: warehouseId,
          row,
          col,
          status: "active",
          location_type: col === 1 ? "picking" : "storage",
          location_code: `${String.fromCharCode(64 + row)}-${pad(col, 2)}`,
        });
      }
    }
    locationsByWarehouse.set(
      warehouseId,
      await insertMany(trx, "warehouse_locations", rows),
    );
  }

  const corrugationClassIds = await insertMany(
    trx,
    "corrugation_classes",
    combos(
      N.catalog,
      ["Simple", "Doble", "Triple", "Micro", "Mixta", "Especial"],
      [
        "liviana",
        "media",
        "pesada",
        "exportación",
        "húmeda",
        "impresión",
        "apilado",
        "económica",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-CLC-${pad(i + 1)}`,
      description: label,
    })),
  );

  const glueTypeIds = await insertMany(
    trx,
    "glue_types",
    combos(
      N.catalog,
      ["Adhesivo", "Cola", "Pegamento", "Engrudo", "Resina", "Hot-melt"],
      [
        "vinílico",
        "de almidón",
        "resistente al agua",
        "de fraguado rápido",
        "alta temperatura",
        "baja viscosidad",
        "reciclable",
        "grado alimenticio",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-PEG-${pad(i + 1)}`,
      description: label,
    })),
  );

  const colorTypeIds = await insertMany(
    trx,
    "color_types",
    combos(
      N.catalog,
      [
        "Flexográfica",
        "Offset",
        "Serigrafía",
        "Base agua",
        "Base solvente",
        "UV",
      ],
      [
        "proceso",
        "directo",
        "Pantone",
        "metalizado",
        "fluorescente",
        "opaco",
        "transparente",
        "mate",
      ],
    ).map((name) => ({
      companyId,
      name,
      description: `Familia de tintas ${name.toLowerCase()}`,
    })),
  );

  const colorIds = await insertMany(
    trx,
    "colors",
    combos(
      N.catalog,
      ["Azul", "Rojo", "Verde", "Negro", "Amarillo", "Naranja"],
      [
        "institucional",
        "profundo",
        "claro",
        "reflex",
        "pastel",
        "intenso",
        "cálido",
        "frío",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-COL-${pad(i + 1)}`,
      name,
      description: `Tinta ${name.toLowerCase()}`,
      observations: chance(0.35) ? "Requiere prueba de color previa." : null,
      tonality: int(1, 10),
      colorTypeId: colorTypeIds[i % colorTypeIds.length] ?? null,
    })),
  );

  const fscTypeIds = await insertMany(
    trx,
    "fsc_types",
    combos(
      N.catalog,
      [
        "FSC 100%",
        "FSC Mix",
        "FSC Recycled",
        "Controlled Wood",
        "PEFC",
        "Sin certificar",
      ],
      [
        "credit",
        "percentage",
        "transfer",
        "declarado",
        "auditado",
        "provisorio",
        "vencido",
        "en trámite",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-FSC-${pad(i + 1)}`,
      description: label,
    })),
  );

  const deliveryZoneIds = await insertMany(
    trx,
    "delivery_zones",
    combos(
      N.catalog,
      ["Zona", "Corredor", "Ruta", "Área", "Región", "Circuito"],
      CITIES,
    ).map((label, i) => ({
      companyId,
      code: `${P}-ZON-${pad(i + 1)}`,
      description: label,
    })),
  );

  const machineTypeIds = await insertMany(
    trx,
    "machine_types",
    combos(
      N.catalog,
      [
        "Corrugadora",
        "Impresora",
        "Troqueladora",
        "Pegadora",
        "Encintadora",
        "Guillotina",
      ],
      [
        "flexo 2 colores",
        "flexo 4 colores",
        "plana",
        "rotativa",
        "automática",
        "semiautomática",
        "de alta velocidad",
        "de precisión",
      ],
    ).map((name, i) => ({
      companyId,
      name,
      location: (i % 4) + 1,
      requiresDie: i % 3 === 0,
      requiresPlate: i % 2 === 0,
      attribute: `Línea ${String.fromCharCode(65 + (i % 5))}`,
      corrugated: i % 6 === 0,
      generatesSheets: i % 6 === 0,
    })),
  );

  const palletTypeIds = await insertMany(
    trx,
    "pallet_types",
    combos(
      N.catalog,
      ["Pallet", "Tarima", "Base", "Plataforma", "Rack", "Slip-sheet"],
      [
        "europeo",
        "americano",
        "descartable",
        "reforzado",
        "plástico",
        "de madera dura",
        "media altura",
        "exportación",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-PLT-${pad(i + 1)}`,
      description: label,
      length: dec(800, 1400, 0),
      width: dec(600, 1200, 0),
      height: dec(120, 180, 0),
      weight: dec(12, 32, 1),
    })),
  );

  const strappingTypeIds = await insertMany(
    trx,
    "strapping_types",
    combos(
      N.catalog,
      ["Fleje", "Zuncho", "Film", "Cinta", "Banda", "Cordel"],
      [
        "polipropileno",
        "poliéster",
        "stretch",
        "manual",
        "automático",
        "reforzado",
        "reciclado",
        "impreso",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-FLJ-${pad(i + 1)}`,
      description: label,
    })),
  );

  const traceTypeIds = await insertMany(
    trx,
    "trace_types",
    combos(
      N.catalog,
      ["Hendido", "Ranurado", "Plegado", "Corte", "Perforado", "Marcado"],
      [
        "simple",
        "doble",
        "profundo",
        "suave",
        "en línea",
        "transversal",
        "longitudinal",
        "combinado",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-HEN-${pad(i + 1)}`,
      description: label,
    })),
  );

  const complementIds = await insertMany(
    trx,
    "complements",
    combos(
      N.catalog,
      ["Manija", "Ventana", "Divisor", "Precinto", "Etiqueta", "Refuerzo"],
      [
        "troquelada",
        "plástica",
        "adhesiva",
        "interna",
        "externa",
        "removible",
        "de seguridad",
        "impresa",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-CMP-${pad(i + 1)}`,
      description: label,
    })),
  );

  const toolingTypeIds = await insertMany(
    trx,
    "tooling_types",
    combos(
      N.catalog,
      ["Troquel", "Clisé", "Contratroquel", "Cilindro", "Matriz", "Sacabocado"],
      [
        "plano",
        "rotativo",
        "flexo",
        "de precisión",
        "de repuesto",
        "compartido",
        "de exportación",
        "prototipo",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-TTL-${pad(i + 1)}`,
      name,
      description: `Herramental ${name.toLowerCase()}`,
      automaticConsumption: i % 4 === 0,
    })),
  );

  const toolingIds = await insertMany(
    trx,
    "toolings",
    combos(
      N.catalog,
      ["Troquel", "Clisé", "Cilindro", "Matriz", "Contra", "Placa"],
      ["A-100", "B-200", "C-300", "D-400", "E-500", "F-600", "G-700", "H-800"],
    ).map((name, i) => ({
      companyId,
      code: `${P}-HTL-${pad(i + 1)}`,
      name,
      description: `Herramental ${name} en servicio`,
      toolingTypeId: toolingTypeIds[i % toolingTypeIds.length] as number,
      manufacturerId: pick(manufacturerIds),
      supplierId: pick(supplierIds),
      minimumStock: int(1, 6),
    })),
  );

  const consumableTypeIds = await insertMany(
    trx,
    "consumable_types",
    combos(
      N.catalog,
      ["Tinta", "Adhesivo", "Fleje", "Film", "Etiqueta", "Repuesto"],
      [
        "de línea",
        "de reserva",
        "importado",
        "nacional",
        "a granel",
        "en cartucho",
        "en tambor",
        "en rollo",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-TCN-${pad(i + 1)}`,
      name,
      autoConsumption: i % 3 === 0,
    })),
  );

  const consumableSupplyIds = await insertMany(
    trx,
    "consumable_supplies",
    combos(
      N.catalog,
      [
        "Tinta",
        "Cola vinílica",
        "Fleje PP",
        "Film stretch",
        "Etiqueta térmica",
        "Grasa",
      ],
      ["20 kg", "200 L", "12 mm", "500 mm", "100x150", "5 kg", "1 L", "25 kg"],
    ).map((name, i) => ({
      companyId,
      code: `${P}-INS-${pad(i + 1)}`,
      name,
      description: `Insumo ${name.toLowerCase()}`,
      consumableTypeId: consumableTypeIds[
        i % consumableTypeIds.length
      ] as number,
      supplierId: pick(supplierIds),
      manufacturerId: pick(manufacturerIds),
      colorId: i % 3 === 0 ? pick(colorIds) : null,
      location: `Estante ${String.fromCharCode(65 + (i % 6))}${int(1, 9)}`,
      expiry: chance(0.4) ? "12 meses" : null,
      minimumStock: dec(5, 120, 0),
    })),
  );

  const corrugationIds = await insertMany(
    trx,
    "corrugations",
    combos(
      N.catalog,
      ["Simple B", "Simple C", "Doble BC", "Micro E", "Micro F", "Triple BCA"],
      [
        "120/140",
        "140/160",
        "160/180",
        "180/200",
        "200/220",
        "220/250",
        "250/300",
        "300/350",
      ],
    ).map((label, i) => ({
      companyId,
      code: `${P}-COR-${pad(i + 1)}`,
      description: label,
      theoreticalGrammage: dec(380, 1150, 1),
      suggestedWidth: dec(900, 2400, 0),
      caliper: dec(1.5, 8.2, 2),
      corrugationClassId:
        corrugationClassIds[i % corrugationClassIds.length] ?? null,
    })),
  );

  // Three layers per corrugation: liner / onda / liner.
  const layerRows: Row[] = [];
  for (const corrugationId of corrugationIds) {
    for (let position = 1; position <= 3; position++) {
      const isLiner = position !== 2;
      layerRows.push({
        corrugationId,
        position,
        isLiner,
        paperClassId: pick(paperClassIds),
        fluteTypeId: isLiner ? null : pick(fluteTypeIds),
      });
    }
  }
  await insertMany(trx, "corrugation_layers", layerRows);

  const paperSupplyIds = await insertMany(
    trx,
    "paper_supplies",
    combos(
      N.paperSupplies,
      [
        "Bobina Kraft",
        "Bobina Testliner",
        "Bobina White Top",
        "Bobina Fluting",
        "Bobina Reciclada",
        "Bobina Semiquímica",
        "Bobina Liner",
        "Bobina Onda",
      ],
      [
        "1200 mm",
        "1400 mm",
        "1600 mm",
        "1800 mm",
        "2000 mm",
        "2200 mm",
        "2400 mm",
        "1000 mm",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-BOB-${pad(i + 1)}`,
      name,
      description: `Papel para corrugado — ${name.toLowerCase()}`,
      grammage: dec(90, 350, 0),
      paperTypeId: pick(paperTypeIds),
      manufacturerId: pick(manufacturerIds),
      supplierId: pick(supplierIds),
      fscTypeId: chance(0.7) ? pick(fscTypeIds) : null,
      price: dec(420, 1850, 2),
      color: pick(["Natural", "Blanco", "Marrón", "Beige"]),
      minimumStock: JSON.stringify({
        weight: int(500, 4000),
        coils: int(2, 12),
      }),
    })),
  );

  // Which papers each class admits (composite PK, so plain distinct pairs).
  const classPaperRows: Row[] = [];
  paperClassIds.forEach((paperClassId, i) => {
    for (let k = 0; k < 3; k++) {
      classPaperRows.push({
        paperClassId,
        paperSupplyId: paperSupplyIds[(i * 3 + k) % paperSupplyIds.length],
      });
    }
  });
  await trx("paper_class_papers").insert(classPaperRows);

  const paperSheetIds = await insertMany(
    trx,
    "paper_sheets",
    combos(
      N.catalog,
      [
        "Plancha B",
        "Plancha C",
        "Plancha BC",
        "Plancha E",
        "Plancha EB",
        "Plancha F",
      ],
      [
        "800x600",
        "1000x700",
        "1200x800",
        "1400x900",
        "1600x1000",
        "1800x1100",
        "2000x1200",
        "900x650",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-PLN-${pad(i + 1)}`,
      name,
      description: `Plancha corrugada ${name}`,
      corrugationId: pick(corrugationIds),
      supplierId: pick(supplierIds),
      manufacturerId: pick(manufacturerIds),
      minimumStock: int(50, 900),
      length: dec(600, 2000, 0),
      width: dec(400, 1400, 0),
    })),
  );

  const machineIds = await insertMany(
    trx,
    "machines",
    combos(
      N.catalog,
      [
        "Corrugadora",
        "Flexo",
        "Troqueladora",
        "Pegadora",
        "Encintadora",
        "Guillotina",
      ],
      ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"],
    ).map((name, i) => ({
      companyId,
      code: `${P}-MAQ-${pad(i + 1)}`,
      description: `${name} — línea ${String.fromCharCode(65 + (i % 5))}`,
      machineTypeId: machineTypeIds[i % machineTypeIds.length] as number,
      sheetWidthMin: dec(400, 700, 0),
      sheetWidthMax: dec(1400, 2400, 0),
      sheetLengthMin: dec(500, 800, 0),
      sheetLengthMax: dec(1800, 3200, 0),
      width: dec(1600, 2600, 0),
      setupTime: dec(8, 75, 1),
      maxScoreLines: int(4, 12),
      linearMeters: dec(60, 320, 1),
      boxWidthMin: dec(80, 200, 0),
      boxWidthMax: dec(600, 1200, 0),
      boxLengthMin: dec(100, 250, 0),
      boxLengthMax: dec(700, 1500, 0),
      boxHeightMin: dec(50, 150, 0),
      boxHeightMax: dec(400, 1000, 0),
      sourceWarehouseId: pick(warehouseIds),
      destinationWarehouseId: pick(warehouseIds),
    })),
  );

  const palletizationIds = await insertMany(
    trx,
    "palletizations",
    combos(
      N.catalog,
      ["Palletizado", "Estiba", "Armado", "Columna", "Traba", "Mixto"],
      [
        "estándar",
        "cruzado",
        "en bloque",
        "alto",
        "bajo",
        "para exportación",
        "con separador",
        "compacto",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-PZD-${pad(i + 1)}`,
      name,
      description: `Esquema de estiba ${name.toLowerCase()}`,
      boxesPerPackage: int(5, 40),
      packagesPerLevel: int(3, 12),
      levelsPerPallet: int(3, 10),
      additionalPackages: int(0, 4),
      sheetsPerPallet: int(50, 400),
      maxPalletHeight: dec(1200, 2200, 0),
      surface: dec(0.8, 2.4, 3),
      stackingType: pick(["Columna", "Traba", "Mixto"]),
      observations: chance(0.3) ? "No apilar más de dos pallets." : null,
      palletTypeId: pick(palletTypeIds),
    })),
  );

  const modelIds = await insertMany(
    trx,
    "models",
    combos(
      N.catalog,
      [
        "Modelo caja",
        "Modelo bandeja",
        "Modelo display",
        "Modelo separador",
        "Modelo envase",
        "Modelo plancha",
      ],
      ["A", "B", "C", "D", "E", "F", "G", "H"],
    ).map((name, i) => ({
      companyId,
      code: `${P}-MOD-${pad(i + 1)}`,
      description: `${name} — desarrollo paramétrico`,
      sheetLengthFormula: "2*(Largo+Ancho)+Pestania",
      sheetWidthFormula: "Alto+2*Solapa",
      corrugationScoreLineFormulas: "Largo;Ancho;Largo;Ancho",
      printScoreLineFormulas: "Solapa;Alto;Solapa",
      lowerFlapFormula: "Ancho/2",
      upperFlapFormula: "Ancho/2",
      externalLengthDeltaFormula: "Espesor*2",
      externalWidthDeltaFormula: "Espesor*2",
      externalHeightDeltaFormula: "Espesor*2",
      boxSurfaceFormula: "(2*(Largo+Ancho))*(Alto+Ancho)/1000000",
      flapTypeId: pick(flapTypeIds),
      complementId: chance(0.4) ? pick(complementIds) : null,
    })),
  );

  return {
    customerCategoryIds,
    paperTypeIds,
    fluteTypeIds,
    flapTypeIds,
    productTypeIds,
    boxTypeIds,
    paperClassIds,
    manufacturerIds,
    supplierIds,
    warehouseIds,
    locationsByWarehouse,
    corrugationClassIds,
    glueTypeIds,
    colorTypeIds,
    colorIds,
    fscTypeIds,
    deliveryZoneIds,
    machineTypeIds,
    palletTypeIds,
    strappingTypeIds,
    traceTypeIds,
    complementIds,
    toolingTypeIds,
    toolingIds,
    consumableTypeIds,
    consumableSupplyIds,
    corrugationIds,
    paperSupplyIds,
    paperSheetIds,
    machineIds,
    palletizationIds,
    modelIds,
  };
}

// ---------------------------------------------------------------------------
// Customers, delivery points, products
// ---------------------------------------------------------------------------

type Commercial = {
  customerIds: number[];
  deliveryLocationByCustomer: Map<number, number[]>;
  productIds: number[];
  productCustomer: Map<number, number>;
};

/** Customers that get delivery points and a weekly window. */
const CUSTOMERS_WITH_DELIVERY = 45;

async function seedCommercial(
  trx: Knex,
  companyId: number,
  people: People,
  catalogs: Catalogs,
): Promise<Commercial> {
  const customerIds = await insertMany(
    trx,
    "customers",
    combos(
      N.customers,
      [
        "Alimentos",
        "Bodegas",
        "Frigorífico",
        "Lácteos",
        "Molinos",
        "Conservas",
        "Química",
        "Textil",
      ],
      [
        "del Valle",
        "San Rafael",
        "La Pampa",
        "Río Cuarto",
        "El Trébol",
        "Los Andes",
        "Santa Rosa",
        "Puerto Norte",
      ],
    ).map((name, i) => ({
      companyId,
      code: `${P}-CLI-${pad(i + 1)}`,
      name,
      tradeName: name,
      legalName: `${name} S.A.`,
      legal_code: `30-${int(10000000, 99999999)}-${int(0, 9)}`,
      supplier_code: `PRV-${pad(i + 1, 4)}`,
      address: `${pick(STREETS)} ${int(100, 9800)}, ${pick(CITIES)}`,
      categoryId: pick(catalogs.customerCategoryIds),
      salesPersonId:
        people.salesUserIds.length > 0 ? pick(people.salesUserIds) : null,
      active: i % 12 !== 0,
      dispatchable: i % 9 !== 0,
      excludeLogoOnLabels: i % 8 === 0,
      requiresQualityCertificate: i % 6 === 0,
      notes: chance(0.3)
        ? "Coordinar entregas con 48 h de anticipación."
        : null,
      contacts: JSON.stringify([
        {
          name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
          position: "Compras",
          phone: `+54 9 341 ${int(1000000, 9999999)}`,
          email: `compras@cli${pad(i + 1)}.example.com`,
          isPrimary: true,
        },
        {
          name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
          position: "Calidad",
          phone: `+54 9 341 ${int(1000000, 9999999)}`,
          email: `calidad@cli${pad(i + 1)}.example.com`,
          isPrimary: false,
        },
      ]),
    })),
  );

  const deliveryLocationByCustomer = new Map<number, number[]>();
  const scheduleRows: Row[] = [];
  const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

  for (const [i, customerId] of customerIds
    .slice(0, CUSTOMERS_WITH_DELIVERY)
    .entries()) {
    const locationRows = series(2, (k) => ({
      companyId,
      customerId,
      address: `${pick(STREETS)} ${int(100, 9800)} — Portón ${k + 1}, ${pick(CITIES)}`,
      schedule: "08:00 a 16:00",
      latitude: dec(-38.5, -31.2, 6),
      longitude: dec(-68.8, -57.9, 6),
      externalSystemCode: `EXT-${pad(i + 1)}-${k + 1}`,
      deliveryZoneId: pick(catalogs.deliveryZoneIds),
    }));
    deliveryLocationByCustomer.set(
      customerId,
      await insertMany(trx, "delivery_locations", locationRows),
    );
    scheduleRows.push({
      companyId,
      customerId,
      day: days[i % days.length] as string,
      from: "08:00",
      to: "16:00",
    });
  }
  await insertMany(trx, "delivery_schedules", scheduleRows);

  const productIds = await insertMany(
    trx,
    "products",
    combos(
      N.products,
      [
        "Caja",
        "Bandeja",
        "Display",
        "Separador",
        "Envase",
        "Plancha",
        "Estuche",
        "Contenedor",
      ],
      [
        "1 kg",
        "5 kg",
        "10 kg",
        "12 unidades",
        "24 unidades",
        "exportación",
        "mostrador",
        "granel",
        "retail",
      ],
    ).map((name, i) => {
      const approved = i % 4 !== 0;
      const cancelled = !approved && i % 8 === 0;
      return {
        companyId,
        code: `${P}-PROD-${pad(i + 1, 4)}`,
        clientCode: `CC-${pad(i + 1, 5)}`,
        description: `${name} — corrugado impreso`,
        customerId: customerIds[i % customerIds.length] as number,
        productTypeId: pick(catalogs.productTypeIds),
        boxTypeId: pick(catalogs.boxTypeIds),
        revision: i % 5,
        vip: i % 7 === 0,
        productApprovalAt: approved ? daysFrom(-int(5, 200)) : null,
        productApprovalBy: approved ? ACTOR : null,
        productCancellationAt: cancelled ? daysFrom(-int(1, 60)) : null,
        productCancellationBy: cancelled ? ACTOR : null,
      };
    }),
  );

  const productCustomer = new Map<number, number>();
  productIds.forEach((productId, i) => {
    productCustomer.set(
      productId,
      customerIds[i % customerIds.length] as number,
    );
  });

  return {
    customerIds,
    deliveryLocationByCustomer,
    productIds,
    productCustomer,
  };
}

// ---------------------------------------------------------------------------
// Production routes and their stages
// ---------------------------------------------------------------------------

type Production = { routeIds: number[]; stageIds: number[] };

async function seedProduction(
  trx: Knex,
  companyId: number,
  catalogs: Catalogs,
): Promise<Production> {
  const routeIds = await insertMany(
    trx,
    "production_routes",
    combos(
      N.catalog,
      ["Ruta", "Circuito", "Proceso", "Flujo", "Secuencia", "Línea"],
      [
        "corrugado + impresión",
        "corrugado + troquelado",
        "impresión + pegado",
        "plancha directa",
        "microcorrugado",
        "exportación",
        "muestra",
        "reproceso",
      ],
    ).map((name, i) => ({
      companyId,
      name: `${name} ${pad(i + 1, 2)}`,
      isGlobal: false,
      active: i % 11 !== 0,
      isDefault: i === 0,
    })),
  );

  const stageRows: Row[] = [];
  for (const routeId of routeIds) {
    const count = int(3, 5);
    for (let number = 1; number <= count; number++) {
      const isCorrugation = number === 1;
      stageRows.push({
        routeId,
        number,
        description: isCorrugation
          ? "Corrugado de plancha"
          : pick([
              "Impresión flexográfica",
              "Troquelado plano",
              "Pegado y cierre",
              "Encintado y estiba",
              "Control de calidad",
            ]),
        isCorrugation,
        setupTimeMinutes: dec(5, 60, 1),
        machineTypeId: pick(catalogs.machineTypeIds),
      });
    }
  }
  const stageIds = await insertMany(trx, "production_route_stages", stageRows);

  // One or two machines per stage, plus what it consumes and yields.
  const stageMachineRows: Row[] = [];
  const stageSupplyRows: Row[] = [];
  stageIds.forEach((stageId, i) => {
    const primary = catalogs.machineIds[
      i % catalogs.machineIds.length
    ] as number;
    stageMachineRows.push({ stageId, machineId: primary, isPrimary: true });
    const backup = catalogs.machineIds[
      (i + 7) % catalogs.machineIds.length
    ] as number;
    if (backup !== primary && chance(0.4)) {
      stageMachineRows.push({ stageId, machineId: backup, isPrimary: false });
    }

    stageSupplyRows.push({
      stageId,
      direction: "input",
      supplyType: "paper",
      supplyId: pick(catalogs.paperSupplyIds),
      quantity: dec(50, 900, 1),
      quantityType: "kg",
      repetitionsWidth: int(1, 3),
      repetitionsLength: 1,
      allowsSimilar: chance(0.5),
    });
    stageSupplyRows.push({
      stageId,
      direction: "output",
      supplyType: "sheet",
      supplyId: pick(catalogs.paperSheetIds),
      quantity: dec(100, 2500, 0),
      quantityType: "un",
      repetitionsWidth: 1,
      repetitionsLength: 1,
      allowsSimilar: false,
    });
    if (chance(0.5)) {
      stageSupplyRows.push({
        stageId,
        direction: "input",
        supplyType: "consumable",
        supplyId: pick(catalogs.consumableSupplyIds),
        quantity: dec(1, 40, 2),
        quantityType: "kg",
        repetitionsWidth: 1,
        repetitionsLength: 1,
        allowsSimilar: true,
        notes: "Consumo estimado por millar.",
      });
    }
  });
  await insertMany(trx, "production_route_stage_machines", stageMachineRows);
  await insertMany(trx, "production_route_stage_supplies", stageSupplyRows);

  return { routeIds, stageIds };
}

// ---------------------------------------------------------------------------
// Stock — the four warehouse screens
// ---------------------------------------------------------------------------

async function seedStock(trx: Knex, catalogs: Catalogs): Promise<void> {
  /** Location and warehouse always agree — a mismatch reads as a data bug. */
  const placement = (i: number): Row => {
    const warehouseId = catalogs.warehouseIds[
      i % WAREHOUSES_WITH_LOCATIONS
    ] as number;
    const locations = catalogs.locationsByWarehouse.get(warehouseId) ?? [];
    return {
      warehouseId,
      warehouseLocationId: locations.length > 0 ? pick(locations) : null,
      supplierId: pick(catalogs.supplierIds),
      manufacturerId: pick(catalogs.manufacturerIds),
      comments: chance(0.25) ? "Lote con observación de humedad." : null,
      price: dec(80, 2400, 2),
    };
  };

  await insertMany(
    trx,
    "paper_stock",
    series(N.stock, (i) => ({
      ...placement(i),
      paperSupplyId: catalogs.paperSupplyIds[
        i % catalogs.paperSupplyIds.length
      ] as number,
      weight: dec(180, 1600, 1),
      diameter: dec(80, 160, 1),
      width: dec(900, 2400, 0),
    })),
  );

  await insertMany(
    trx,
    "sheet_stock",
    series(N.stock, (i) => ({
      ...placement(i),
      paperSheetId: catalogs.paperSheetIds[
        i % catalogs.paperSheetIds.length
      ] as number,
      quantity: int(0, 4800),
    })),
  );

  await insertMany(
    trx,
    "tooling_stock",
    series(N.stock, (i) => ({
      ...placement(i),
      toolingId: catalogs.toolingIds[i % catalogs.toolingIds.length] as number,
      quantity: int(0, 24),
    })),
  );

  await insertMany(
    trx,
    "consumable_stock",
    series(N.stock, (i) => ({
      ...placement(i),
      consumableSupplyId: catalogs.consumableSupplyIds[
        i % catalogs.consumableSupplyIds.length
      ] as number,
      quantity: int(0, 900),
    })),
  );
}

// ---------------------------------------------------------------------------
// Parts (the engineering record) + finished goods
// ---------------------------------------------------------------------------

type Engineering = { partIds: number[] };

/** The four independent approval machines a part carries. */
const PART_MACHINES = ["dimensions", "technical", "sketch", "part"] as const;
type PartMachine = (typeof PART_MACHINES)[number];

async function seedEngineering(
  trx: Knex,
  companyId: number,
  catalogs: Catalogs,
  commercial: Commercial,
  production: Production,
): Promise<Engineering> {
  // Staggered so the Parts screen shows the whole approval vocabulary rather
  // than a column of "pendiente".
  const approvals = series(N.parts, (i): Record<PartMachine, Date | null> => {
    const dimensions = i % 3 !== 0 ? daysFrom(-int(10, 220)) : null;
    const technical = i % 4 !== 0 ? daysFrom(-int(10, 210)) : null;
    const sketch = i % 5 !== 0 ? daysFrom(-int(10, 200)) : null;
    const part =
      dimensions && technical && sketch && i % 6 !== 0
        ? daysFrom(-int(5, 190))
        : null;
    return { dimensions, technical, sketch, part };
  });

  const partIds = await insertMany(
    trx,
    "parts",
    series(N.parts, (i) => {
      const boxLength = dec(180, 800, 0);
      const boxWidth = dec(120, 600, 0);
      const boxHeight = dec(90, 500, 0);
      const approval = approvals[i] as Record<PartMachine, Date | null>;
      return {
        companyId,
        code: `${P}-PZA-${pad(i + 1, 4)}`,
        revision: i % 3,
        clientCode: `CP-${pad(i + 1, 5)}`,
        description: `Pieza técnica ${pad(i + 1, 4)} — desarrollo de caja`,
        boxLength,
        boxWidth,
        boxHeight,
        externalLength: boxLength + dec(4, 12, 1),
        externalWidth: boxWidth + dec(4, 12, 1),
        externalHeight: boxHeight + dec(4, 12, 1),
        sheetLength: dec(700, 2600, 0),
        sheetWidth: dec(500, 1600, 0),
        preferredWidth: dec(900, 2400, 0),
        flap: dec(30, 120, 0),
        lowerFlap: dec(30, 120, 0),
        upperFlap: dec(30, 120, 0),
        flapOverlap: dec(0, 40, 0),
        corrugationScoreLines: `${boxLength};${boxWidth};${boxLength};${boxWidth}`,
        printScoreLines: `${boxHeight};${dec(30, 120, 0)}`,
        symmetricScoreLines: chance(0.5),
        colorCount: int(0, 4),
        printSides: int(1, 2),
        inks: pick(["Negro", "Negro + Rojo", "CMYK", "Pantone 286 C"]),
        labelsPerPallet: int(1, 8),
        labelText: `Lote ${pad(i + 1, 4)} — ${COMPANY_NAME}`,
        printCode: chance(0.7),
        printDate: chance(0.6),
        printRecyclable: chance(0.5),
        printWarranty: chance(0.2),
        printLogo: chance(0.6),
        printNationalIndustry: chance(0.4),
        printExport: chance(0.25),
        compressionTest: dec(180, 900, 1),
        burstTest: dec(6, 22, 2),
        cobbTest: dec(20, 160, 1),
        ect: dec(3, 14, 2),
        grammage: dec(380, 1150, 1),
        lengthUpperTolerance: dec(1, 5, 1),
        lengthLowerTolerance: dec(1, 5, 1),
        widthUpperTolerance: dec(1, 5, 1),
        widthLowerTolerance: dec(1, 5, 1),
        overrunPercentage: dec(2, 10, 1),
        underrunPercentage: dec(2, 10, 1),
        corrugationOverproduction: dec(0, 6, 1),
        allowsRotation: chance(0.5),
        allowsPartialRotation: chance(0.3),
        mandatoryRotation: chance(0.1),
        boxSurface: dec(0.3, 3.4, 4),
        boxWeight: dec(0.2, 3.2, 3),
        averageWeight: dec(0.2, 3.2, 3),
        allowsGluing: chance(0.6),
        claspClosure: pick(["Sin cierre", "Pegado", "Grapado", "Cinta"]),
        associatedQuantity: int(100, 5000),
        foodSafetyNumber: chance(0.3) ? `BPM-${pad(i + 1, 5)}` : null,
        blueprintRef: `PL-${pad(i + 1, 5)}`,
        notes: chance(0.3) ? "Verificar troquel antes de programar." : null,
        quotingNotes: chance(0.2) ? "Precio sujeto a revisión de papel." : null,
        productId: commercial.productIds[
          i % commercial.productIds.length
        ] as number,
        corrugationId: pick(catalogs.corrugationIds),
        productionRouteId: production.routeIds[
          i % production.routeIds.length
        ] as number,
        palletizationId: pick(catalogs.palletizationIds),
        modelId: pick(catalogs.modelIds),
        flapTypeId: pick(catalogs.flapTypeIds),
        glueTypeId: pick(catalogs.glueTypeIds),
        strappingTypeId: pick(catalogs.strappingTypeIds),
        traceTypeId: pick(catalogs.traceTypeIds),
        complementId: chance(0.4) ? pick(catalogs.complementIds) : null,
        dimensionsApprovalAt: approval.dimensions,
        dimensionsApprovalBy: approval.dimensions ? ACTOR : null,
        technicalApprovalAt: approval.technical,
        technicalApprovalBy: approval.technical ? ACTOR : null,
        sketchApprovalAt: approval.sketch,
        sketchApprovalBy: approval.sketch ? ACTOR : null,
        partApprovalAt: approval.part,
        partApprovalBy: approval.part ? ACTOR : null,
        createdBy: ACTOR,
        registeredAt: daysFrom(-int(20, 300)),
      };
    }),
  );

  // The trail those four machines would have written.
  const eventRows: Row[] = [];
  partIds.forEach((partId, i) => {
    const approval = approvals[i];
    if (!approval) return;
    for (const machine of PART_MACHINES) {
      const at = approval[machine];
      if (!at) continue;
      eventRows.push({
        partId,
        stateMachine: machine,
        action: "approve",
        performedBy: ACTOR,
        performedAt: at,
      });
    }
  });
  await insertMany(trx, "part_approval_events", eventRows);

  await insertMany(
    trx,
    "finished_goods",
    combos(
      N.catalog,
      [
        "Producto terminado",
        "Semielaborado",
        "Bulto",
        "Pallet armado",
        "Caja armada",
        "Bandeja armada",
      ],
      ["A", "B", "C", "D", "E", "F", "G", "H"],
    ).map((name, i) => ({
      companyId,
      code: `${P}-PTE-${pad(i + 1)}`,
      name,
      description: `${name} listo para despacho`,
      supplierId: pick(catalogs.supplierIds),
      manufacturerId: pick(catalogs.manufacturerIds),
      partId: partIds[i % partIds.length] as number,
      stageId: production.stageIds[i % production.stageIds.length] as number,
      minimumStock: int(20, 600),
    })),
  );

  return { partIds };
}

// ---------------------------------------------------------------------------
// Sales orders and production orders
// ---------------------------------------------------------------------------

async function seedOrders(
  trx: Knex,
  companyId: number,
  people: People,
  catalogs: Catalogs,
  commercial: Commercial,
  production: Production,
  engineering: Engineering,
): Promise<void> {
  /** A pedido references exactly one subject — `num_nonnulls(...) = 1`. */
  const subjectOf = (i: number): Row => {
    if (i % 7 === 0) {
      return {
        productId: null,
        partId: engineering.partIds[i % engineering.partIds.length] as number,
        sheetSupplyId: null,
      };
    }
    if (i % 11 === 0) {
      return {
        productId: null,
        partId: null,
        sheetSupplyId: catalogs.paperSheetIds[
          i % catalogs.paperSheetIds.length
        ] as number,
      };
    }
    return {
      productId: commercial.productIds[
        i % commercial.productIds.length
      ] as number,
      partId: null,
      sheetSupplyId: null,
    };
  };

  const salesRows = series(N.salesOrders, (i) => {
    const commercialApproved = i % 3 !== 0;
    const financialApproved = commercialApproved && i % 4 !== 0;
    const fulfilled = commercialApproved && financialApproved && i % 5 === 0;
    const voided = !commercialApproved && i % 9 === 0;
    return {
      companyId,
      number: pad(i + 1, 8),
      quantity: int(500, 90000),
      price: dec(120, 9800, 2),
      paid: chance(0.4) ? dec(0, 4000, 2) : null,
      deliveryDate: daysFrom(int(-30, 60)),
      purchaseOrder: `OC-${pad(i + 1, 6)}`,
      stockOrder: i % 8 === 0,
      specialOrder: i % 13 === 0,
      needsAdvanceInvoice: chance(0.2),
      invoiceSent: chance(0.4),
      salesSector: pick(["Interior", "AMBA", "Exportación", "Cuenta clave"]),
      balancePercentage: dec(0, 100, 1),
      supplierCode: `PRV-${pad(i + 1, 4)}`,
      createdBy: ACTOR,
      customerId: commercial.customerIds[
        i % commercial.customerIds.length
      ] as number,
      salesUserId:
        people.salesUserIds.length > 0 ? pick(people.salesUserIds) : null,
      ...subjectOf(i),
      commercialApprovedAt: commercialApproved ? daysFrom(-int(2, 120)) : null,
      commercialApprovedBy: commercialApproved ? ACTOR : null,
      financialApprovedAt: financialApproved ? daysFrom(-int(1, 110)) : null,
      financialApprovedBy: financialApproved ? ACTOR : null,
      fulfilledAt: fulfilled ? daysFrom(-int(1, 40)) : null,
      fulfilledBy: fulfilled ? ACTOR : null,
      voidedAt: voided ? daysFrom(-int(1, 30)) : null,
      voidedBy: voided ? ACTOR : null,
      creditLimitOverrideAt: i % 17 === 0 ? daysFrom(-int(1, 60)) : null,
      creditLimitOverrideBy: i % 17 === 0 ? ACTOR : null,
    };
  });

  const deliveryFor = (customerId: number): number | null => {
    const locations = commercial.deliveryLocationByCustomer.get(customerId);
    return locations && locations.length > 0 ? pick(locations) : null;
  };

  // Each pedido owns its own DatosPedido row — the FK is UNIQUE.
  const orderDataIds = await insertMany(
    trx,
    "order_data",
    salesRows.map((row, i) => ({
      companyId,
      number: pad(i + 1, 8),
      quantity: row.quantity,
      notes: chance(0.3) ? "Entregar en horario de mañana." : null,
      dispatchNotes: chance(0.2) ? "Requiere remito por duplicado." : null,
      customerId: row.customerId,
      deliveryLocationId: deliveryFor(row.customerId),
    })),
  );

  const salesOrderIds = await insertMany(
    trx,
    "sales_orders",
    salesRows.map((row, i) => ({ ...row, orderDataId: orderDataIds[i] })),
  );

  const salesEvents: Row[] = [];
  salesRows.forEach((row, i) => {
    const salesOrderId = salesOrderIds[i];
    if (salesOrderId === undefined) return;
    if (row.commercialApprovedAt) {
      salesEvents.push({
        salesOrderId,
        stateMachine: "commercial",
        action: "approve",
        performedBy: ACTOR,
        performedAt: row.commercialApprovedAt,
      });
    }
    if (row.financialApprovedAt) {
      salesEvents.push({
        salesOrderId,
        stateMachine: "financial",
        action: "approve",
        performedBy: ACTOR,
        performedAt: row.financialApprovedAt,
      });
    }
  });
  await insertMany(trx, "sales_order_approval_events", salesEvents);

  // Production orders, spread across scheduled / completed / voided / pending.
  const poOrderDataIds = await insertMany(
    trx,
    "order_data",
    series(N.productionOrders, (i) => {
      const customerId = commercial.customerIds[
        i % commercial.customerIds.length
      ] as number;
      return {
        companyId,
        number: `OP-${pad(i + 1, 6)}`,
        quantity: int(500, 60000),
        customerId,
        deliveryLocationId: deliveryFor(customerId),
      };
    }),
  );

  await insertMany(
    trx,
    "production_orders",
    series(N.productionOrders, (i) => {
      const scheduled = i % 3 !== 0;
      const completed = scheduled && i % 4 === 0;
      const voided = !scheduled && i % 7 === 0;
      return {
        companyId,
        number: pad(i + 1, 8),
        orderDate: daysFrom(-int(1, 150)),
        quantity: int(500, 60000),
        deliveryDate: daysFrom(int(-20, 75)),
        notes: chance(0.25) ? "Programar en turno noche." : null,
        newPlate: i % 6 === 0,
        newPlateReady: i % 12 === 0,
        newDie: i % 9 === 0,
        newDieReady: i % 18 === 0,
        isSample: i % 15 === 0,
        dispatchable: i % 2 === 0,
        lastLabelNumber: completed ? int(1, 900) : null,
        compression: completed ? dec(180, 900, 1) : null,
        burst: completed ? dec(6, 22, 2) : null,
        cobb: completed ? dec(20, 160, 1) : null,
        avgGrammage: completed ? dec(380, 1150, 1) : null,
        avgWeight: completed ? dec(0.2, 3.2, 3) : null,
        schedulingApprovedAt: scheduled ? daysFrom(-int(1, 120)) : null,
        schedulingApprovedByUser: scheduled ? ACTOR : null,
        completedAt: completed ? daysFrom(-int(1, 60)) : null,
        completedByUser: completed ? ACTOR : null,
        voidedAt: voided ? daysFrom(-int(1, 40)) : null,
        voidedByUser: voided ? ACTOR : null,
        createdByUser: ACTOR,
        partId: engineering.partIds[i % engineering.partIds.length] as number,
        orderDataId: poOrderDataIds[i] as number,
        routeId: production.routeIds[i % production.routeIds.length] as number,
        palletizationId: pick(catalogs.palletizationIds),
      };
    }),
  );

  // Park the shared counters past the seeded numbers, so the next order created
  // through the UI does not collide with one of these (unique companyId+number).
  await trx("code_sequences").insert([
    {
      companyId,
      scope: "sales-order",
      parentKey: "",
      lastValue: N.salesOrders,
    },
    {
      companyId,
      scope: "production-order",
      parentKey: "",
      lastValue: N.productionOrders,
    },
  ]);
}
