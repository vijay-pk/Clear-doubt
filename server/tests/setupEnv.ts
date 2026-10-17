// Runs before each test file's imports. Points the app at the TEST database and
// forces deterministic providers. Must set env BEFORE config/env.ts is imported.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
process.env.AI_PROVIDER = "mock";
process.env.EMBEDDING_PROVIDER = "mock";
process.env.EMAIL_PROVIDER = "console";
process.env.WORKER_ENABLED = "false";
process.env.ENABLE_DEV_ROUTES = "false";
process.env.STORAGE_PROVIDER = "local";
process.env.UPLOAD_DIR = "./storage-test";
process.env.WHATSAPP_ENABLED = "false";
process.env.WHATSAPP_APP_SECRET = "test-secret";
process.env.STUDENT_RATE_PER_HOUR = "100";
