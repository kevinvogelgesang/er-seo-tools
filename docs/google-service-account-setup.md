# Google Service Account Setup

This runbook covers the one-time setup and ongoing maintenance of the Google service account used by the SEO Performance Reports feature (C10). The service account lets the app pull GA4 + Search Console data for all clients through a single server-level identity — no per-user OAuth flow, no consent screen, no token expiry.

---

## APIs that must be enabled

In the Google Cloud project that owns the service account, confirm these three APIs are enabled (APIs & Services → Enabled APIs):

| API | Purpose |
|-----|---------|
| **Google Analytics Data API** (`analyticsdata.googleapis.com`) | GA4 `runReport` — sessions, landing pages, queries, device/location breakdowns |
| **Google Analytics Admin API** (`analyticsadmin.googleapis.com`) | List GA4 properties the SA can see (used by the Settings "Test connection" and the client-mapping picker) |
| **Google Search Console API** (`searchconsole.googleapis.com`) | `searchanalytics.query` — clicks, impressions, CTR, average position, top queries |

If any are missing: APIs & Services → Library → search by name → Enable.

---

## 1. Create the service account

1. Cloud Console → IAM & Admin → **Service Accounts** → **Create Service Account**.
2. Name: `er-seo-tools` (or similar). Description: "SEO tools app — GA4 + Search Console read-only".
3. Skip the optional IAM role grants on this screen (the SA needs no project-level roles; access is granted per GA4 property / GSC site in step 4).
4. Click **Done**. Copy the generated email address, e.g. `er-seo-tools@your-project.iam.gserviceaccount.com`.

---

## 2. Download the JSON key

1. Click the SA → **Keys** tab → **Add Key** → **Create new key** → **JSON** → **Create**.
2. A `.json` file downloads automatically. **Store it securely — this is a long-lived credential.**

---

## 3. Place the key file (never commit it)

### Production

```
$DATA_HOME/google-sa.json
```

Set permissions immediately after copying:

```bash
chmod 0600 $DATA_HOME/google-sa.json
```

The file must be owned by the `seo` user. Confirm with `ls -la $DATA_HOME/google-sa.json`.

### Local dev

Create a gitignored directory at the repo root and place the key there:

```
.secrets/google-sa.json
```

`.secrets/` is already in `.gitignore`. Never place the key anywhere else in the repo tree.

---

## 4. Set the environment variable

### Production — `$APP_HOME/.env`

This file is gitignored (same file that holds `APP_AUTH_SECRET`). Add:

```
GOOGLE_SA_KEY_FILE=$DATA_HOME/google-sa.json
```

Optional — add only if/when a CRM adapter is configured:

```
CRM_API_BASE=https://your-crm.example.com/api
```

Restart the app after editing `.env`:

```bash
~/deploy.sh
# or: pm2 reload seo-tools
```

### Local dev — `.env.local` (gitignored)

```
GOOGLE_SA_KEY_FILE=.secrets/google-sa.json
```

### What NOT to put in `ecosystem.config.js`

`ecosystem.config.js` is committed. `GOOGLE_SA_KEY_FILE`, `CRM_API_BASE`, and any other secret must stay in the gitignored `.env`. The file already holds `APP_AUTH_SECRET` as a reminder of this boundary.

### Stale vars to remove

If your `.env` still contains any of these from the abandoned user-OAuth path, remove them — they are no longer used:

```
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_TOKEN_ENC_KEY
```

---

## 5. Per-client access grants (one-time per client)

The service account needs explicit read access to each client's GA4 property and Search Console site. There is no bulk-grant mechanism — this is a per-client, one-time step.

### GA4 property

1. GA4 → **Admin** (bottom-left gear) → select the client's property → **Property Access Management**.
2. Click **+** (Add users) → paste the SA email → role: **Viewer** → **Add**.

### Search Console site

1. Search Console → select the client's site → **Settings** (left nav) → **Users and permissions**.
2. **Add user** → paste the SA email → permission: **Full** (GSC uses Full / Restricted, NOT Viewer).

**Note on GSC permission model:** GSC's access tiers are Full and Restricted — there is no "Viewer" tier as in GA4. "Restricted" hides some properties of the site; "Full" is the read-only-but-complete access the app needs for impression/click data.

### Confirm the grant

Settings → "Test connection" calls the GA4 Admin list and GSC sites list and reports how many properties/sites the SA can see. A newly-added property or site may take a few minutes to appear. If it does not appear after 5 minutes, verify the email address was entered exactly as shown in Settings.

---

## 6. Key rotation

Rotate the key when:
- A key is suspected to be compromised.
- Periodic rotation policy requires it (recommended at least annually).

**Rotation sequence — no auth gap:**

1. Cloud Console → IAM & Admin → Service Accounts → click the SA → **Keys** → **Add Key** → **Create new key** → JSON. Download the new key.
2. Copy the new key file to the server (`scp` or paste via SSH):
   ```bash
   # from local
   scp new-key.json $PROD_SSH:$DATA_HOME/google-sa.json
   ssh $PROD_SSH "chmod 0600 $DATA_HOME/google-sa.json"
   ```
3. Reload the app so it picks up the new file:
   ```bash
   ssh $PROD_SSH "pm2 reload seo-tools"
   # or run: ~/deploy.sh
   ```
4. Confirm it loads: Settings → "Test connection" → should report properties/sites.
5. **Only after confirming:** delete the OLD key in Cloud Console (Keys tab → Delete). Deleting the old key before the new one is live would cause an auth gap.

---

## 7. Security notes

- The key file grants read-only access to GA4 and Search Console for every property/site that has been granted. Keep `0600` permissions.
- The app never logs key material, never returns it to the browser, and never stores it in the database.
- Revoke access at any time by deleting the key in Cloud Console (immediate) or removing the SA from a specific GA4 property / GSC site (removes that client's data access only).
- All `/api/reports`, `/api/google/*`, and `/api/settings` routes are cookie-gated — there are no public endpoints that touch Google credentials.
- `CRM_API_BASE` and any CRM credentials go in `.env` only, never in `metricsJson` snapshots or logs.
