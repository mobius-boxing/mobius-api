import type { Knex } from "knex";

/**
 * Sprint 1.7 — delivery zones, locations, schedules as REAL TABLES
 * (decision Q-03-14 / §L.6; entity shapes from module 16 §7-8).
 *
 * English table names per Mobius convention (the spec's proposed Spanish
 * names zonas_entrega/lugares_de_entrega map 1:1):
 *  - delivery_zones      ← ZonasEntrega {Codigo, Descripcion}
 *  - delivery_locations  ← LugaresDeEntrega {Domicilio, Horario, Latitud,
 *                          Longitud, CodigoSistemaAdministrativo,
 *                          ZonaEntrega_Id (NULLABLE — §L.6: required at
 *                          form/API validation, nullable in DB for ETL),
 *                          Cliente_Id NOT NULL}
 *  - delivery_schedules  ← HorariosEntrega (per-customer weekday windows —
 *                          current Mobius jsonb shape {day, from, to})
 *
 * Backfills the legacy customers.deliveryLocations/deliveryDays jsonb into
 * rows (zones auto-created from the distinct legacy zone strings per company),
 * then drops both jsonb columns.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("delivery_zones", function (table) {
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
    table.string("code", 400);
    table.text("description");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.unique(["companyId", "code"]);
    table.index(["companyId"]);
  });

  await knex.schema.createTable("delivery_locations", function (table) {
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
    table
      .integer("customerId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("customers")
      .onDelete("CASCADE");
    table.text("address");
    // Free-text hours (Procusto Horario) — distinct from delivery_schedules.
    table.text("schedule");
    table.decimal("latitude", 10, 7);
    table.decimal("longitude", 10, 7);
    table.string("externalSystemCode", 400);
    table
      .integer("deliveryZoneId")
      .unsigned()
      .references("id")
      .inTable("delivery_zones")
      .onDelete("SET NULL");
    table.integer("legacyId");
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.index(["companyId"]);
    table.index(["customerId"]);
    table.index(["deliveryZoneId"]);
    table.index(["legacyId"]);
  });

  await knex.schema.createTable("delivery_schedules", function (table) {
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
    table
      .integer("customerId")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("customers")
      .onDelete("CASCADE");
    table.string("day", 20).notNullable();
    table.string("from", 20);
    table.string("to", 20);
    table.timestamp("createdAt", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updatedAt", { useTz: true }).defaultTo(knex.fn.now());

    table.index(["companyId"]);
    table.index(["customerId"]);
  });

  // ── Backfill from the legacy jsonb ──────────────────────────────────────
  const customers = await knex("customers").select(
    "id",
    "companyId",
    "deliveryLocations",
    "deliveryDays",
  );

  const zoneIdByKey = new Map<string, number>();
  const resolveZone = async (
    companyId: number,
    zoneName: string,
  ): Promise<number> => {
    const key = `${companyId}::${zoneName}`;
    const cached = zoneIdByKey.get(key);
    if (cached) return cached;
    const [zone] = await knex("delivery_zones")
      .insert({ companyId, code: zoneName, description: zoneName })
      .onConflict(["companyId", "code"])
      .merge({ updatedAt: knex.fn.now() })
      .returning("id");
    const zoneId = (zone as any).id ?? zone;
    zoneIdByKey.set(key, zoneId);
    return zoneId;
  };

  const parse = (value: any): any[] => {
    if (!value) return [];
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  };

  for (const customer of customers) {
    if (!customer.companyId) continue;

    for (const loc of parse(customer.deliveryLocations)) {
      const zoneName =
        typeof loc?.deliveryZone === "string" && loc.deliveryZone.trim()
          ? loc.deliveryZone.trim()
          : null;
      await knex("delivery_locations").insert({
        companyId: customer.companyId,
        customerId: customer.id,
        address: loc?.address ?? null,
        schedule: loc?.availableTimes ?? null,
        latitude: loc?.lat ? parseFloat(loc.lat) || null : null,
        longitude: loc?.lon ? parseFloat(loc.lon) || null : null,
        externalSystemCode: loc?.code ?? null,
        deliveryZoneId: zoneName
          ? await resolveZone(customer.companyId, zoneName)
          : null,
      });
    }

    for (const day of parse(customer.deliveryDays)) {
      if (!day?.day) continue;
      await knex("delivery_schedules").insert({
        companyId: customer.companyId,
        customerId: customer.id,
        day: String(day.day),
        from: day?.from ?? null,
        to: day?.to ?? null,
      });
    }
  }

  await knex.schema.alterTable("customers", function (table) {
    table.dropColumn("deliveryLocations");
    table.dropColumn("deliveryDays");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("customers", function (table) {
    table.jsonb("deliveryLocations");
    table.jsonb("deliveryDays");
  });

  await knex.raw(`
    UPDATE customers c
       SET "deliveryLocations" = COALESCE(sub.arr, '[]'::jsonb)
      FROM (
        SELECT dl."customerId",
               jsonb_agg(jsonb_build_object(
                 'code', dl."externalSystemCode",
                 'address', dl.address,
                 'availableTimes', dl.schedule,
                 'lat', dl.latitude::text,
                 'lon', dl.longitude::text,
                 'deliveryZone', dz.code
               )) AS arr
          FROM delivery_locations dl
          LEFT JOIN delivery_zones dz ON dz.id = dl."deliveryZoneId"
         GROUP BY dl."customerId"
      ) sub
     WHERE sub."customerId" = c.id
  `);
  await knex.raw(`
    UPDATE customers c
       SET "deliveryDays" = COALESCE(sub.arr, '[]'::jsonb)
      FROM (
        SELECT ds."customerId",
               jsonb_agg(jsonb_build_object('day', ds.day, 'from', ds."from", 'to', ds."to")) AS arr
          FROM delivery_schedules ds
         GROUP BY ds."customerId"
      ) sub
     WHERE sub."customerId" = c.id
  `);

  await knex.schema.dropTableIfExists("delivery_schedules");
  await knex.schema.dropTableIfExists("delivery_locations");
  await knex.schema.dropTableIfExists("delivery_zones");
}
