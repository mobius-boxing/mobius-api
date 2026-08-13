import { knex, Knex } from "knex";
import pg from "pg";

/**
 * Keep PG `DATE` (oid 1082) as the 'YYYY-MM-DD' string it already is.
 *
 * node-postgres otherwise parses it into a Date at LOCAL midnight, which for any
 * server west of the value's own calendar prints as the previous day — the exact
 * bug DATE columns exist to avoid. The countdown module's `dueDate` is the only
 * DATE column in the schema today, and "vence el 5" must never render as the 4th.
 * Process-global by nature: pg has one parser registry.
 */
pg.types.setTypeParser(1082, (value: string) => value);

class KnexManager {
  private static knexInstance: Knex<any, unknown[]> | null = null;

  /**
   * Open a new connection. Reuse the already existing one if there's any.
   */
  static async connect(
    config?: Knex.Config,
    connections?: number,
  ): Promise<Knex<any, unknown[]>> {
    if (!KnexManager.knexInstance) {
      const defaultConfig = {
        client: "pg",
        connection: {
          host: process.env.SQL_HOST,
          user: process.env.SQL_USER,
          password: process.env.SQL_PASSWORD,
          database: process.env.SQL_DB_NAME,
          charset: "utf8mb4",
          port: Number(process.env.SQL_PORT) || 5432,
          ssl: false, // EC2 database doesn't support SSL
        },
        pool: {
          min: 1,
          max: connections || 15,
          idleTimeoutMillis: 20000,
          acquireTimeoutMillis: 30000,
        },
        migrations: {
          tableName: "knex_migrations",
        },
      };
      KnexManager.knexInstance = knex(config || defaultConfig);
      try {
        await KnexManager.knexInstance.raw("SELECT 1");
        console.info(`Knex connection established`);
      } catch (error) {
        console.error(`Failed to establish Knex connection:`, error);
        KnexManager.knexInstance = null;
        throw error;
      }
    }

    return KnexManager.knexInstance;
  }

  /**
   * Devuelve la conexión activa.
   */
  static getConnection(): Knex<any, unknown[]> {
    if (!KnexManager.knexInstance) {
      throw new Error(
        "Knex connection has not been established. Call connect() first.",
      );
    }
    return KnexManager.knexInstance;
  }

  /**
   * Cierra la conexión y destruye la instancia.
   */
  static async disconnect(): Promise<void> {
    if (KnexManager.knexInstance) {
      await KnexManager.knexInstance.destroy();
      KnexManager.knexInstance = null;
      console.info(`Knex connection closed`);
    }
  }
}

export default KnexManager;
