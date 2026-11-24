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

---

## CyberPanel (OpenLiteSpeed) VPS

CyberPanel already uses ports 80/443 and manages SSL, so **don't run Caddy**. Run
the app on localhost:3001 with `docker-compose.cyberpanel.yml` and let a CyberPanel
website reverse-proxy to it.

### 1. DNS
Point `doubts.adwaysacademy.com` as an **A record → your VPS IP**. Remove the old
Render CNAME, and remove the custom domain in Render.

### 2. Create the website in CyberPanel
CyberPanel → **Websites → Create Website**. Domain `doubts.adwaysacademy.com`, pick
an email and a PHP version (PHP is unused but required by the form). Create it.

### 3. Issue SSL
CyberPanel → **SSL → Manage SSL** (or **Issue SSL**) → select the domain → issue a
Let's Encrypt certificate. (Do this after DNS resolves to the VPS.)

### 4. Install Docker (SSH as root)
```bash
curl -fsSL https://get.docker.com | sh
```
Works on the Ubuntu/AlmaLinux base CyberPanel runs on. Check: `docker compose version`.

### 5. Get the code + env
```bash
git clone https://github.com/vijay-pk/Clear-doubt.git
cd Clear-doubt/deploy
cp .env.production.example .env
nano .env          # paste the same Supabase / Groq / ADMIN_SEED values from Render
```

### 6. Build + run the app (localhost only)
```bash
docker compose -f docker-compose.cyberpanel.yml up -d --build
docker compose -f docker-compose.cyberpanel.yml logs -f app   # watch for "API listening"
curl -I http://127.0.0.1:3001/api/health                      # expect 200
```

### 7. Reverse proxy in CyberPanel
CyberPanel → **Websites → List Websites → Manage** the domain → **Reverse Proxy**
(or **Rewrite Rules**). Add a proxy to the app:

- Reverse Proxy manager: Path `/`, Target/Address `http://127.0.0.1:3001` → Save.
- Or in **Rewrite Rules**, add:
  ```
  RewriteEngine On
  RewriteRule ^(.*)$ http://127.0.0.1:3001/$1 [P,L]
  ```

Then restart OpenLiteSpeed (CyberPanel → **Server Status → Restart LiteSpeed**, or
`systemctl restart lsws`).

### 8. Verify
Open `https://doubts.adwaysacademy.com` → sign in as admin. All existing data is there.

### 9. Updates later
```bash
cd Clear-doubt && git pull
cd deploy && docker compose -f docker-compose.cyberpanel.yml up -d --build
```

### Notes for CyberPanel
- Keep the app on **127.0.0.1:3001** (not public) — only LiteSpeed should face the internet.
- Firewall: 80 and 443 open (CyberPanel defaults); 3001 stays internal.
- If the build runs out of memory on a small box, add swap:
  ```bash
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  ```

---

## Oracle Cloud — Always Free VM

A plain Ubuntu VM with no control panel, so we use the **Caddy** compose
(`deploy/docker-compose.yml`), which owns 80/443 and auto-issues HTTPS. Data still
lives in Supabase — nothing is migrated, nothing is lost. Always-on: no Render-style
suspension.

### 1. Create the instance
Oracle Cloud Console → **Menu → Compute → Instances → Create instance**:
- **Image:** Canonical **Ubuntu 22.04**.
- **Shape:** **Ampere (VM.Standard.A1.Flex)** — Always Free eligible, pick **1 OCPU /
  6 GB** (ARM, plenty for the build). If A1 capacity is unavailable in your region,
  use **VM.Standard.E2.1.Micro** (AMD, 1 GB — then add swap).
- **SSH key:** upload your public key (or let Oracle generate one and download it).
- Create. Note the **Public IP address**.

### 2. Open the ports — TWO layers (Oracle's classic gotcha)
**(a) Cloud security list.** Networking → **Virtual Cloud Networks** → your VCN →
the subnet → **Security List** → **Add Ingress Rules**:
- Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port **80**.
- Another: Source `0.0.0.0/0`, **TCP**, port **443**.
(Port 22 is already open.)

**(b) The VM's own firewall.** Oracle's Ubuntu image blocks 80/443 in iptables by
default — open them and save:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```
Both layers are required — miss either and HTTPS/Caddy can't be reached.

### 3. DNS
Point `doubts.adwaysacademy.com` as an **A record → the VM's public IP**. Remove the
old Render CNAME, and remove the custom domain in Render.

### 4. Install Docker (SSH in as `ubuntu`)
```bash
ssh ubuntu@YOUR_VM_IP
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu   # re-login after this
```

### 5. Code + env
```bash
git clone https://github.com/vijay-pk/Clear-doubt.git
cd Clear-doubt/deploy
cp .env.production.example .env
nano .env     # same Supabase / Groq / ADMIN_SEED values from Render
```

### 6. Run (Caddy auto-HTTPS)
```bash
docker compose up -d --build        # the default compose = app + Caddy
docker compose logs -f app
curl -I https://doubts.adwaysacademy.com/api/health   # 200 once DNS + cert are ready
```
Caddy gets the Let's Encrypt certificate automatically once the A record resolves and
ports 80/443 are open on both layers.

### 7. Verify & update
Open `https://doubts.adwaysacademy.com`, sign in as admin — all data is there.
Update later: `git pull && docker compose up -d --build` from `deploy/`.

### Notes for Oracle
- **ARM (A1):** the image is multi-arch and builds fine on arm64 (Node, Prisma,
  argon2, Baileys all have arm64 builds).
- **Micro (1 GB):** add swap before building (`fallocate`/`mkswap` as above).
- The A1 shape is genuinely **always free** (no monthly hour cap like Render free).
