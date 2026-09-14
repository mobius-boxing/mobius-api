import dotenv from "dotenv";
import { knexfileConfig } from "./src/database/migration-sets";
dotenv.config();

/**
 * One env per migration set (db-per-company D-17, D-41), so every knex CLI
 * call names its set: `--env core` or `--env tenant`. `connectionFor` is still
 * the single place database env-var names are spelled (D-8).
 *
 * `tenant` has no connection on purpose: `migrate:create:tenant` only writes a
 * file, and anything that would connect fails with the reason.
 */
export default knexfileConfig();
