# Adways Academy — AI Student Doubt-Clearing Platform

An **independent** doubt-clearing platform for Adways Academy. Students ask doubts
(text **or photo**), the AI drafts a transcript-grounded answer, and **every answer is
reviewed and approved by a human before it is sent**. Separate from the WhatsApp
Course Tutor — it only borrows proven patterns.

## What it does

- **One shared login.** Admins are pre-seeded (never self-registered); students self-register with email verification. On login, admins go to the dashboard, students to the chat portal.
- **Doubt chat** (mobile-first) with history and live statuses; students see only their own data.
- **Image/vision doubts:** upload a photo → private storage → vision+OCR → combined with retrieved course material. Unreadable images get a clarification request, never a guess.
- **Course knowledge (RAG):** admins upload PDF/DOCX/TXT → extracted, chunked, embedded → hybrid full-text + vector retrieval with source citations and an "insufficient evidence" flag.
- **Mandatory approval:** every AI answer is a draft (approve / edit / reject / regenerate). Generating never auto-sends. Full audit log.
- **Reply modes:** A Manual (default), B Supervised (reuse strong approved answers), C Controlled Auto-Reply (strict eligibility) — with an instant global pause.
- **Independent delivery:** website + email (transactional, retries, idempotency, logs) + WhatsApp **official Business Cloud API only** (templates outside 24h). One channel failing never duplicates another's success.
- **Security:** server-enforced roles, argon2 passwords, httpOnly sessions + CSRF, upload magic-byte validation, private signed downloads, no cross-student access via URL tampering, rate limits, webhook signature verification, retention sweeps.

## Stack

Node + Express 5 · Prisma 6 + Postgres (portable `real[]` + `kb_cosine`, no pgvector
needed) · durable Postgres job queue + in-process worker (no Redis) · React 19 + Vite +
Tailwind 4 · Groq (OpenAI-compatible) for text + vision · Resend/SMTP email · Supabase
Postgres + private storage in production, embedded Postgres for local dev.

## Quick start (local)

```bash
npm install
cp server/.env.example server/.env        # defaults work for local dev (mock AI)
npm run db:local --workspace server &      # embedded Postgres on :5436
npm run db:migrate                         # apply migrations
npm run seed:admins --workspace server     # seed admins from ADMIN_SEED
npm run dev:server                         # API + worker on :3001
npm run dev:web                            # dashboard + chat on :5174 (proxies /api)
```

Open http://localhost:5174. Sign in as the seeded admin, or register a student
(verify link is printed to the server console with `EMAIL_PROVIDER=console`).

## Scripts

| Command | What |
|---|---|
| `npm run build` | Build server (tsc) + web (vite) |
| `npm run typecheck` | Typecheck both workspaces |
| `npm test` | Server Vitest suite (needs `TEST_DATABASE_URL`) |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run seed:admins --workspace server` | Seed admins from `ADMIN_SEED` |
| `npm run admin:create --workspace server -- <email> <name> <pw> [SUPER_ADMIN]` | Create one admin |

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — subdomain/DNS, HTTPS, Supabase, env,
worker/cron, backups, and the list of paid services. Architecture details in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
