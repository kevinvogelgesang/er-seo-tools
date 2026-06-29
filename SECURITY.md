# Security

Security contact: **kevin@enrollmentresources.com** (see `public/.well-known/security.txt`).

This is an internal, login-gated tool for the Enrollment Resources SEO/web team.

## Dependency advisory policy

CI gates pull requests on **new high/critical production advisories** via
`audit-ci` (`npm run audit:ci`, config in `audit-ci.jsonc`, workflow in
`.github/workflows/security-audit.yml`). Dev-only advisories and moderates are
reported but do not block.

The allowlist holds only the documented, reachability-reviewed exceptions below.
A **new** advisory (a different GHSA id) — including a new one against these same
packages — is not allowlisted and will fail the gate, forcing a fresh review.

### Accepted exceptions (2026-06-29 pentest remediation, S2)

**1. `protobufjs` (critical) via `@xenova/transformers` → `onnxruntime-web` →
`onnx-proto` → `protobufjs@6.x`.** Allowlisted GHSA ids are listed in
`audit-ci.jsonc`.

- **Reachability:** `@xenova/transformers` is lazy-`import()`ed only inside
  `getExtractor()` in `lib/services/pillarAnalysis/embeddings.ts`, with a fixed
  task (`feature-extraction`) and a fixed model (`Xenova/all-MiniLM-L6-v2`). It is
  reached only by the pillar-analysis feature.
- **Why not exploitable here:** the protobufjs advisories (prototype pollution,
  code generation from crafted field names, unbounded recursion) require
  **attacker-controlled protobuf input** — a hostile `.proto` schema or a crafted
  serialized message. In our usage protobufjs only parses the **trusted fixed
  upstream ONNX model** (the `.proto` *is* the ONNX model format); we pass
  user text to *inference*, never user bytes to the protobuf parser.
- **Why not force-fixed:** the only npm "fix" is downgrading
  `@xenova/transformers` 2.17.2 → 2.0.1 (loses function); forcing `protobufjs@>=7`
  via override crosses the ONNX stack's declared contract and risks breaking model
  parsing at inference time (not caught by build/tests) for no real exposure
  reduction.
- **Exit criterion:** remove the allowlist entries once `@xenova` /
  `onnxruntime-web` ship a `protobufjs@>=7` chain.
- **Hardening follow-up:** the model is downloaded + cached
  (`scripts/prewarm-embedding-model.ts`), not vendored. Pinning a model
  revision/hash would further strengthen the "trusted upstream" assumption.

**2. `ws` (high, GHSA-96hv-2xvq-fx4p) — RESOLVED, not allowlisted.** Fixed by a
path-scoped override in `package.json` (`lighthouse > ws → ^7.5.11`, while
`lighthouse > puppeteer-core > ws` stays `^8.21.0`). The puppeteer/jsdom `ws` was
already patched to 8.21.0 by `npm audit fix`.

**3. `next` / `postcss` (moderate only).** All six **high** Next.js advisories —
including the App-Router middleware/proxy-bypass and request-smuggling ones — were
cleared by upgrading `next` 15.5.12 → 15.5.19. The residual items are
**moderate-only** and patched solely by a Next.js 16.x major. Deferred as separate
work (not blocking; below the gate threshold), to be scheduled outside this
security pass.
