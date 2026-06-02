# Audit Throughput Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double per-site audit throughput by running two pages in parallel inside a single site audit and giving the browser pool the slots to support it. **This PR is gated on the audit-stability PR shipping first and proving that audits run to completion under concurrency=1.**

**Architecture:** Config-only changes in `ecosystem.config.js`. The two parsers (`BROWSER_POOL_SIZE`, `SITE_AUDIT_CONCURRENCY`) already read these env vars and have unit-test coverage for clamping; this PR only changes the production values.

**Tech Stack:** PM2 · Node 22 · puppeteer-core + Chrome

**Companion PRs:**
- **Required predecessor:** `docs/superpowers/plans/2026-05-14-audit-stability.md` — must be merged and observed in production before this PR is opened.
- **Recommended predecessor:** `docs/superpowers/plans/2026-05-14-live-audit-page.md` — gives us per-page timing visibility that makes the post-deploy verification step meaningful.

---

## Pre-flight gate (must hold before opening this PR)

Open this PR **only after** all of these are true on production AND the observed numbers have been **captured verbatim** into a local file that will be pasted into the PR body. Don't rubber-stamp this gate — each line must be backed by a saved sample.

- [ ] The audit-stability PR has been merged and deployed.
- [ ] At least **3 site audits ≥ 20 pages each** have run end-to-end with **no PM2 restarts** between enqueue and completion.
- [ ] During those runs, peak Node-process memory (from `pm2 list` `mem` column) stayed **under 2.0 GB** and peak total system memory (from `free -m` `used` column) stayed **under 2.8 GB**, both observed by sampling at least once per minute during the audit.
- [ ] No `Audit timed out (server may have restarted)` errors and no `Audit interrupted (server restarted)` errors in the 3 runs.

If any of these fail, **do not open this PR**. Open a stability follow-up instead — the throughput tuning will only make instability worse.

Task 1 below produces a file `/tmp/throughput-preflight.md` containing the actual numbers. Task 7's PR body embeds that file verbatim. No paraphrasing.

---

## Why these specific values

| Knob | Stability baseline | New | Why |
|---|---|---|---|
| `BROWSER_POOL_SIZE` | `2` | `4` | Concurrency=2 needs two slots in flight, one slot recycling, one warm slot. At ~150 MB resident per Chrome page = ~600 MB total. |
| `SITE_AUDIT_CONCURRENCY` | `1` | `2` | Doubles intra-site throughput. 2 vCPUs on the VPS means both Lighthouse runs share the cores — per-page time may rise modestly, total wall-clock should ~halve. |
| `SITE_AUDIT_BROWSER_RECYCLE_PAGES` | `15` | `15` | **Unchanged.** The stability PR already lowered this; no further tightening needed at concurrency=2. |
| `max_memory_restart` (PM2) | `2400M` | `2400M` | **Unchanged.** The stability PR raised this to a level that already accommodates concurrency=2. |
| `NODE_OPTIONS --max-old-space-size` | `2048` | `2048` | **Unchanged.** |

Expected peak resident: Node ~1.6–2.0 GB, Chrome ~1.0–1.2 GB at pool size 4, total system ~2.6–3.2 GB. 2 GB swap remains as safety net.

## Why we resist going further

- **`SITE_AUDIT_CONCURRENCY=3+` on 2 vCPUs.** Lighthouse is CPU-bound during trace processing. Three concurrent runs compete for the same two cores; per-page latency variance spikes and the throughput gain disappears or inverts. 2 is the sweet spot for this hardware until we add a vCPU or move to a bigger box.
- **`BROWSER_POOL_SIZE=6+`.** Unused slots are resident memory we're paying for. Two concurrent + one recycling + one warm is enough buffer.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `ecosystem.config.js` | Modify | Update `BROWSER_POOL_SIZE` and `SITE_AUDIT_CONCURRENCY` only |
| `CLAUDE.md` | Modify | Update the concurrency / pool-size bullet |
| `docs/SERVER_SETUP.md` | Modify | Update the env-var table rows for the two changed knobs |

No code changes. No new files. No tests to write — the parsers and the queue code are already covered.

---

### Task 1: Confirm the pre-flight gate AND capture evidence to `/tmp/throughput-preflight.md`

**Files:**
- Create: `/tmp/throughput-preflight.md` (local-only; not committed; pasted into PR body in Task 7)

Each step appends its actual command output to the file. Don't paraphrase — paste raw output. The final PR body embeds this file verbatim.

- [ ] **Step 1: Initialize the evidence file**

```bash
date -u > /tmp/throughput-preflight.md
echo '' >> /tmp/throughput-preflight.md
echo '## Pre-flight evidence' >> /tmp/throughput-preflight.md
```

- [ ] **Step 2: Confirm stability PR is merged on main**

```bash
git checkout main && git pull origin main
echo '' >> /tmp/throughput-preflight.md
echo '### Stability PR landed on main' >> /tmp/throughput-preflight.md
echo '```' >> /tmp/throughput-preflight.md
git log --oneline | grep -iE 'audit-stability|stability fixes' | head -3 >> /tmp/throughput-preflight.md
echo '```' >> /tmp/throughput-preflight.md
```

Expected: at least one matching commit. If the file shows no matching commit, **abort** — the stability PR is not landed yet.

- [ ] **Step 3: Capture PM2 status (no recent restarts)**

```bash
echo '' >> /tmp/throughput-preflight.md
echo '### PM2 status (expect: no recent restarts, uptime in days)' >> /tmp/throughput-preflight.md
echo '```' >> /tmp/throughput-preflight.md
ssh seo@144.126.213.242 "pm2 describe seo-tools | grep -E 'restarts|uptime|created at|max_memory'" >> /tmp/throughput-preflight.md
echo '```' >> /tmp/throughput-preflight.md
```

Inspect the file. `restarts` should be 0 since the stability deploy (or whatever number it was at deploy time — should not have grown). `uptime` should be days, not minutes. If either fails, **abort**.

- [ ] **Step 4: Capture recent site audits with their wall-clock and per-page stats**

```bash
echo '' >> /tmp/throughput-preflight.md
echo '### Recent site audits (expect: 3+ complete, pagesTotal ≥ 20, no timeout errors)' >> /tmp/throughput-preflight.md
echo '```' >> /tmp/throughput-preflight.md
ssh seo@144.126.213.242 "cd /home/seo/webapps/seo-tools && node -e \"
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const recent = await p.siteAudit.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 48*60*60*1000) } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { domain:1, status:1, pagesTotal:1, pagesComplete:1, pagesError:1, createdAt:1, updatedAt:1, error:1 }
  });
  for (const a of recent) {
    const minutes = (a.updatedAt.getTime() - a.createdAt.getTime()) / 60000;
    const line = [
      a.status.padEnd(10),
      a.domain.padEnd(35),
      'pages=' + a.pagesComplete + '/' + a.pagesTotal,
      'err=' + a.pagesError,
      'minutes=' + minutes.toFixed(1),
      a.error ? '|| ' + a.error.slice(0,60) : ''
    ].join(' ');
    console.log(line);
  }
  await p.\\\\\$disconnect();
})();
\"" >> /tmp/throughput-preflight.md
echo '```' >> /tmp/throughput-preflight.md
```

Inspect the file. Look for at least 3 rows with `status=complete` and `pages=X/Y` where Y ≥ 20. None should have `Audit timed out (server may have restarted)` or `Audit interrupted (server restarted)` in the error column. If fewer than 3 qualify, **abort** and queue more audits before retrying.

- [ ] **Step 5: Capture peak memory during a current/recent audit**

If a fresh audit is running or has just finished, capture peak memory from `pm2 list`. If nothing is running, queue a known ~30-page site (e.g. fei.edu) yourself and sample during it.

```bash
echo '' >> /tmp/throughput-preflight.md
echo '### Memory peak observation' >> /tmp/throughput-preflight.md
echo '```' >> /tmp/throughput-preflight.md
ssh seo@144.126.213.242 "for i in \$(seq 1 8); do
  echo \"--- sample \$i ---\"
  pm2 list | grep -E 'name|seo-tools'
  free -m | awk '/^Mem:/{print \"  system used: \" \$3 \"M of \" \$2 \"M\"}'
  echo
  sleep 30
done" >> /tmp/throughput-preflight.md
echo '```' >> /tmp/throughput-preflight.md
```

This produces 8 samples over 4 minutes — enough to capture peak during a single Lighthouse run. Inspect the file:
- Node `mem` column from `pm2 list` should peak **under 2.0 GB**.
- `system used` should peak **under 2.8 GB**.

If either ceiling is breached, **abort** — the throughput PR would push it over. Open a stability follow-up first.

- [ ] **Step 6: Final gate decision — record verdict in the file**

```bash
echo '' >> /tmp/throughput-preflight.md
echo '### Gate verdict' >> /tmp/throughput-preflight.md
echo '- Stability PR landed: [yes/no]' >> /tmp/throughput-preflight.md
echo '- ≥3 clean audits with pagesTotal ≥ 20: [yes/no — and which]' >> /tmp/throughput-preflight.md
echo '- Peak Node mem under 2.0 GB: [yes/no — peak observed: X GB]' >> /tmp/throughput-preflight.md
echo '- Peak system mem under 2.8 GB: [yes/no — peak observed: X GB]' >> /tmp/throughput-preflight.md
echo '- No timeout/interrupted errors in window: [yes/no]' >> /tmp/throughput-preflight.md
```

Now open `/tmp/throughput-preflight.md` in your editor and fill in each `[yes/no]` honestly against the data above. If any line is `no`, **stop here**.

- [ ] **Step 7: Read the whole file back for sanity**

```bash
cat /tmp/throughput-preflight.md
```

Verify it's coherent — each section has actual output, the verdict matches the data. This is what will appear in the PR body. If it reads thin, go back and run the relevant step again.

---

### Task 2: Branch + working tree

**Files:** none

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b chore/audit-throughput
```

---

### Task 3: Update `ecosystem.config.js`

**Files:**
- Modify: `ecosystem.config.js`

- [ ] **Step 1: Read current values**

```bash
grep -nE 'BROWSER_POOL_SIZE|SITE_AUDIT_CONCURRENCY' ecosystem.config.js
```

Expected (post-stability-PR):
```
BROWSER_POOL_SIZE: '2',
SITE_AUDIT_CONCURRENCY: '1',
```

- [ ] **Step 2: Apply the two changes**

In `ecosystem.config.js`, change exactly these two values (leave `max_memory_restart`, `NODE_OPTIONS`, `SITE_AUDIT_BROWSER_RECYCLE_PAGES` alone — already correct from stability PR):

```javascript
      BROWSER_POOL_SIZE: '4',
      SITE_AUDIT_CONCURRENCY: '2',
```

- [ ] **Step 3: Verify config still parses**

```bash
node -e "console.log(JSON.stringify(require('./ecosystem.config.js'), null, 2))"
```

Expected: prints full config with the two changed values, plus stability-PR values for `max_memory_restart=2400M`, `NODE_OPTIONS --max-old-space-size=2048`, `SITE_AUDIT_BROWSER_RECYCLE_PAGES=15`. No throw.

- [ ] **Step 4: Commit**

```bash
git add ecosystem.config.js
git commit -m "chore(perf): raise audit concurrency to 2 + browser pool to 4"
```

---

### Task 4: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Locate the concurrency / pool bullet**

```bash
grep -nE 'concurrency|BROWSER_POOL_SIZE|browser pool' CLAUDE.md
```

- [ ] **Step 2: Update**

Find the bullet describing audit concurrency and pool size. Update to:

```markdown
- Site audits discover pages via robots.txt `Sitemap:` directives → `/sitemap.xml` → `/sitemap_index.xml` → `/wp-sitemap.xml` → `.xml.gz` → shallow crawl fallback; hard cap 1000 pages; per-site concurrency = 2 (configurable via `SITE_AUDIT_CONCURRENCY`), browser pool size = 4 (configurable via `BROWSER_POOL_SIZE`), Chrome recycles every 15 pages within a site audit
```

Also update the "Do not" bullet:

```markdown
- Increase `BROWSER_POOL_SIZE` above 4 without first checking VPS memory headroom — each page ~150 MB resident
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): align audit concurrency + pool defaults with throughput tuning"
```

---

### Task 5: Update `docs/SERVER_SETUP.md`

**Files:**
- Modify: `docs/SERVER_SETUP.md`

- [ ] **Step 1: Update the env-variable table rows**

Find rows for `BROWSER_POOL_SIZE` and `SITE_AUDIT_CONCURRENCY`. Update example values and notes:

```markdown
| `BROWSER_POOL_SIZE` | `4` | Max concurrent Chrome pages (default 4, do not increase without more RAM) |
| `SITE_AUDIT_CONCURRENCY` | `2` | Concurrent pages inside one site audit; raising past 2 on 2-vCPU hosts hurts more than it helps |
```

`SITE_AUDIT_BROWSER_RECYCLE_PAGES`, `NODE_OPTIONS`, and `max_memory_restart` rows are unchanged (already correct from stability PR).

- [ ] **Step 2: Commit**

```bash
git add docs/SERVER_SETUP.md
git commit -m "docs(server-setup): document the new concurrency + pool defaults"
```

---

### Task 6: Verify lint + tests + build

**Files:** none

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Full test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS (no new tests introduced).

- [ ] **Step 3: Production build**

```bash
rm -rf .next && npm run build
```

Expected: clean build.

---

### Task 7: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin chore/audit-throughput
```

- [ ] **Step 2: Open the PR with the captured evidence embedded verbatim**

The PR body has two parts: the standard summary AND the raw `/tmp/throughput-preflight.md` contents from Task 1. Use a here-doc that interpolates the file:

```bash
gh pr create --title "chore(perf): raise audit concurrency to 2 + browser pool to 4" --body "$(cat <<EOF
## Summary
Doubles per-site audit throughput by running two pages in parallel inside one site audit, with the browser pool sized to support it. Gated on the audit-stability PR having shipped and observed stable in production.

## Values changed (all in \`ecosystem.config.js\`)

| Knob | Was | Now |
|---|---|---|
| \`BROWSER_POOL_SIZE\` | \`2\` | \`4\` |
| \`SITE_AUDIT_CONCURRENCY\` | \`1\` | \`2\` |

Other knobs (\`max_memory_restart=2400M\`, \`NODE_OPTIONS --max-old-space-size=2048\`, \`SITE_AUDIT_BROWSER_RECYCLE_PAGES=15\`) are unchanged — already at correct values from the stability PR.

Expected peak resident memory: ~2.6–3.2 GB total (Node ~1.6 GB + Chrome ~1.2 GB at pool size 4 + system). 2 GB swap stays as safety net.

## Pre-flight gate — observed evidence

The following is the verbatim contents of \`/tmp/throughput-preflight.md\`, captured during Task 1 of the throughput-tuning plan. Each \`yes\` in the verdict section is backed by command output above it.

$(cat /tmp/throughput-preflight.md)

## Why not push concurrency higher
The VPS has 2 vCPUs. Lighthouse is CPU-bound during trace processing. Going beyond \`SITE_AUDIT_CONCURRENCY=2\` means runs compete for the same cores and per-page time variance spikes — the throughput gain disappears. 2 is the sweet spot for this hardware.

## Deploy mechanics
The deploy must use \`pm2 delete seo-tools && pm2 start ecosystem.config.js\` — a plain \`pm2 restart\` will not re-read the new env. Same gotcha as PRs #12 / #13.

## Post-deploy verification
- [ ] Queue a ~30-page audit. Watch \`pm2 list\` \`mem\` column — peak should land in the 1.8-2.4 GB range for the Node process; total system peak from \`free -m\` under 3.2 GB.
- [ ] Compare wall-clock to a similar-size run from the stability-baseline period (see the \`minutes=...\` column in the pre-flight evidence). Expect roughly half.
- [ ] After the run, verify no PM2 restarts: \`pm2 describe seo-tools | grep -E 'restarts|uptime'\`.
- [ ] Verify no \`Audit interrupted (server restarted)\` errors in the DB.

## Rollback plan
If audits start dying again under concurrency=2:

\`\`\`bash
ssh seo@144.126.213.242 "cd /home/seo/webapps/seo-tools && git revert HEAD --no-edit && git push origin main && ~/deploy.sh && pm2 delete seo-tools && pm2 start ecosystem.config.js"
\`\`\`

This restores concurrency=1 + pool=2 in seconds.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note the unquoted `EOF` and the escaped backticks/dollar signs — that's what lets the shell expand `$(cat …)` so the evidence file is embedded literally in the PR body.

If `/tmp/throughput-preflight.md` doesn't exist or is empty, **abort** — return to Task 1.

- [ ] **Step 3: Return PR URL**

---

## Self-review checklist

- [x] **Pre-flight gate is explicit AND evidence-based**: Task 1 doesn't just say "verify these" — it commands the writer to capture raw output to a file, then explicitly fill in a yes/no verdict for each gate item. The PR body in Task 7 embeds the file verbatim via `$(cat /tmp/throughput-preflight.md)`. The gate can't be rubber-stamped without leaving an audit trail.
- [x] **No placeholders**: every config value, command, and PR-body line is concrete.
- [x] **Scope is tight**: only two env values change in `ecosystem.config.js`. Everything else was already set correctly by the stability PR.
- [x] **Rollback path is documented**: post-deploy verification + a one-command revert. If concurrency=2 hurts more than helps, we revert in seconds.
- [x] **Deploy mechanics reminder**: `pm2 delete + start` is required, called out in PR body.
