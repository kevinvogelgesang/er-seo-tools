# ER SEO Tools -- Server Setup Guide

Complete step-by-step guide for deploying the seo-tools Next.js application on a fresh RunCloud-managed Ubuntu server.

> **Placeholders.** Host, SSH target, and filesystem paths in this repo are written as shell variables so no server address or layout is committed. Resolve them from the team's internal ops notes (secret store / internal wiki) before running any command here:
>
> | Placeholder | Meaning |
> |---|---|
> | `$PROD_HOST` | Production server hostname / IP |
> | `$PROD_SSH` | SSH target, i.e. `<user>@$PROD_HOST` |
> | `$APP_HOME` | App directory (repo checkout on the server) |
> | `$DATA_HOME` | Data directory (SQLite DB, uploads, reports, backups) |
> | `$LOG_HOME` | Log directory |
> | `$SERVER_HOME` | App user's home directory |
>
> Export them in your shell (e.g. `export PROD_SSH=user@host APP_HOME=/path/...`) and the commands below work as written.

## Server Specs

| Property       | Value                          |
|----------------|--------------------------------|
| IP             | $PROD_HOST                |
| Server name    | seo                            |
| OS             | Ubuntu 24.04 Noble x86_64      |
| CPU            | 2-core DO-Premium-AMD          |
| RAM            | 3.82 GB                        |
| Disk           | 80 GB                          |
| RunCloud Agent | 2.16.1+1                       |

---

## 1. Server Preparation

### 1.1 SSH Access

RunCloud provisions the server with root access. Connect and verify:

```bash
ssh root@$PROD_HOST
```

### 1.2 Create the Application User

RunCloud creates web app users automatically when you add a web application, but the `seo` user needs a home directory with the right structure. If RunCloud has already created the user, skip user creation and just set up directories.

```bash
# If the user does not yet exist (RunCloud will create it when you add the web app):
useradd -m -s /bin/bash seo

# Set a password (or use SSH keys only)
passwd seo

# Allow seo to read system logs if needed
usermod -aG adm seo
```

### 1.3 Install Node.js 22 LTS

Use NodeSource for a system-wide install (RunCloud expects Node available globally):

```bash
# Install NodeSource repo for Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -

# Install Node.js
apt-get install -y nodejs

# Verify
node -v   # Should show v22.x.x
npm -v    # Should show 10.x.x
```

> **Note:** RunCloud may have installed a different Node version. Check with `which node` and `node -v` first. If RunCloud's Node is older, the NodeSource install will replace it.

### 1.4 Install Google Chrome

The ADA audit feature requires headless Chrome (puppeteer-core connects to it). The app expects Chrome at `/usr/bin/google-chrome`.

```bash
# Install dependencies
apt-get update
apt-get install -y wget gnupg2

# Add Google Chrome repo
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

# Install Chrome
apt-get update
apt-get install -y google-chrome-stable

# Verify
google-chrome --version
which google-chrome   # Should be /usr/bin/google-chrome
```

### 1.5 Create Directory Structure

```bash
# App code (RunCloud may create this when you add the web app)
mkdir -p $APP_HOME

# Persistent data (outside the app directory so deploys don't touch it)
mkdir -p $DATA_HOME/uploads

# PM2 logs
mkdir -p $LOG_HOME

# Set ownership
chown -R seo:seo $SERVER_HOME/webapps
chown -R seo:seo $SERVER_HOME/data
chown -R seo:seo $LOG_HOME
```

---

## 2. System Tuning

### 2.1 Swap File (4 GB)

With 3.82 GB RAM, headless Chrome can cause OOM under load. A swap file provides a safety net.

```bash
# Create 4 GB swap file
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Make it permanent
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Verify
swapon --show
free -h
```

### 2.2 Swappiness

Set low swappiness so the kernel prefers RAM and only uses swap under pressure:

```bash
# Set immediately
sysctl vm.swappiness=10

# Make permanent
echo 'vm.swappiness=10' >> /etc/sysctl.conf
```

### 2.3 File Descriptor Limits

Next.js + Chrome + SQLite can hit the default 1024 limit. Raise it:

```bash
cat >> /etc/security/limits.conf << 'EOF'
seo soft nofile 65536
seo hard nofile 65536
root     soft nofile 65536
root     hard nofile 65536
EOF
```

Also set for systemd services (PM2 runs under systemd):

```bash
mkdir -p /etc/systemd/system/user@.service.d
cat > /etc/systemd/system/user@.service.d/nofile.conf << 'EOF'
[Service]
LimitNOFILE=65536
EOF

systemctl daemon-reload
```

### 2.4 Kernel Dirty Page Settings

Optimize for SQLite write patterns (WAL mode) on SSD:

```bash
cat >> /etc/sysctl.conf << 'EOF'
# Flush dirty pages sooner — better for SQLite WAL
vm.dirty_ratio = 10
vm.dirty_background_ratio = 5
vm.dirty_expire_centisecs = 1000
vm.dirty_writeback_centisecs = 500
EOF

sysctl -p
```

---

## 3. RunCloud Web App Setup

### 3.1 Create the Web Application

1. Log in to RunCloud dashboard
2. Go to the **seo** server
3. Click **Web Application** > **Create Web Application**
4. Settings:
   - **Web Application Name:** seo-tools
   - **Domain:** your-domain.com (or subdomain)
   - **User:** seo
   - **Web Application Stack:** **Native NGINX + Custom Config**
   - **Node.js version:** 22 (if RunCloud asks)
   - **Web Application Root:** `$APP_HOME`

### 3.2 Connect Git Repository

1. In the web app settings, go to **Git**
2. Select **Git Repository** deployment
3. Connect to your GitHub account if not already connected
4. Select the `er-seo-tools` repository
5. Branch: `main`
6. Deploy path: `$APP_HOME`

### 3.3 SSL Certificate

1. Go to the web app > **SSL/TLS**
2. Select **Let's Encrypt**
3. Enter the domain name
4. Enable **HTTP/3 (QUIC)** if available in RunCloud's UI
5. Enable **Force HTTPS** redirect

> **RunCloud gotcha:** Let's Encrypt requires the domain's DNS A record to point to `$PROD_HOST` before requesting the certificate. Set up DNS first, wait for propagation, then request the cert.

---

## 4. NGINX Configuration

RunCloud provides several config sections for each web app. You enter these through the RunCloud dashboard under the web app's **NGINX Config** settings.

### 4.1 Reverse Proxy to Next.js

This is the core reverse proxy configuration. It forwards requests to the Next.js process running on port 3000.

1. In the web app's NGINX Config section, click **Add Config**
2. For **Predefined Config**, select **"NGINX Reverse Proxy"** — this places the config in the correct context
3. Replace the template content with:

```nginx
proxy_pass http://127.0.0.1:3000;

proxy_buffering off;

proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Host $host;

proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";

proxy_request_buffering on;
proxy_connect_timeout 5s;
proxy_read_timeout 300s;
proxy_send_timeout 60s;
client_max_body_size 50m;
```

> **Why 300s read timeout:** Site audits can take several minutes. The polling architecture means the browser doesn't hold a single long request open, but the initial POST that kicks off a large site audit can take a while to respond with the created record.

> **Why `proxy_buffering off`:** Ensures polling responses arrive immediately without NGINX buffering delays.

> **RunCloud gotcha:** Do not use `location.main` or `location.main-before` config types for `proxy_pass` — they are not valid contexts for that directive. Always use the **"NGINX Reverse Proxy"** predefined config.

### 4.2 headers (Security Headers)

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
```

### 4.3 RunCloud-Specific Notes

- **Do not use the "Hybrid Apache + NGINX" stack.** The app is Node.js only -- there is no PHP, no .htaccess. Native NGINX is simpler and faster.
- **RunCloud Supervisor:** RunCloud may try to manage the Node process with its built-in Supervisor. We use PM2 instead (see Section 6). Disable RunCloud's Supervisor for this app if it creates one.
- **Config reload:** After editing NGINX config in RunCloud, it automatically reloads NGINX. You can also force it: `ssh root@$PROD_HOST "systemctl reload nginx"`.

---

## 5. App Deployment (First Time)

All commands run as the `seo` user unless noted:

```bash
ssh $PROD_SSH
```

### 5.1 Clone the Repository

If RunCloud's Git integration already cloned the repo, skip this step.

```bash
cd $SERVER_HOME/webapps
git clone git@github.com:Enrollment-Resources/er-seo-tools.git er-seo-tools
cd er-seo-tools
```

### 5.2 Install Dependencies

```bash
cd $APP_HOME
npm install
```

> **Important:** Always use `npm install`, never `npm ci`. RunCloud environments may have slight lockfile differences, and `npm ci` will fail.

### 5.3 Environment Variables

Create the `.env` file:

```bash
cat > $APP_HOME/.env << 'EOF'
DATABASE_URL=file:$DATA_HOME/db.sqlite
UPLOADS_DIR=$DATA_HOME/uploads
PORT=3000
NEXT_PUBLIC_APP_URL=https://your-domain.com
CHROME_EXECUTABLE=/usr/bin/google-chrome
PAGESPEED_API_KEY=
EOF
```

Replace `https://your-domain.com` with the actual domain. This is used for generating share links (ADA audit reports).

> `PAGESPEED_API_KEY` raises the PageSpeed Insights quota from keyless (limited) to 25,000/day. Optional — leave empty if not yet provisioned. Must be set before the first deploy that runs with `LIGHTHOUSE_PROVIDER=pagespeed` if you want the higher quota.

### 5.4 Database Setup

```bash
cd $APP_HOME

# Generate Prisma client
DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma generate

# Run all migrations (creates the SQLite database if it doesn't exist)
DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate deploy
```

> **Note:** We pass `DATABASE_URL` inline because Prisma CLI reads from the environment, and the `.env` file may not be loaded in all contexts. Belt and suspenders.

### 5.5 Build

```bash
cd $APP_HOME
npm run build
```

This runs `next build` and produces the `.next` production output.

---

## 6. PM2 Setup

PM2 replaces the old `nohup npm start` approach. It provides automatic restarts, log management, and systemd integration.

### 6.1 Install PM2

```bash
# As root (or with sudo)
npm install -g pm2
```

### 6.2 Create ecosystem.config.js

The repo ships a working `ecosystem.config.js` at the project root. Paths are derived from `APP_HOME` / `DATA_HOME` / `LOG_HOME` env vars with sane defaults that match this VPS layout:

```js
const APP_HOME = process.env.APP_HOME || '$APP_HOME'
const DATA_HOME = process.env.DATA_HOME || '$DATA_HOME'
const LOG_HOME = process.env.LOG_HOME || '$LOG_HOME'
```

So `git pull` already gives you a usable file — no need to overwrite it. If you ever deploy to a host with a different layout, export those three env vars before `pm2 start ecosystem.config.js` and PM2 will pick them up.

```bash
chown seo:seo $APP_HOME/ecosystem.config.js
```

> **Why fork mode, not cluster:** The app uses a singleton browser pool (headless Chrome) and a global audit queue. Cluster mode would create multiple Node processes, each with its own singleton -- breaking the "one audit at a time" invariant and potentially spawning too many Chrome instances.

> **Why 2400M max_memory_restart:** Node typically uses ~1.0-1.5 GB during Lighthouse trace processing; Chrome resident ~300-600 MB at pool size 2. The 2026-05-14 fei.edu incident proved that 1200M tripped legitimate per-page peaks at concurrency=1 and caused mid-audit SIGKILLs. 2400M leaves headroom for the trace-time spike while still catching genuine leaks. The 2 GB swap below this is the kernel-level safety net.

> **kill_timeout: 10000:** Gives the SIGTERM handler in `instrumentation.ts` enough time to call `closeBrowser()` and cleanly shut down Chrome before PM2 sends SIGKILL.

### 6.3 Start the App

```bash
# As seo user
cd $APP_HOME
pm2 start ecosystem.config.js

# Verify it's running
pm2 status
pm2 logs seo-tools --lines 20
```

### 6.4 Enable Startup on Boot

```bash
# Generate the systemd startup script (run as seo, it will tell you to run a sudo command)
pm2 startup systemd

# PM2 will print something like:
#   sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u seo --hp $SERVER_HOME
# Run that command as root.

# Then save the current process list
pm2 save
```

### 6.5 Log Rotation

```bash
pm2 install pm2-logrotate

# Configure: 50 MB max per file, keep 5 rotations
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 5
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

### 6.6 Disable RunCloud Supervisor

If RunCloud created a Supervisor config for this app:

1. Go to RunCloud dashboard > **seo** server > **seo-tools** web app > **Process Manager** (or **Supervisor**)
2. Disable or delete the Supervisor entry
3. Or from the command line:

```bash
# Check if supervisor is managing anything for this app
supervisorctl status | grep seo

# If found, stop and remove it
supervisorctl stop seo:*
# Then remove the config from RunCloud's UI to prevent it from recreating on next deploy
```

---

## 7. Deploy Workflow

After making changes locally:

### 7.1 Standard Deploy

```bash
# 1. Push code to GitHub
git push

# 2. Deploy to server (one-liner)
ssh $PROD_SSH "cd $APP_HOME && git pull && npm install && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma generate && npm run build && pm2 stop seo-tools && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate deploy && pm2 start seo-tools"
```

What each step does:
1. `git pull` -- fetch latest code from GitHub
2. `npm install` -- install any new/updated dependencies
3. `npx prisma generate` -- regenerate Prisma client (needed if schema changed)
4. `npm run build` -- rebuild the Next.js production bundle
5. `pm2 stop seo-tools` -- stop app before migration to avoid SQLite lock errors
6. `npx prisma migrate deploy` -- apply any new database migrations
7. `pm2 start seo-tools` -- start the app fresh

### 7.2 Quick Restart (No Code Changes)

```bash
ssh $PROD_SSH "pm2 restart seo-tools"
```

### 7.3 Deploy with Logs (Debug a Bad Deploy)

```bash
ssh $PROD_SSH "cd $APP_HOME && git pull && npm install && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma generate && npm run build && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate deploy && pm2 restart seo-tools && sleep 3 && pm2 logs seo-tools --lines 50 --nostream"
```

---

## 8. Monitoring & Maintenance

### 8.1 PM2 Monitoring

```bash
# Live dashboard (CPU, memory, logs)
pm2 monit

# Process status
pm2 status

# Tail logs
pm2 logs seo-tools

# Last 100 lines without following
pm2 logs seo-tools --lines 100 --nostream

# Just error logs
pm2 logs seo-tools --err --lines 50 --nostream
```

### 8.2 System Health Checks

```bash
# Swap usage
swapon --show
free -h

# Check if Chrome is running (should only be present during active audits)
ps aux | grep chrome

# Disk usage
df -h /
du -sh $DATA_HOME/

# CPU and memory overview
htop   # or: top -bn1 | head -20
```

### 8.3 SQLite Health

```bash
# Integrity check
sqlite3 $DATA_HOME/db.sqlite 'PRAGMA integrity_check;'

# Check WAL file size (large WAL = writes not checkpointing)
ls -lh $DATA_HOME/db.sqlite*

# Force WAL checkpoint if needed
sqlite3 $DATA_HOME/db.sqlite 'PRAGMA wal_checkpoint(TRUNCATE);'

# Database size
sqlite3 $DATA_HOME/db.sqlite 'SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();'
```

### 8.4 Chrome /tmp Cleanup Cron

Headless Chrome can leave temporary files in /tmp that accumulate over time. Set up a daily cleanup:

```bash
# As root
crontab -e
```

Add:

```cron
# Clean up stale Chrome temp files older than 1 day (runs at 3 AM)
0 3 * * * find /tmp -maxdepth 1 -name '.com.google.Chrome.*' -mtime +1 -exec rm -rf {} + 2>/dev/null
0 3 * * * find /tmp -maxdepth 1 -name 'puppeteer_dev_chrome_profile-*' -mtime +1 -exec rm -rf {} + 2>/dev/null
```

### 8.5 WAL File Monitoring

If the WAL file grows very large (hundreds of MB), it means SQLite is not checkpointing. Add a weekly check:

```bash
# As seo user
crontab -e
```

Add:

```cron
# Checkpoint SQLite WAL every Sunday at 4 AM
0 4 * * 0 sqlite3 $DATA_HOME/db.sqlite 'PRAGMA wal_checkpoint(PASSIVE);' 2>/dev/null
```

### 8.6 Backup

Back up the SQLite database regularly. Since it uses WAL mode, use `.backup` for a consistent snapshot:

```bash
# Manual backup
sqlite3 $DATA_HOME/db.sqlite ".backup $DATA_HOME/backups/db-$(date +%Y%m%d).sqlite"
```

Automated daily backup cron (as seo):

```cron
# Daily SQLite backup at 2 AM, keep last 7 days
0 2 * * * mkdir -p $DATA_HOME/backups && sqlite3 $DATA_HOME/db.sqlite ".backup $DATA_HOME/backups/db-$(date +\%Y\%m\%d).sqlite" && find $DATA_HOME/backups -name 'db-*.sqlite' -mtime +7 -delete 2>/dev/null
```

The DB snapshot alone is not a full backup. Any file-level or volume backup
must also cover the persistent file stores under `$DATA_HOME`:
`uploads` (analyzed CSVs), `reports` (branded PDFs), `sales-hero`
(prospect hero screenshots), and `viewbook-assets` (client viewbook
logos/heroes/team photos — user-uploaded, not regenerable from the DB).
`screenshots` is transient (swept every 30 min) and can be excluded.

---

## 9. Troubleshooting

### 9.1 App Won't Start

```bash
# Check PM2 status
pm2 status

# Check logs for errors
pm2 logs seo-tools --lines 50 --nostream

# Verify the build exists
ls -la $APP_HOME/.next/

# Verify port 3000 is not already in use
ss -tlnp | grep 3000

# Try starting manually to see errors in real-time
cd $APP_HOME
NODE_ENV=production DATABASE_URL='file:$DATA_HOME/db.sqlite' npx next start
```

### 9.2 502 Bad Gateway from NGINX

This means NGINX cannot reach the Node process on port 3000.

```bash
# Is the app running?
pm2 status

# Is anything listening on port 3000?
ss -tlnp | grep 3000

# Check NGINX error log
tail -50 /var/log/nginx/seo-tools-error.log

# Restart the app
pm2 restart seo-tools
```

### 9.3 OOM Kills (Out of Memory)

Symptoms: app crashes randomly, especially during site audits.

```bash
# Check if OOM killer acted
dmesg | grep -i "out of memory" | tail -10
dmesg | grep -i "oom" | tail -10

# Check PM2 restart count (high count = repeated crashes)
pm2 status

# Check current memory
free -h

# Check Chrome processes (should be max 2 pages worth)
ps aux | grep chrome | grep -v grep | wc -l

# Nuclear option: kill all Chrome processes
pkill -f chrome
pm2 restart seo-tools
```

**Prevention:**
- The `max_memory_restart: '2400M'` in PM2 config will restart the app before it exhausts RAM
- Browser pool size is 2 (default) -- do not increase without adding more RAM
- The swap file provides a buffer, but persistent swapping means you need more RAM

### 9.4 Stale Audits (Stuck in "Running")

The app has built-in stale audit recovery (`resetStaleAudits()` runs every 10 min and on startup). If audits are stuck:

```bash
# Restart the app -- startup recovery will re-queue pending audits and error stale ones
pm2 restart seo-tools

# If that doesn't help, check the database directly
sqlite3 $DATA_HOME/db.sqlite "SELECT id, status, progress, updatedAt FROM AdaAudit WHERE status IN ('running', 'pending') ORDER BY updatedAt DESC LIMIT 10;"
sqlite3 $DATA_HOME/db.sqlite "SELECT id, status, progress, updatedAt FROM SiteAudit WHERE status IN ('running', 'queued') ORDER BY updatedAt DESC LIMIT 10;"

# Manually error a stuck audit (replace <ID> with the actual ID)
sqlite3 $DATA_HOME/db.sqlite "UPDATE AdaAudit SET status='error', errorMessage='Manually reset - stuck audit' WHERE id='<ID>';"
sqlite3 $DATA_HOME/db.sqlite "UPDATE SiteAudit SET status='error', errorMessage='Manually reset - stuck audit' WHERE id='<ID>';"
```

### 9.5 Chrome Won't Launch

```bash
# Verify Chrome is installed
google-chrome --version

# Test headless launch
google-chrome --headless --disable-gpu --no-sandbox --dump-dom https://example.com 2>&1 | head -5

# Check for missing shared libraries
ldd /usr/bin/google-chrome | grep "not found"

# Install missing dependencies
apt-get install -y libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2t64
```

### 9.6 Prisma Migration Fails

```bash
# Check migration status
cd $APP_HOME
DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate status

# If a migration is marked as failed, you may need to resolve it:
DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate resolve --applied <migration_name>
```

### 9.7 Disk Space Issues

```bash
# What's using space?
du -sh $DATA_HOME/*
du -sh $LOG_HOME/*
du -sh /tmp/*

# Clean PM2 logs manually
pm2 flush

# Clean old Next.js build cache
rm -rf $APP_HOME/.next/cache

# Clean npm cache
npm cache clean --force
```

### 9.8 Process Restart Loop

If PM2 shows the app restarting repeatedly (high restart count):

```bash
# Check error logs for the crash reason
pm2 logs seo-tools --err --lines 100 --nostream

# Reset restart count after fixing the issue
pm2 reset seo-tools
```

---

## Quick Reference

### Key Paths

| Path | Purpose |
|------|---------|
| `$APP_HOME` | Application code |
| `$APP_HOME/.env` | Environment variables |
| `$APP_HOME/ecosystem.config.js` | PM2 configuration |
| `$DATA_HOME/db.sqlite` | SQLite database |
| `$DATA_HOME/uploads` | File uploads |
| `$DATA_HOME/reports` | Branded PDF reports |
| `$DATA_HOME/sales-hero` | Prospect hero screenshots |
| `$DATA_HOME/viewbook-assets` | Client viewbook assets (logos, heroes, team photos) |
| `$DATA_HOME/backups` | Database backups |
| `$LOG_HOME/seo-tools-out.log` | PM2 stdout log |
| `$LOG_HOME/seo-tools-error.log` | PM2 stderr log |
| `/usr/bin/google-chrome` | Chrome executable |

### Key Commands

```bash
# Deploy
ssh $PROD_SSH "cd $APP_HOME && git pull && npm install && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma generate && npm run build && pm2 stop seo-tools && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate deploy && pm2 start seo-tools"

# Quick restart
ssh $PROD_SSH "pm2 restart seo-tools"

# Check status
ssh $PROD_SSH "pm2 status && free -h && df -h /"

# Tail logs
ssh $PROD_SSH "pm2 logs seo-tools --lines 50"

# Check database health
ssh $PROD_SSH "sqlite3 $DATA_HOME/db.sqlite 'PRAGMA integrity_check;'"
```

### Environment Variables

| Variable | Example Value | Purpose |
|----------|---------------|---------|
| `DATABASE_URL` | `file:$DATA_HOME/db.sqlite` | Prisma SQLite connection |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` | Share link URL generation |
| `UPLOADS_DIR` | `$DATA_HOME/uploads` | File upload directory |
| `PORT` | `3000` | Next.js listen port |
| `CHROME_EXECUTABLE` | `/usr/bin/google-chrome` | Headless Chrome path |
| `BROWSER_POOL_SIZE` | `4` | Max concurrent Chrome pages (default 4, do not increase without more RAM) |
| `SITE_AUDIT_CONCURRENCY` | `2` | Concurrent pages inside one site audit; raising past 2 on 2-vCPU hosts hurts more than it helps |
| `SITE_AUDIT_BROWSER_RECYCLE_PAGES` | `15` | Restart Chrome after this many site-audit pages to reclaim browser memory |
| `LIGHTHOUSE_PROVIDER` | `pagespeed` | `pagespeed` (default in prod), `local`, or `off` |
| `PAGESPEED_API_KEY` | (none) | Google Cloud key for PageSpeed Insights API; raises quota from keyless to 25k/day |
| `PSI_CONCURRENCY` | `6` | Max concurrent PageSpeed Insights HTTP fetches during a site audit. Cheap (I/O-bound). Raising hits Google's PSI rate limit before local resources matter. |
| `NODE_ENV` | `production` | Set by PM2 config |
