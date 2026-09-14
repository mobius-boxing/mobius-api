import dotenv from "dotenv";
import { connectAll, disconnectAll } from "../database/registry";
import { move, type MoveResult } from "../services/tenant-provisioning.service";
import { parseCliArgs } from "../services/purge-snapshot.service";

/**
 * `tenant:move` — state C2 (db-per-company model, brief T11 AC-67…69):
 *
 *   npm run tenant:move -- --company <uuid> --to <serverUuid> [--dry-run]
 *                          [--confirm <companyUuid>]
 *
 * A thin CLI: all the work is `services/tenant-provisioning.service.ts#move`.
 * `--confirm` is required and must equal `--company` under
 * `NODE_ENV=production` (D-53) — agents never pass it (non-goal).
 */

const FLAGS = {
  company: "single",
  to: "single",
  "dry-run": "boolean",
  confirm: "single",
} as const;

const USAGE =
  "usage: tenant:move -- --company <uuid> --to <serverUuid> [--dry-run] [--confirm <companyUuid>]";

export type MoveCliDeps = {
  move: typeof move;
  out: (line: string) => void;
  err: (line: string) => void;
};

export function formatMoveResult(result: MoveResult): string[] {
  const lines: string[] = [];
  for (const step of result.steps) {
    lines.push(`  ${step.table}: ${step.predicate} — ${step.rows} row(s)`);
  }
  return lines;
}

export async function runTenantMove(
  argv: readonly string[],
  deps: MoveCliDeps,
): Promise<number> {
  const parsed = parseCliArgs(argv, FLAGS);
  if (!parsed.ok || parsed.value.positionals.length > 0) {
    deps.err(parsed.ok ? USAGE : `${parsed.reason}\n${USAGE}`);
    return 2;
  }
  const companyUuid = parsed.value.flags.get("company")?.[0];
  const serverUuid = parsed.value.flags.get("to")?.[0];
  if (!companyUuid || !serverUuid) {
    deps.err(`tenant:move: --company and --to are required\n${USAGE}`);
    return 2;
  }
  const dryRun = parsed.value.flags.has("dry-run");
  const confirmCompanyUuid = parsed.value.flags.get("confirm")?.[0];

  const result = await deps.move(companyUuid, {
    serverUuid,
    dryRun,
    confirmCompanyUuid,
  });

  if (!result.ok) {
    deps.err(`tenant:move: ${result.reason}`);
    for (const line of formatMoveResult(result)) deps.out(line);
    return 1;
  }
  deps.out(
    `tenant:move: ${result.dryRun ? "DRY RUN — " : ""}${result.steps.length} table(s)`,
  );
  for (const line of formatMoveResult(result)) deps.out(line);
  return 0;
}

if (require.main === module) {
  dotenv.config();
  void (async () => {
    try {
      await connectAll();
      process.exitCode = await runTenantMove(process.argv.slice(2), {
        move,
        out: (line) => console.log(line),
        err: (line) => console.error(line),
      });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await disconnectAll();
    }
  })();
}
