import { defineConfig } from "vitest/config";
import "dotenv/config";

// Safety: tests must run against a SEPARATE database from DATABASE_URL.
const test = process.env.TEST_DATABASE_URL;
const main = process.env.DATABASE_URL;
if (!test) throw new Error("TEST_DATABASE_URL is required to run tests.");
if (test === main) throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL.");

export default defineConfig({
  test: {
    globalSetup: ["tests/globalSetup.ts"],
    setupFiles: ["tests/setupEnv.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
