import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { registerJobHandlers, scheduleRecurring } from "./bootstrap.js";
import { startWorker, stopWorker } from "./jobs/worker.js";
import { seedAdminsFromEnv } from "./auth/seedAdmins.js";
import { prisma } from "./db/prisma.js";

async function main() {
  registerJobHandlers();

  // Provision pre-approved admins from ADMIN_SEED (idempotent; shell-free hosts).
  await seedAdminsFromEnv().catch((err) => logger.error({ err }, "admin seed failed"));

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "Adways Doubts API listening");
  });

  if (env.WORKER_ENABLED) {
    startWorker();
    await scheduleRecurring();
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopWorker();
    server.close();
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
