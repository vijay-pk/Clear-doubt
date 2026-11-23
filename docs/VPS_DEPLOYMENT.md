# Hosting the backend on a VPS (Hostinger / any Ubuntu)

Move the app off Render to your own VPS. **No data is lost:** all data lives in
**Supabase** (Postgres + file storage). The VPS just runs the app container and
points at the *same* Supabase, so every student, doubt, draft and upload stays
exactly as it is. Migrations on boot are idempotent (already applied → no-op),
and admin seeding skips existing accounts.

The app is served with Docker + **Caddy**, which auto-provisions HTTPS.

---

## 0. What you need

- A VPS running **Ubuntu 22.04/24.04** (Hostinger VPS is fine) with a public IP.
- SSH access to it (root or a sudo user).
- The domain **doubts.adwaysacademy.com** (you already have it).
- Your existing env values from Render — especially the **Supabase** ones
  (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) and
  `GROQ_API_KEY`, `ADMIN_SEED`. Copy them from Render → service → **Environment**.

> Nothing here touches Supabase, so your data is safe throughout. You can even
> run the VPS in parallel with Render first, then switch DNS.

---

## 1. Point the domain at the VPS

In Hostinger DNS for `adwaysacademy.com`:

1. **Remove** the existing `doubts` CNAME that points at Render
   (`adways-doubts.onrender.com`).
2. Add an **A record**: name `doubts`, value = **your VPS public IP**, TTL default.

Also, in **Render → the service → Settings → Custom Domains**, remove
`doubts.adwaysacademy.com` so Render releases the domain (Caddy will issue a
fresh certificate on the VPS).

DNS can take a few minutes to a couple of hours to propagate. Caddy will get the
HTTPS certificate automatically once the A record resolves to the VPS.

---

## 2. Install Docker on the VPS

SSH in, then:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out/in after this so `docker` works without sudo
```

Verify: `docker version` and `docker compose version`.

---

## 3. Get the code

```bash
git clone https://github.com/vijay-pk/Clear-doubt.git
cd Clear-doubt/deploy
```

(Private repo? Use a GitHub token or deploy key for the clone.)

---

## 4. Create the environment file

```bash
cp .env.production.example .env
nano .env     # paste your real values (same Supabase/Groq/ADMIN_SEED as Render)
```

Fill at least: `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `GROQ_API_KEY`, `ADMIN_SEED`. Keep
`STORAGE_PROVIDER=supabase`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`,
`APP_URL=https://doubts.adwaysacademy.com`. `deploy/.env` is git-ignored.

> Because `DATABASE_URL`/storage point at the same Supabase as Render, the app
> immediately sees all existing data. **`prisma migrate deploy` runs on boot and
> is a no-op** when migrations are already applied — it never drops data.

---

## 5. Build and start

```bash
docker compose up -d --build
```

- `app` runs migrations then starts the API + in-process worker on port 3001.
- `caddy` listens on 80/443, proxies to the app, and gets HTTPS automatically.

Check it:

```bash
docker compose ps
docker compose logs -f app        # watch for "migrate deploy" + "API listening" + "seeded admin"
curl -I https://doubts.adwaysacademy.com/api/health   # expect 200 once DNS + cert are ready
```

Then open `https://doubts.adwaysacademy.com` and sign in as your admin — all your
existing students and doubts are there.

---

## 6. Updating later

```bash
cd Clear-doubt
git pull
cd deploy
docker compose up -d --build     # rebuilds and restarts with zero data loss
```

Migrations in new commits apply automatically on boot.

---

## 7. Operations

- **Logs:** `docker compose logs -f app`
- **Restart:** `docker compose restart app`
- **Stop:** `docker compose down` (keeps volumes; data is in Supabase anyway)
- **WhatsApp Web (Baileys) QR session** persists in the `wa_session` Docker volume,
  so unlike Render free you won't re-scan on every restart. The VPS is always-on,
  so WhatsApp Web is now viable.
- **Firewall:** allow 80 and 443 (`sudo ufw allow 80,443/tcp` if ufw is on).

---

## 8. Backups

- **Database + uploaded files:** handled by **Supabase** (enable Pro backups / PITR,
  or schedule `pg_dump`). Nothing to back up on the VPS — it's stateless.
- The only VPS-local state is the WhatsApp QR session (re-scannable), so no backup
  needed there.

---

## 9. Rollback to Render (if ever needed)

Point the `doubts` DNS record back to Render's CNAME and re-add the custom domain
in Render. Same Supabase, same data. The two hosts are interchangeable because the
state is external.

---

## Notes

- **Email:** still optional. Set `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` when ready.
- **Cost:** a small VPS (1–2 GB RAM) runs this comfortably and is always-on — no free
  monthly suspension like Render.
- **Memory:** the Docker build needs ~1 GB free during `vite`/`tsc`. A 1 GB VPS may
  need swap; a 2 GB VPS builds cleanly. You can also build the image elsewhere and
  `docker pull` it if the VPS is tiny.
