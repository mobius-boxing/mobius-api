import dotenv from "dotenv";
import { connectAll, disconnectAll } from "../database/registry";
import {
  registerShared,
  type RegisterSharedResult,
} from "../services/tenant-provisioning.service";
import type { Checked } from "../services/purge-snapshot.service";

/**
 * State C1 (db-per-company model D-21/D-31, AC-46/AC-85):
 *
 *   npm run tenant:register-shared -- --snapshot <file>
 */

const USAGE = "usage: tenant:register-shared -- --snapshot <file>";

export type RegisterSharedCliDeps = {
  register: (snapshotPath: string) => Promise<Checked<RegisterSharedResult>>;
  out: (line: string) => void;
  err: (line: string) => void;
};

export async function runTenantRegisterShared(
  argv: readonly string[],
  deps: RegisterSharedCliDeps,
): Promise<number> {
  const flagIndex = argv.indexOf("--snapshot");
  const snapshotPath = flagIndex === -1 ? undefined : argv[flagIndex + 1];
  if (!snapshotPath) {
    deps.err(`tenant:register-shared: --snapshot is required\n${USAGE}`);
    return 2;
  }

  const result = await deps.register(snapshotPath);
  if (!result.ok) {
    deps.err(`tenant:register-shared: ${result.reason}`);
    return 1;
  }
  deps.out(
    `tenant:register-shared: registered ${result.value.registered}, ` +
      `already registered ${result.value.alreadyRegistered}`,
  );
  return 0;
}

// Not `runAsCli` from the purge service (T4/D-111): it names every connection
// as the purge's own, which would hide this writer from the state-P backend
// check — this script has nothing to do with P.
if (require.main === module) {
  dotenv.config();
  void (async () => {
    try {
      await connectAll();
      process.exitCode = await runTenantRegisterShared(process.argv.slice(2), {
        register: registerShared,
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
