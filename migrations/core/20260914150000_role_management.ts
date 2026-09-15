import type { Knex } from "knex";

/**
 * System roles + a pruned permission catalogue. Roll-forward only (L-003),
 * idempotent — every insert is onConflict-ignore and every update/delete is
 * scoped to rows that still need it, so re-running does nothing on a second
 * pass.
 *
 * The catalogue snapshot and the 15 Procusto starter-role names below are
 * FROZEN copies, not imports of `src/common/constants/permissions-catalog.ts`
 * — that file changes independently over time (it is rewritten by this same
 * change, in fact), and a migration must keep producing the same result on
 * every future run regardless of what the source constants look like later
 * (existing precedent: `20260902000001_seed_audit_permissions.ts` imports
 * live constants because it only ADDS two codes; this migration PRUNES, so
 * it cannot).
 *
 * Steps:
 *  1. `roles.systemKey` + CHECK + UNIQUE(companyId, systemKey);
 *     `invitations.roleId` + FK + index.
 *  2. Per company: seed the pruned catalogue, stamp `systemKey='admin'` on the
 *     protected Admin role and grant it every RW code, create Member with the
 *     baseline grants.
 *  3. Backfill `users.roleId` where null (companyId not null): admin -> Admin,
 *     member -> Member. Enum admins on any other role move to Admin, and the
 *     `users.role` mirror is made to agree with the Admin role.
 *  4. Move each Procusto starter role's users + invitations to Member, then
 *     delete the role. Every remaining custom role gets Member's baseline.
 *  5. Prune permission rows outside the new catalogue (cascades role_permissions).
 *  6. Backfill `invitations.roleId` for pending invitations.
 */

type FrozenConcept = {
  code: string;
  name: string;
  area: string;
  /** Whether a `<code>.readonly` sibling row is also seeded. */
  readonly: boolean;
};

/** The post-prune catalogue — codes + readonly flags, frozen (see header). */
const CATALOGUE: FrozenConcept[] = [
  {
    code: "box-types.edit",
    name: "Tipos de cajas",
    area: "masters",
    readonly: true,
  },
  { code: "colors.edit", name: "Colores", area: "masters", readonly: true },
  {
    code: "color-types.edit",
    name: "Tipos de color",
    area: "masters",
    readonly: true,
  },
  {
    code: "complements.edit",
    name: "Complementos",
    area: "masters",
    readonly: true,
  },
  {
    code: "corrugated.edit",
    name: "Corrugados",
    area: "masters",
    readonly: true,
  },
  {
    code: "corrugated.classes",
    name: "Clases de corrugados",
    area: "masters",
    readonly: true,
  },
  { code: "customers.edit", name: "Clientes", area: "masters", readonly: true },
  {
    code: "customer-categories.edit",
    name: "Categorias de clientes",
    area: "sales-plus",
    readonly: true,
  },
  {
    code: "delivery-zones.edit",
    name: "Zonas de entrega",
    area: "masters",
    readonly: true,
  },
  {
    code: "flap-types.edit",
    name: "Tipos de aletas",
    area: "masters",
    readonly: true,
  },
  {
    code: "flute-types.edit",
    name: "Tipos de onda",
    area: "masters",
    readonly: true,
  },
  {
    code: "fsc-types.edit",
    name: "Tipos de FSC",
    area: "masters",
    readonly: true,
  },
  {
    code: "glue-types.edit",
    name: "Tipos de plegado",
    area: "masters",
    readonly: true,
  },
  {
    code: "manufacturers.edit",
    name: "Fabricantes",
    area: "masters",
    readonly: true,
  },
  {
    code: "paper.classes",
    name: "Clases de papeles",
    area: "masters",
    readonly: true,
  },
  {
    code: "paper-types.edit",
    name: "Tipos de papeles",
    area: "masters",
    readonly: true,
  },
  { code: "papers.edit", name: "Papeles", area: "masters", readonly: true },
  { code: "supplies.edit", name: "Insumos", area: "masters", readonly: true },
  {
    code: "product-types.edit",
    name: "Tipos de productos",
    area: "masters",
    readonly: true,
  },
  { code: "products.edit", name: "Productos", area: "masters", readonly: true },
  {
    code: "products.delete",
    name: "ProductosForm - Borrar",
    area: "actions",
    readonly: false,
  },
  {
    code: "score-types.edit",
    name: "Tipos de trazados",
    area: "masters",
    readonly: true,
  },
  {
    code: "strapping-types.edit",
    name: "Tipos de zunchado",
    area: "masters",
    readonly: true,
  },
  {
    code: "suppliers.edit",
    name: "Proveedores",
    area: "masters",
    readonly: true,
  },
  {
    code: "tooling-types.edit",
    name: "Tipos de herramentales",
    area: "masters",
    readonly: true,
  },
  {
    code: "consumable-types.edit",
    name: "Tipos de consumibles",
    area: "masters",
    readonly: true,
  },
  { code: "machines.edit", name: "Maquinas", area: "masters", readonly: true },
  {
    code: "models.edit",
    name: "Modelos de cajas",
    area: "masters",
    readonly: true,
  },
  {
    code: "palletizing.edit",
    name: "Palletizados",
    area: "masters",
    readonly: true,
  },
  { code: "parts.edit", name: "Partes", area: "masters", readonly: true },
  {
    code: "routes.edit",
    name: "Rutas de produccion",
    area: "masters",
    readonly: true,
  },
  {
    code: "routes.delete",
    name: "RutasProduccionForm - Borrar",
    area: "actions",
    readonly: false,
  },
  {
    code: "production-orders.edit",
    name: "Ordenes de produccion",
    area: "masters",
    readonly: false,
  },
  {
    code: "production-orders.generate",
    name: "Generar órdenes de producción",
    area: "actions",
    readonly: false,
  },
  { code: "roles.edit", name: "Perfiles", area: "masters", readonly: true },
  { code: "users.edit", name: "Usuarios", area: "masters", readonly: true },
  { code: "orders.edit", name: "Pedidos", area: "sales-plus", readonly: false },
  {
    code: "orders.delete",
    name: "PedidosForm - Borrar",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.approve.commercial",
    name: "PedidosForm - Aprobacion comercial",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.approve.financial",
    name: "PedidosForm - Aprobacion financiera",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.manual-fulfillment",
    name: "PedidosForm - Cumplimiento manual",
    area: "actions",
    readonly: false,
  },
  {
    code: "products.approve.technical",
    name: "ProductoForm - Aprobacion tecnica",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.edit-prices",
    name: "PCPlus-Editar precios",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.view-sales-sector",
    name: "PedidosForm - Sector de ventas",
    area: "actions",
    readonly: false,
  },
  {
    code: "orders.edit-delivery-date",
    name: "PedidoForm - Edicion fecha de entrega",
    area: "actions",
    readonly: false,
  },
  {
    code: "finished-goods.edit",
    name: "Finished goods",
    area: "masters",
    readonly: true,
  },
  {
    code: "paper-stock.edit",
    name: "Paper stock",
    area: "masters",
    readonly: true,
  },
  {
    code: "sheet-stock.edit",
    name: "Sheet stock",
    area: "masters",
    readonly: true,
  },
  { code: "tooling.edit", name: "Tooling", area: "masters", readonly: true },
  {
    code: "warehouses.edit",
    name: "Warehouses",
    area: "masters",
    readonly: true,
  },
  {
    code: "consumable-supplies.edit",
    name: "Consumable supplies",
    area: "masters",
    readonly: true,
  },
  {
    code: "consumable-stock.edit",
    name: "Consumable stock",
    area: "masters",
    readonly: true,
  },
  {
    code: "tooling-stock.edit",
    name: "Tooling stock",
    area: "masters",
    readonly: true,
  },
  { code: "settings.edit", name: "Settings", area: "actions", readonly: false },
  { code: "files.manage", name: "Files", area: "actions", readonly: false },
  {
    code: "parts.approve.dimensions",
    name: "Partes - Aprobación de medidas",
    area: "actions",
    readonly: false,
  },
  {
    code: "parts.approve.technical",
    name: "Partes - Aprobación técnica",
    area: "actions",
    readonly: false,
  },
  {
    code: "parts.approve.sketch",
    name: "Partes - Aprobación de boceto",
    area: "actions",
    readonly: false,
  },
  {
    code: "parts.approve.part",
    name: "Partes - Aprobación de parte",
    area: "actions",
    readonly: false,
  },
  {
    code: "parts.approve.bulk",
    name: "Partes - Aprobación masiva",
    area: "actions",
    readonly: false,
  },
  {
    code: "countdown.manage",
    name: "Countdown - Administración",
    area: "actions",
    readonly: false,
  },
  {
    code: "node-files.manage",
    name: "Node Files - Administración",
    area: "actions",
    readonly: false,
  },
  {
    code: "audit.read",
    name: "Auditoría — ver",
    area: "queries",
    readonly: true,
  },
  {
    code: "audit.export",
    name: "Auditoría — exportar",
    area: "queries",
    readonly: false,
  },
  {
    code: "devices.approve",
    name: "Dispositivos - Aprobación",
    area: "actions",
    readonly: false,
  },
];

/** All permission codes the catalogue seeds, RW + readonly siblings. */
const ALL_CODES: string[] = CATALOGUE.flatMap((c) =>
  c.readonly ? [c.code, `${c.code}.readonly`] : [c.code],
);
const RW_CODES: string[] = CATALOGUE.map((c) => c.code);

const MEMBER_BASELINE_CODES: string[] = [
  "consumable-types.edit",
  "consumable-supplies.edit",
  "consumable-stock.edit",
  "tooling-stock.edit",
  "customers.edit.readonly",
  "customer-categories.edit.readonly",
];

/** The 15 live Procusto profiles (frozen — see permissions-catalog.ts history). */
const PROCUSTO_STARTER_ROLE_NAMES: string[] = [
  "ADMINISTRADOR DE STOCK",
  "CONTABILIDAD",
  "CONTROL DE CALIDAD",
  "CORRUGADORA",
  "DESPACHO",
  "FACTURACION",
  "GERENTE DE VENTAS",
  "IMPRESORA",
  "PLANIFICACION",
  "PRESIDENCIA",
  "VENTAS",
  "RESPONSABLE DE PRODUCCION",
  "RESPONSABLE DE CALIDAD",
  "VENDEDOR",
  "prueba",
];

const ADMIN_ROLE_NAME = "Admin";
const MEMBER_ROLE_NAME = "Member";

export async function up(knex: Knex): Promise<void> {
  // 1. Schema.
  const hasSystemKey = await knex.schema.hasColumn("roles", "systemKey");
  if (!hasSystemKey) {
    await knex.schema.alterTable("roles", (table) => {
      table.string("systemKey", 20);
    });
    await knex.raw(
      `ALTER TABLE "roles" ADD CONSTRAINT "roles_systemkey_check"
         CHECK ("systemKey" IN ('admin', 'member'))`,
    );
    await knex.schema.alterTable("roles", (table) => {
      table.unique(["companyId", "systemKey"], {
        indexName: "roles_companyid_systemkey_unique",
      });
    });
  }

  const hasRoleId = await knex.schema.hasColumn("invitations", "roleId");
  if (!hasRoleId) {
    await knex.schema.alterTable("invitations", (table) => {
      table
        .integer("roleId")
        .unsigned()
        .references("id")
        .inTable("roles")
        .onDelete("RESTRICT");
      table.index(["roleId"]);
    });
  }

  const companies: Array<{ id: number }> = await knex("companies").select("id");

  for (const company of companies) {
    const companyId = company.id;

    // 2a. Catalogue rows.
    const permissionRows: any[] = [];
    for (const concept of CATALOGUE) {
      permissionRows.push({
        companyId,
        code: concept.code,
        name: concept.name,
        readOnly: false,
        area: concept.area,
        deprecated: false,
      });
      if (concept.readonly) {
        permissionRows.push({
          companyId,
          code: `${concept.code}.readonly`,
          name: concept.name,
          readOnly: true,
          area: concept.area,
          deprecated: false,
        });
      }
    }
    await knex("permissions")
      .insert(permissionRows)
      .onConflict(["companyId", "code"])
      .ignore();

    // 2b. Admin: stamp systemKey on the existing protected row (or create one
    // for a company that somehow has none), grant every RW code in CATALOGUE.
    let adminRole = await knex("roles")
      .where({ companyId, isProtected: true })
      .first();
    if (!adminRole) {
      await knex("roles")
        .insert({
          companyId,
          name: ADMIN_ROLE_NAME,
          systemKey: "admin",
          profileType: "general",
          hasAccessToAllMachines: true,
          isProtected: true,
        })
        .onConflict(["companyId", "name"])
        .ignore();
      adminRole = await knex("roles")
        .where({ companyId, name: ADMIN_ROLE_NAME })
        .first();
    } else if (!adminRole.systemKey) {
      await knex("roles")
        .where({ id: adminRole.id })
        .update({ systemKey: "admin" });
    }

    if (adminRole) {
      const rwPermissionRows = await knex("permissions")
        .where({ companyId, readOnly: false })
        .whereIn("code", RW_CODES)
        .select("id");
      if (rwPermissionRows.length) {
        await knex("role_permissions")
          .insert(
            rwPermissionRows.map((p: any) => ({
              roleId: adminRole.id,
              permissionId: p.id,
              companyId,
            })),
          )
          .onConflict(["roleId", "permissionId"])
          .ignore();
      }
    }

    // 2c. Member — baseline grants only.
    await knex("roles")
      .insert({
        companyId,
        name: MEMBER_ROLE_NAME,
        systemKey: "member",
        profileType: "general",
        hasAccessToAllMachines: true,
        isProtected: false,
      })
      .onConflict(["companyId", "name"])
      .ignore();
    const memberRole = await knex("roles")
      .where({ companyId, name: MEMBER_ROLE_NAME })
      .first();
    if (memberRole) {
      const baselineRows = await knex("permissions")
        .where({ companyId })
        .whereIn("code", MEMBER_BASELINE_CODES)
        .select("id");
      if (baselineRows.length) {
        await knex("role_permissions")
          .insert(
            baselineRows.map((p: any) => ({
              roleId: memberRole.id,
              permissionId: p.id,
              companyId,
            })),
          )
          .onConflict(["roleId", "permissionId"])
          .ignore();
      }
    }

    if (!adminRole || !memberRole) continue;

    // 3. Backfill users.roleId (company users only).
    await knex("users")
      .where({ companyId, role: "admin" })
      .whereNull("roleId")
      .update({ roleId: adminRole.id });
    await knex("users")
      .where({ companyId, role: "member" })
      .whereNull("roleId")
      .update({ roleId: memberRole.id });
    // An enum admin on a custom role got its authority from the enum, which no
    // longer gates any route; leaving it there would strip its access.
    await knex("users")
      .where({ companyId, role: "admin" })
      .whereNot("roleId", adminRole.id)
      .update({ roleId: adminRole.id });
    await knex("users")
      .where({ companyId, roleId: adminRole.id })
      .where("role", "member")
      .update({ role: "admin" });

    // 4. Move each Procusto starter role's users/invitations to Member,
    // then delete the (now empty) role.
    const starterRoles = await knex("roles")
      .where({ companyId, isProtected: false })
      .whereNull("systemKey")
      .whereIn("name", PROCUSTO_STARTER_ROLE_NAMES)
      .select("id");
    for (const starter of starterRoles) {
      await knex("users")
        .where({ companyId, roleId: starter.id })
        .update({ roleId: memberRole.id, role: "member" });
      await knex("invitations")
        .where({ companyId, roleId: starter.id })
        .update({ roleId: memberRole.id });
      await knex("roles").where({ id: starter.id }).delete();
    }

    // Custom roles predate permission-gated routes: their users reached the
    // login-only routes that Member's baseline now covers.
    const customRoles = await knex("roles")
      .where({ companyId, isProtected: false })
      .whereNull("systemKey")
      .select("id");
    const baselinePermissions = await knex("permissions")
      .where({ companyId })
      .whereIn("code", MEMBER_BASELINE_CODES)
      .select("id");
    for (const role of customRoles) {
      if (!baselinePermissions.length) break;
      await knex("role_permissions")
        .insert(
          baselinePermissions.map((p: any) => ({
            roleId: role.id,
            permissionId: p.id,
            companyId,
          })),
        )
        .onConflict(["roleId", "permissionId"])
        .ignore();
    }

    // 5. Prune permission rows outside the new catalogue (cascades role_permissions).
    await knex("permissions")
      .where({ companyId })
      .whereNotIn("code", ALL_CODES)
      .delete();

    // 6. Backfill invitations.roleId for pending invitations.
    await knex("invitations")
      .where({ companyId, role: "admin", isUsed: false })
      .whereNull("roleId")
      .update({ roleId: adminRole.id });
    await knex("invitations")
      .where({ companyId, role: "member", isUsed: false })
      .whereNull("roleId")
      .update({ roleId: memberRole.id });
  }
}

export async function down(): Promise<void> {
  throw new Error(
    "role-management migration is roll-forward only (L-003) — starter-role " +
      "deletion and permission pruning are not reversible. Fix forward.",
  );
}
