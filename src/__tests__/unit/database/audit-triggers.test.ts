/**
 * AC-3 / AC-4 / AC-11 — the generated audit DDL and trigger SQL.
 *
 * T2 is inert: nothing calls this library until the migration (T4) does, and no
 * unit test can prove a trigger fires. What *can* be proved here is the text —
 * and the text is where three production-shaped mistakes live:
 *
 * - a bare `?` (knex reads it as a binding placeholder and the migration dies
 *   with "Expected 0 bindings, saw 1" — §0 rule 6);
 * - a positional `TG_ARGV` in the wrong slot (the trigger then looks up the
 *   wrong parent, silently, on every write of that table);
 * - a redaction rule that stops being emitted (a secret reaches the ledger).
 *
 * Everything else about the trigger — that it fires, that the diff is right,
 * that `company_id` is picked up — needs a real database and belongs to T5.
 */
import { describe, it, expect } from "@jest/globals";
import type { Knex } from "knex";
import { AUDIT_PARENT, AUDIT_REDACT } from "../../../database/audit-coverage";
import {
  attachAudit,
  auditPartitionSpecs,
  AUDIT_FUNCTION_SQL,
  createAuditLogsV2,
  detachAudit,
  ensureAuditPartitions,
  PROTECTION_FUNCTION_SQL,
} from "../../../database/audit-triggers";

/** Records the SQL a helper issues, without a connection. */
function stubKnex(): { knex: Knex; calls: string[] } {
  const calls: string[] = [];
  const knex = {
    raw: (sql: string): Promise<void> => {
      calls.push(sql);
      return Promise.resolve();
    },
  } as unknown as Knex;
  return { knex, calls };
}

const attachSql = async (
  table: string,
  opts?: Parameters<typeof attachAudit>[2],
): Promise<string> => {
  const { knex, calls } = stubKnex();
  await attachAudit(knex, table, opts);
  return calls.join("\n");
};

/**
 * The five positional arguments of one generated `CREATE TRIGGER`, unquoted.
 * Split on the quotes, not on commas — argument 1 is itself a comma-separated
 * list of redacted columns.
 */
const triggerArgs = (sql: string): string[] => {
  const match = sql.match(/audit_row_change\(([^)]*)\);/);
  if (!match) throw new Error(`no EXECUTE FUNCTION arguments in:\n${sql}`);
  const args: string[] = [];
  const literal = /'([^']*)'/g;
  let found = literal.exec(match[1]);
  while (found !== null) {
    args.push(found[1]);
    found = literal.exec(match[1]);
  }
  return args;
};

/**
 * Pinned on purpose, not derived from `AUDIT_REDACT`: an expectation built from
 * the map under test would follow it anywhere, including to zero columns. This
 * is the assertion that goes red when a secret drops off the list (L-018).
 * Re-verified 2026-09-01 against a full `%password%|%secret%|%token%|%cipher%|
 * %hash%|%credential%` sweep of `information_schema.columns`.
 */
const EXPECTED_REDACTIONS: Record<string, string[]> = {
  users: ["password"],
  invitations: ["token"],
  nf_credentials: ["secretCiphertext", "secretIv", "secretTag"],
};

describe("audit-triggers — §0 rule 6: no bare `?` in raw SQL", () => {
  it("keeps every generated statement free of `?`", async () => {
    const { knex, calls } = stubKnex();
    await createAuditLogsV2(knex);
    await ensureAuditPartitions(knex, 1);
    await attachAudit(knex, "production_route_stage_supplies", {
      exclude: ["password"],
      parent: AUDIT_PARENT.production_route_stage_supplies,
    });
    await detachAudit(knex, "warehouses");

    const everySql = [
      AUDIT_FUNCTION_SQL,
      PROTECTION_FUNCTION_SQL,
      ...calls,
    ].join("\n");
    expect(everySql).not.toContain("?");
  });

  it("tests jsonb key existence with jsonb_exists, not the `?` operator", () => {
    expect(AUDIT_FUNCTION_SQL).toContain("jsonb_exists(b, e.key)");
    expect(AUDIT_FUNCTION_SQL).toContain("jsonb_exists(a, e.key)");
  });
});

describe("audit-triggers — the trigger function", () => {
  it("returns without writing when mobius.audit_skip is on", () => {
    expect(AUDIT_FUNCTION_SQL).toContain(
      "IF current_setting('mobius.audit_skip', true) = 'on' THEN RETURN NULL; END IF;",
    );
  });

  it("reads the context with the missing_ok form, so an unset setting is not an error", () => {
    expect(AUDIT_FUNCTION_SQL).toContain(
      "current_setting('mobius.audit', true)",
    );
  });

  it("writes nothing for an update that changed nothing but a timestamp (V-1)", () => {
    expect(AUDIT_FUNCTION_SQL).toContain(
      "ignored      text[] := ARRAY['updatedAt','updated_at'];",
    );
    expect(AUDIT_FUNCTION_SQL).toContain(
      "IF (b - ignored) = (a - ignored) THEN RETURN NULL; END IF;",
    );
  });

  it("restricts both sides of a Modificacion to the changed keys (V-1)", () => {
    expect(AUDIT_FUNCTION_SQL).toContain(
      "b := COALESCE((SELECT jsonb_object_agg(k, b -> k) FROM unnest(changed) k WHERE jsonb_exists(b, k)), '{}'::jsonb) - excluded;",
    );
    expect(AUDIT_FUNCTION_SQL).toContain(
      "a := COALESCE((SELECT jsonb_object_agg(k, a -> k) FROM unnest(changed) k WHERE jsonb_exists(a, k)), '{}'::jsonb) - excluded;",
    );
    expect(AUDIT_FUNCTION_SQL).toContain("array_agg(k ORDER BY k)");
  });

  it("diffs the unredacted rows, so a redacted-only change is still an event", () => {
    // Ruling 2026-09-01, "record the event, never the value": change detection
    // runs on whole rows — redact before the diff and a password reset writes
    // no row at all, which hides the one event a security audit wants.
    const diffInput = AUDIT_FUNCTION_SQL.indexOf(
      "b := to_jsonb(OLD);  a := to_jsonb(NEW);  full_row := a - excluded;",
    );
    const guard = AUDIT_FUNCTION_SQL.indexOf(
      "IF (b - ignored) = (a - ignored) THEN RETURN NULL; END IF;",
    );
    const changedKeys = AUDIT_FUNCTION_SQL.indexOf("array_agg(k ORDER BY k)");
    expect(diffInput).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(diffInput);
    expect(changedKeys).toBeGreaterThan(guard);
    // and no redaction happens before any of them
    expect(AUDIT_FUNCTION_SQL).not.toContain(
      "b := to_jsonb(OLD) - excluded;  a := to_jsonb(NEW) - excluded;",
    );
  });

  it("strips the redacted values only after the diff, keeping their names in changedKeys", () => {
    const changedKeys = AUDIT_FUNCTION_SQL.indexOf("array_agg(k ORDER BY k)");
    const strip = AUDIT_FUNCTION_SQL.indexOf(
      "'{}'::jsonb) - excluded;",
    );
    expect(strip).toBeGreaterThan(changedKeys);
    // `changed` is built from the unredacted sides and is never filtered by
    // `excluded` — only by `ignored`.
    expect(AUDIT_FUNCTION_SQL).toContain(") s WHERE NOT (k = ANY(ignored));");
    expect(AUDIT_FUNCTION_SQL).not.toContain("k = ANY(excluded)");
  });

  it("keeps whole rows on Alta and Baja", () => {
    expect(AUDIT_FUNCTION_SQL).toContain(
      "a := to_jsonb(NEW) - excluded;  b := NULL;  full_row := a;",
    );
    expect(AUDIT_FUNCTION_SQL).toContain(
      "b := to_jsonb(OLD) - excluded;  a := NULL;  full_row := b;",
    );
  });

  it("COALESCEs both spellings of the company column (§0.3-1)", () => {
    // `warehouses.company_id` is snake_case; `->> 'companyId'` alone returns
    // NULL there and attributes the row to no company at all.
    expect(AUDIT_FUNCTION_SQL).toContain("(full_row ->> 'companyId')::integer");
    expect(AUDIT_FUNCTION_SQL).toContain(
      "(full_row ->> 'company_id')::integer",
    );
    expect(AUDIT_FUNCTION_SQL).toContain("(ctx ->> 'companyId')::integer");
  });

  it("COALESCEs both spellings of the parent fk (§0.3-1)", () => {
    expect(AUDIT_FUNCTION_SQL).toContain(
      "parent_id := COALESCE((full_row ->> parent_fk)::integer, (full_row ->> alt_fk)::integer);",
    );
    expect(AUDIT_FUNCTION_SQL).toContain(
      "to_jsonb(p.*) ->> %L, to_jsonb(p.*) ->> %L",
    );
  });

  it("attributes a companies row to the company being edited (R-A)", () => {
    expect(AUDIT_FUNCTION_SQL).toContain("IF TG_TABLE_NAME = 'companies' THEN");
    expect(AUDIT_FUNCTION_SQL).toContain(
      "company := (full_row ->> 'id')::integer;",
    );
  });

  it("qualifies every dynamic table reference with the public schema", () => {
    expect(AUDIT_FUNCTION_SQL).toContain(
      "'SELECT uuid FROM public.%I WHERE id = $1'",
    );
    expect(AUDIT_FUNCTION_SQL).toContain("FROM public.%I p WHERE p.id = $1");
    expect(AUDIT_FUNCTION_SQL).toContain("INSERT INTO public.audit_logs (");
  });

  it("is idempotent", () => {
    expect(AUDIT_FUNCTION_SQL).toContain(
      "CREATE OR REPLACE FUNCTION public.audit_row_change()",
    );
  });
});

describe("audit-triggers — the protection trigger", () => {
  it("raises P0001 on UPDATE or DELETE of the ledger", () => {
    expect(PROTECTION_FUNCTION_SQL).toContain("RAISE EXCEPTION");
    expect(PROTECTION_FUNCTION_SQL).toContain("USING ERRCODE = 'P0001'");
    expect(PROTECTION_FUNCTION_SQL).toContain(
      "CREATE TRIGGER audit_logs_protect BEFORE UPDATE OR DELETE ON public.audit_logs",
    );
  });

  it("lets the purge path through with mobius.audit_maintenance", () => {
    expect(PROTECTION_FUNCTION_SQL).toContain(
      "IF current_setting('mobius.audit_maintenance', true) = 'on' THEN",
    );
    expect(PROTECTION_FUNCTION_SQL).toContain("RETURN COALESCE(NEW, OLD);");
  });

  it("is idempotent", () => {
    expect(PROTECTION_FUNCTION_SQL).toContain(
      "CREATE OR REPLACE FUNCTION public.audit_logs_protect()",
    );
    expect(PROTECTION_FUNCTION_SQL).toContain(
      "DROP TRIGGER IF EXISTS audit_logs_protect ON public.audit_logs;",
    );
  });
});

describe("createAuditLogsV2", () => {
  const ddl = async (): Promise<string> => {
    const { knex, calls } = stubKnex();
    await createAuditLogsV2(knex);
    expect(calls).toHaveLength(1);
    return calls[0];
  };

  it("creates a monthly range-partitioned table with a DEFAULT partition", async () => {
    const sql = await ddl();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.audit_logs (");
    expect(sql).toContain('PARTITION BY RANGE ("occurredAt")');
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.audit_logs_default PARTITION OF public.audit_logs DEFAULT;",
    );
  });

  it("puts the partition key in every unique constraint", async () => {
    const sql = await ddl();
    expect(sql).toContain('PRIMARY KEY (id, "occurredAt")');
    expect(sql).toContain('UNIQUE (uuid, "occurredAt")');
  });

  it("creates the six indexes", async () => {
    const sql = await ddl();
    for (const index of [
      "audit_logs_entity_idx",
      "audit_logs_company_time_idx",
      "audit_logs_root_idx",
      "audit_logs_user_idx",
      "audit_logs_tx_idx",
      "audit_logs_changed_keys_idx",
    ]) {
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS ${index}`);
    }
    expect(sql.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(6);
  });

  it("declares no foreign key at all (R-B)", async () => {
    // `companyId` and `userId` are values. An FK on `companyId` would block the
    // `companies` special case (R-A) and would have to be dropped from three of
    // four databases at the split's cutover; an FK on `userId` with
    // ON DELETE SET NULL would rewrite the ledger when a user is deleted.
    const sql = await ddl();
    expect(sql).not.toContain("REFERENCES");
    expect(sql).not.toContain("FOREIGN KEY");
  });

  it("uses text CHECKs rather than PG enums", async () => {
    const sql = await ddl();
    expect(sql).toContain(
      "CHECK (operation IN ('Alta','Baja','Modificacion'))",
    );
    expect(sql).toContain(
      "CHECK (source IN ('api','job','seed','migration','script','sql'))",
    );
    expect(sql).not.toContain("CREATE TYPE");
  });
});

describe("ensureAuditPartitions", () => {
  it("names months and bounds from the given start", () => {
    const specs = auditPartitionSpecs(new Date(Date.UTC(2026, 8, 1)), 1);
    expect(specs).toEqual([
      {
        name: "audit_logs_y2026m09",
        from: "2026-09-01 00:00:00+00",
        to: "2026-10-01 00:00:00+00",
      },
      {
        name: "audit_logs_y2026m10",
        from: "2026-10-01 00:00:00+00",
        to: "2026-11-01 00:00:00+00",
      },
    ]);
  });

  it("rolls December over into January of the next year", () => {
    const specs = auditPartitionSpecs(new Date(Date.UTC(2026, 11, 31)), 2);
    expect(specs.map((spec) => spec.name)).toEqual([
      "audit_logs_y2026m12",
      "audit_logs_y2027m01",
      "audit_logs_y2027m02",
    ]);
    expect(specs[0]).toEqual({
      name: "audit_logs_y2026m12",
      from: "2026-12-01 00:00:00+00",
      to: "2027-01-01 00:00:00+00",
    });
    expect(specs[1].from).toBe("2027-01-01 00:00:00+00");
    expect(specs[1].to).toBe("2027-02-01 00:00:00+00");
  });

  it("crosses a year end from any month, 13 months ahead", () => {
    const specs = auditPartitionSpecs(new Date(Date.UTC(2027, 10, 15)), 13);
    expect(specs).toHaveLength(14);
    expect(specs[0].name).toBe("audit_logs_y2027m11");
    expect(specs[2].name).toBe("audit_logs_y2028m01");
    expect(specs[13].name).toBe("audit_logs_y2028m12");
    // every partition ends exactly where the next one begins
    for (let i = 1; i < specs.length; i += 1) {
      expect(specs[i].from).toBe(specs[i - 1].to);
    }
  });

  it("emits one idempotent CREATE TABLE per month", async () => {
    const { knex, calls } = stubKnex();
    await ensureAuditPartitions(knex, 2);
    const expected = auditPartitionSpecs(new Date(), 2);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe(
      `CREATE TABLE IF NOT EXISTS public."${expected[0].name}" PARTITION OF public.audit_logs ` +
        `FOR VALUES FROM ('${expected[0].from}') TO ('${expected[0].to}');`,
    );
  });

  it("defaults to 13 months ahead", async () => {
    const { knex, calls } = stubKnex();
    await ensureAuditPartitions(knex);
    expect(calls).toHaveLength(14);
  });
});

describe("attachAudit — positional TG_ARGV", () => {
  it("passes '' for every absent argument on a table with no parent", async () => {
    const sql = await attachSql("warehouses");
    expect(triggerArgs(sql)).toEqual(["", "", "", "", ""]);
    expect(sql).toContain(
      'DROP TRIGGER IF EXISTS audit_row_change ON public."warehouses";',
    );
    expect(sql).toContain(
      'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public."warehouses"',
    );
    expect(sql).toContain("FOR EACH ROW EXECUTE FUNCTION");
  });

  it("passes parent and fk in slots 2 and 3 for a one-hop child", async () => {
    const sql = await attachSql("corrugation_layers", {
      parent: AUDIT_PARENT.corrugation_layers,
    });
    expect(triggerArgs(sql)).toEqual([
      "",
      "corrugations",
      "corrugationId",
      "",
      "",
    ]);
  });

  it("passes grand and grandFk in slots 4 and 5 for a two-hop child", async () => {
    const sql = await attachSql("production_route_stage_supplies", {
      parent: AUDIT_PARENT.production_route_stage_supplies,
    });
    expect(triggerArgs(sql)).toEqual([
      "",
      "production_route_stages",
      "stageId",
      "production_routes",
      "routeId",
    ]);
  });

  it("carries a snake_case parent fk through unchanged", async () => {
    const sql = await attachSql("warehouse_locations", {
      parent: AUDIT_PARENT.warehouse_locations,
    });
    expect(triggerArgs(sql)).toEqual([
      "",
      "warehouses",
      "warehouse_id",
      "",
      "",
    ]);
  });

  it("emits the excluded columns as a CSV in slot 1", async () => {
    const sql = await attachSql("nf_credentials", {
      exclude: AUDIT_REDACT.nf_credentials,
    });
    expect(triggerArgs(sql)[0]).toBe("secretCiphertext,secretIv,secretTag");
  });

  it("re-attaches rather than failing when the trigger already exists", async () => {
    const sql = await attachSql("warehouses");
    expect(sql.indexOf("DROP TRIGGER IF EXISTS")).toBeLessThan(
      sql.indexOf("CREATE TRIGGER"),
    );
  });

  it("rejects a table identifier that is not lowercase snake_case", async () => {
    await expect(
      attachSql('warehouses"; DROP TABLE users; --'),
    ).rejects.toThrow(/invalid table identifier/);
    await expect(attachSql("emailTokens")).rejects.toThrow(
      /invalid table identifier/,
    );
  });

  it("rejects a column identifier that could break out of the trigger argument", async () => {
    await expect(
      attachSql("users", { exclude: ["password', 'x"] }),
    ).rejects.toThrow(/invalid column identifier/);
    await expect(
      attachSql("corrugation_layers", {
        parent: { parent: "corrugations", fk: "corrugationId, evil" },
      }),
    ).rejects.toThrow(/invalid column identifier/);
  });
});

describe("attachAudit — redaction coverage", () => {
  it("matches the verified secret sweep exactly", () => {
    expect(AUDIT_REDACT).toEqual(EXPECTED_REDACTIONS);
  });

  it("emits every redacted column to the trigger that must strip it", async () => {
    for (const [table, columns] of Object.entries(EXPECTED_REDACTIONS)) {
      const sql = await attachSql(table, { exclude: AUDIT_REDACT[table] });
      const emitted = triggerArgs(sql)[0].split(",");
      expect(emitted).toEqual(columns);
    }
  });
});

describe("detachAudit", () => {
  it("drops only the audit trigger, and tolerates its absence", async () => {
    const { knex, calls } = stubKnex();
    await detachAudit(knex, "warehouses");
    expect(calls).toEqual([
      'DROP TRIGGER IF EXISTS audit_row_change ON public."warehouses";',
    ]);
  });

  it("validates the identifier", async () => {
    const { knex } = stubKnex();
    await expect(
      detachAudit(knex, "Robert'); DROP TABLE users;"),
    ).rejects.toThrow(/invalid table identifier/);
  });
});
