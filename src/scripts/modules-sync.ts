import type { Knex } from "knex";
import { connectAll, disconnectAll, db } from "../database/registry";
import { MODULE_MANIFESTS } from "../modules/registry";
import type { ModuleCatalogueEntry } from "../modules/module.types";

/**
 * Registers the module manifests in the central `modules` catalogue, replacing
 * catalogue DML in migrations (module-split T2d):
 *
 *   npx ts-node src/scripts/modules-sync.ts        (node dist/scripts/modules-sync.js)
 *
 * Idempotent: a row is written only when a manifest's `name`, `description` or
 * `isCore` differs, so a rerun leaves `updatedAt` alone. It never deletes and
 * never deactivates: a catalogue row without a manifest is reported as a
 * WARNING and left as it is, because `modules` has no inactive state and
 * `company_modules` enablement is a backoffice decision. `publicDomainLabel`
 * and permissions are not its business (their migrations and `RbacService`
 * own them).
 */

export type ModulesSyncSummary = {
  inserted: string[];
  updated: string[];
  unchanged: string[];
  withoutManifest: string[];
};

const differs = (
  row: ModuleCatalogueEntry,
  entry: ModuleCatalogueEntry,
): boolean =>
  row.name !== entry.name ||
  (row.description ?? null) !== entry.description ||
  row.isCore !== entry.isCore;

export async function syncModules(
  knex: Knex,
  entries: readonly ModuleCatalogueEntry[],
): Promise<ModulesSyncSummary> {
  const slugs = entries.map((entry) => entry.slug);
  const duplicated = slugs.filter((slug, i) => slugs.indexOf(slug) !== i);
  if (duplicated.length > 0) {
    throw new Error(`two manifests declare the slug(s) ${duplicated.join(", ")}`);
  }
  return knex.transaction(async (trx) => {
    const rows: ModuleCatalogueEntry[] = await trx("modules").select(
      "slug",
      "name",
      "description",
      "isCore",
    );
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    const summary: ModulesSyncSummary = {
      inserted: [],
      updated: [],
      unchanged: [],
      withoutManifest: [],
    };
    for (const entry of entries) {
      const values = {
        name: entry.name,
        description: entry.description,
        isCore: entry.isCore,
      };
      const row = bySlug.get(entry.slug);
      if (!row) {
        await trx("modules").insert({ slug: entry.slug, ...values });
        summary.inserted.push(entry.slug);
      } else if (differs(row, entry)) {
        await trx("modules")
          .where({ slug: entry.slug })
          .update({ ...values, updatedAt: trx.fn.now() });
        summary.updated.push(entry.slug);
      } else {
        summary.unchanged.push(entry.slug);
      }
    }
    summary.withoutManifest = rows
      .map((row) => row.slug)
      .filter((slug) => !slugs.includes(slug))
      .sort();
    return summary;
  });
}

export type ModulesSyncDeps = {
  knex: () => Knex;
  manifests: readonly ModuleCatalogueEntry[];
  out: (line: string) => void;
  warn: (line: string) => void;
};

const listed = (slugs: readonly string[]): string =>
  `${slugs.length}${slugs.length > 0 ? ` [${slugs.join(", ")}]` : ""}`;

/** Exit 0 whenever the catalogue holds every manifest, warnings included. */
export async function runModulesSync(deps: ModulesSyncDeps): Promise<number> {
  const summary = await syncModules(deps.knex(), deps.manifests);
  for (const slug of summary.withoutManifest) {
    deps.warn(
      `modules-sync: WARNING: module '${slug}' is in the catalogue but no manifest declares it; left unchanged`,
    );
  }
  deps.out(
    `modules-sync: inserted ${listed(summary.inserted)}, updated ${listed(summary.updated)}, unchanged ${listed(summary.unchanged)}, without manifest ${listed(summary.withoutManifest)}`,
  );
  return 0;
}

// Not `runAsCli` from the purge service: it names every connection as the
// purge's own, which would hide this writer from the state-P backend check.
if (require.main === module) {
  void (async () => {
    try {
      await connectAll();
      process.exitCode = await runModulesSync({
        knex: () => db("core"),
        manifests: MODULE_MANIFESTS,
        out: (line) => console.log(line),
        warn: (line) => console.warn(line),
      });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await disconnectAll();
    }
  })();
}
