import "dotenv/config";
import { z } from "zod";

// Blank env vars count as unset (matches the proven pattern from the Tutor app).
const raw: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(process.env)) {
  raw[k] = v === "" ? undefined : v;
}

const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  APP_URL: z.string().url().default("http://localhost:3001"),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),

  // Auth / sessions
  SESSION_COOKIE_NAME: z.string().default("adways_doubts_sid"),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: boolish(false),
  TRUST_PROXY: boolish(false),

  // Admin seeding (JSON array: [{"email","name","password","role"}]). Optional.
  ADMIN_SEED: z.string().optional(),

  // AI (Groq, OpenAI-compatible) or deterministic mock for tests
  AI_PROVIDER: z.enum(["groq", "mock"]).default("mock"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  GROQ_TEXT_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GROQ_VISION_MODEL: z.string().default("meta-llama/llama-4-scout-17b-16e-instruct"),
  AI_DAILY_BUDGET_USD: z.coerce.number().default(5),

  // Embeddings
  EMBEDDING_PROVIDER: z.enum(["none", "openai_compatible", "mock"]).default("mock"),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_BASE_URL: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIM: z.coerce.number().default(1536),

  // Email delivery
  EMAIL_PROVIDER: z.enum(["resend", "smtp", "console"]).default("console"),
  EMAIL_FROM: z.string().default("Adways Academy <no-reply@adwaysacademy.com>"),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: boolish(false),

  // WhatsApp (official Cloud API only)
  WHATSAPP_ENABLED: boolish(false),
  WHATSAPP_CLOUD_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  // Storage for uploads (private)
  STORAGE_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  UPLOAD_DIR: z.string().default("./storage"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_BUCKET: z.string().default("doubts-private"),

  // Worker
  WORKER_ENABLED: boolish(true),
  WORKER_POLL_MS: z.coerce.number().default(1500),

  // Limits & retention
  MAX_UPLOAD_MB: z.coerce.number().default(8),
  STUDENT_RATE_PER_HOUR: z.coerce.number().default(30),
  RETENTION_DAYS: z.coerce.number().default(365),

  // Dev-only helpers
  ENABLE_DEV_ROUTES: boolish(false),
});

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
