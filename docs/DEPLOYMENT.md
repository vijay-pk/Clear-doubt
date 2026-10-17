# Deployment

Target: **Render (Docker web service) + Supabase (Postgres + private storage)**, served
at a new subdomain **doubts.adwaysacademy.com**. The WordPress/Hostinger site is used
only for the subdomain DNS record and (optionally) a link to the platform.

## 0. Paid / external services

| Service | Why | Plan |
|---|---|---|
| **Render** | Hosts the Docker web service + always-on worker | **Starter** (paid, always-on). Free plan sleeps → worker pauses → email/WhatsApp delays. |
| **Supabase** | Postgres database + private file storage | Free tier works to start; Pro for backups/scale. |
| **Groq** | AI text + vision (OCR) | Pay-as-you-go API key. |
| **Embeddings** | OpenAI-compatible embeddings endpoint (e.g. OpenAI) | Pay-as-you-go, or set `EMBEDDING_PROVIDER=none` for keyword-only retrieval. |
| **Resend** (or SendGrid via SMTP) | Transactional email (verify, reset, answers) | Resend free tier to start; verify your sending domain. |
| **Meta WhatsApp Business Cloud API** | WhatsApp delivery (optional) | Free Cloud API; needs a verified Business + phone number. Configure later. |

## 1. Supabase

1. Create a project. Note the DB password.
2. Connection strings (Project → Database → Connection pooling):
   - `DATABASE_URL` → **transaction pooler**, port **6543**, add `?pgbouncer=true`.
   - `DIRECT_URL` → **session pooler**, port **5432** (used for migrations).
   - URL-encode special characters in the password.
3. Storage → create a **private** bucket named `doubts-private` (the server also
   auto-creates/uploads via the service key). Get the **service role** key
   (Project → API) for `SUPABASE_SERVICE_KEY` and the project URL for `SUPABASE_URL`.
4. No pgvector needed — retrieval uses a portable `real[]` + `kb_cosine()` function
   created by the migrations.

## 2. DNS + HTTPS (subdomain on Hostinger)

1. In Render, after the service is created, open **Settings → Custom Domains** and add
   `doubts.adwaysacademy.com`. Render shows a target hostname.
2. In the Hostinger/WordPress DNS zone for `adwaysacademy.com`, add a **CNAME**:
   `doubts` → the Render target hostname (e.g. `adways-doubts.onrender.com`).
   (If your DNS can't CNAME a subdomain to that host, use the A/ALIAS record Render provides.)
3. Render issues and renews the TLS certificate automatically — HTTPS is on by default.
   Set `COOKIE_SECURE=true` and `TRUST_PROXY=true` (already in `render.yaml`).

## 3. Deploy on Render

1. Push this repo to GitHub.
2. Render → **New → Blueprint**, pick the repo. It reads `render.yaml`.
3. Fill every `sync:false` secret in the dashboard (DB URLs, `ADMIN_SEED`, Groq/embedding/
   Resend keys, Supabase keys, and WhatsApp creds when ready). **Never commit secrets.**
4. First deploy: the container runs `prisma migrate deploy` on boot, then starts the API +
   worker. Migrations re-run on every deploy (idempotent).
5. Seed admins once (Render **Shell**): `cd server && npm run seed:admins`
   (or rely on `ADMIN_SEED` + run it; it skips existing emails and never overwrites a password).

## 4. Worker / background jobs

The worker runs **in-process** inside the web service (`WORKER_ENABLED=true`) — it polls a
Postgres `jobs` table (`FOR UPDATE SKIP LOCKED`), so there is no browser dependency and no
Redis. It handles extraction, embeddings, AI generation, email + WhatsApp delivery (with
retries/backoff), and a daily retention sweep (re-schedules itself).

- Keep the service on a **paid always-on plan** so the worker never pauses.
- To scale the worker out later, run a second Render service from the same image with
  `WORKER_ENABLED=true` and the web `PORT` unused — the SKIP LOCKED claim makes it safe to
  run multiple workers concurrently.

## 5. Backups

- Supabase Pro provides automated daily backups + point-in-time recovery. On free tier,
  schedule a periodic `pg_dump` (e.g. a Render cron job) to object storage.
- Uploaded files live in the private Supabase bucket; enable bucket backups / versioning.

## 6. Environment separation

- **dev**: `server/.env` (embedded Postgres :5436, `AI_PROVIDER=mock`, `EMAIL_PROVIDER=console`).
- **test**: `TEST_DATABASE_URL` (separate schema `doubts_test`), forced mock providers.
- **prod**: Render env vars only. `ENABLE_DEV_ROUTES=false`, `COOKIE_SECURE=true`.
  No secrets in the repo; `.env*` is git-ignored except `.env.example`.

## 7. WhatsApp (when ready)

1. Create a Meta app + WhatsApp Business account; add a phone number (Cloud API).
2. Set `WHATSAPP_ENABLED=true`, `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
3. Webhook URL: `https://doubts.adwaysacademy.com/api/webhooks/whatsapp` with your verify
   token. The server verifies `X-Hub-Signature-256` against the raw body.
4. Enable the WhatsApp channel in **Admin → Settings → delivery channels**. Outside the
   24-hour window, WhatsApp requires an approved message template.
