import type { Knex } from "knex";

/**
 * RBAC grid — roles / permissions / role_permissions + users.roleId, replacing
 * the 3-value users.role enum with Procusto's data-driven Perfil × Permiso grid.
 * Spec: specs/replication/modules/02-identity-and-rbac/ (01-entities.md,
 * 07-mobius-mapping.md — Model B: catalogue cloned per company).
 *
 * users.role (enum) is kept transitionally — dual-read during cutover (08-migration-notes).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("roles", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.string("name", 200).notNullable();
    // {director, general, productionManager, qualityManager, salesperson} — text,
    // no DB enum (cross-cutting §B.4).
    table.string("profileType", 50).notNullable().defaultTo("general");
    table.boolean("hasAccessToAllMachines").notNullable().defaultTo(true);
    // The seeded Admin role: cannot be deleted or stripped in the editor.
    table.boolean("isProtected").notNullable().defaultTo(false);
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "name"]);
    table.index(["companyId"]);
  });

  await knex.schema.createTable("permissions", function (table) {
    table.increments("id").primary();
    table
      .uuid("uuid")
      .unique()
      .notNullable()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    // Stable machine gate key; read-only variants end in ".readonly" (D3/D4).
    table.string("code", 200).notNullable();
    // Legacy Spanish Nombre — Procusto's gate key, kept for ETL matching.
    table.string("name", 300).notNullable();
    table.text("description");
    table.boolean("readOnly").notNullable().defaultTo(false);
    table.text("associatedForms");
    table.string("area", 50);
    table.boolean("deprecated").notNullable().defaultTo(false);
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "code"]);
    // Procusto identity: (Nombre, SoloLectura) — preserved for migration integrity.
    table.unique(["companyId", "name", "readOnly"]);
    table.index(["companyId"]);
  });

  await knex.schema.createTable("role_permissions", function (table) {
    table
      .integer("roleId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("roles")
      .onDelete("CASCADE");
    table
      .integer("permissionId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("permissions")
      .onDelete("CASCADE");
    table
      .integer("companyId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("companies")
      .onDelete("CASCADE");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());

    table.primary(["roleId", "permissionId"]);
    table.index(["companyId"]);
    table.index(["permissionId"]);
  });

  await knex.schema.alterTable("users", function (table) {
    table
      .integer("roleId")
      .unsigned()
      .references("id")
      .inTable("roles")
      .onDelete("SET NULL");
    table.string("username", 200);
    table
      .integer("managerId")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", function (table) {
    table.dropColumn("roleId");
    table.dropColumn("username");
    table.dropColumn("managerId");
  });
  await knex.schema.dropTableIfExists("role_permissions");
  await knex.schema.dropTableIfExists("permissions");
  await knex.schema.dropTableIfExists("roles");
}
