import dotenv from "dotenv";
import { connectAll, disconnectAll } from "./database/registry";
import {
  startReminderScheduler,
  stopReminderScheduler,
} from "./services/countdown/countdown-reminders.service";
import {
  startNodeFilesWorker,
  stopNodeFilesWorker,
} from "./services/node-files/node-files-worker";
dotenv.config();

/**
 * Deploys stop the old process before the new one is healthy; without a bound
 * on the drain, one stuck connection (or a socket a client never closes) wedges
 * the whole release. Force-exit after this, and let the restart policy win.
 */
const FORCE_EXIT_MS = 8_000;

const envPort: string = process.env.PORT || "3005";

if (isNaN(parseInt(envPort))) {
  throw new Error("The port must to be a number");
}

const PORT: number = parseInt(envPort);

(async () => {
  // Initialize Knex database connection
  try {
    await connectAll();
    console.info("Database connections established successfully");
  } catch (error) {
    console.error("Failed to connect to database:", error);
    process.exit(1);
  }
})().then(async () => {
  const { default: app } = await import("./app");
  const server = app.listen(PORT, () =>
    console.info(`Server up and running on port ${PORT}`),
  );

  // The background jobs, both in-process ticks rather than host crontabs — no
  // extra dependency and they come back with the process:
  //   - countdown's daily reminder batch (hourly tick, once per weekday);
  //   - the node-files extraction worker (5 s tick, one queued run at a time).
  // Never under test, which would try to send mail and to call Claude.
  if (process.env.NODE_ENV !== "test") {
    startReminderScheduler();
    startNodeFilesWorker();
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    // Both signals can arrive, and a second one during the drain must not
    // start a second teardown.
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Shutting down (${signal}), draining in-flight requests`);

    stopReminderScheduler();
    stopNodeFilesWorker();

    const force = setTimeout(() => {
      console.error("Shutdown drain timed out, forcing exit");
      process.exit(1);
    }, FORCE_EXIT_MS);
    // Unref'd so this timer is never itself the reason the process stays up.
    force.unref();

    server.close(() => {
      void disconnectAll()
        .catch((err) => console.error("Failed to close database pools:", err))
        .finally(() => {
          clearTimeout(force);
          process.exit(0);
        });
    });
  };

  // Every deploy sends SIGTERM; without this, in-flight writes are severed and
  // connections are left stranded on the shared Postgres.
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
});
