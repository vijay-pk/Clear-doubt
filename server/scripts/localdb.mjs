// Dev/test helper: runs a local PostgreSQL using embedded-postgres binaries.
// Production uses the hosted Supabase DATABASE_URL instead.
// Port 5434 to avoid clashing with other local Postgres instances.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.env.LOCAL_PG_DIR ?? ".localdb");
const port = Number(process.env.LOCAL_PG_PORT ?? 5436);
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
if (!existsSync(dir)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("doubts");
} catch {
  /* exists */
}
console.log(`Local Postgres ready: postgresql://postgres:postgres@localhost:${port}/doubts`);
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (process.argv.includes("--once")) await stop();
