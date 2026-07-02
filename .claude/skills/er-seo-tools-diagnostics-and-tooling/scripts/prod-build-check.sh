#!/usr/bin/env bash
# prod-build-check.sh — the minification discriminator.
#
# WHY THIS EXISTS (the parser-key incident): the parse route used to derive
# each parser's aggregator key from ParserClass.name. `next build` (SWC)
# minifies class names to single letters in production, so the aggregator's
# hardcoded `this.parsedData.internal` (etc.) lookups missed and page_index /
# keyword data silently came out EMPTY — in prod only; dev was fine. The fix:
# every parser declares an explicit `static parserKey = '<literal>'` (string
# literals survive minification), and the route reads that
# (app/api/parse/[sessionId]/route.ts:141-146). lib/parsers/parser-key.test.ts
# guards the source side; THIS script verifies the BUILT OUTPUT still carries
# every key literal — the check dev-mode testing can never perform.
#
# Usage (from the repo root, AFTER `npm run build`):
#   bash .claude/skills/er-seo-tools-diagnostics-and-tooling/scripts/prod-build-check.sh [build-dir]
#
#   build-dir default: .next
#
# Read-only: greps source + build artifacts; writes nothing.
set -euo pipefail

BUILD_DIR="${1:-.next}"

if [ ! -d "lib/parsers" ]; then
  echo "ERROR: run from the repo root (lib/parsers not found)" >&2
  exit 1
fi

ROUTE_CHUNK="$BUILD_DIR/server/app/api/parse/[sessionId]/route.js"
if [ ! -f "$ROUTE_CHUNK" ]; then
  echo "ERROR: built parse route not found at: $ROUTE_CHUNK" >&2
  echo "Run 'npm run build' first (locally this needs no DB)." >&2
  exit 1
fi

# Expected keys: every explicit static parserKey literal in the source.
KEYS=$(grep -rhoE "static parserKey = '[a-z0-9]+'" lib/parsers \
        | sed "s/static parserKey = '//; s/'$//" | sort -u) || true
if [ -z "$KEYS" ]; then
  echo "ERROR: zero 'static parserKey = ...' literals found in lib/parsers — pattern drift?" >&2
  echo "Re-verify with: grep -rn 'static parserKey' lib/parsers" >&2
  exit 1
fi
TOTAL=$(printf '%s\n' "$KEYS" | wc -l | tr -d ' ')

if [ "$TOTAL" -lt 40 ]; then
  echo "WARN: only $TOTAL parserKey literals found in lib/parsers (expected ~45 as of 2026-07-02)" >&2
  echo "      A parser may have lost its explicit key — check lib/parsers/parser-key.test.ts" >&2
fi

MISSING=0
for key in $KEYS; do
  if ! grep -q "'$key'" "$ROUTE_CHUNK" && ! grep -q "\"$key\"" "$ROUTE_CHUNK"; then
    echo "MISSING from built route chunk: '$key'"
    MISSING=$((MISSING + 1))
  fi
done

# The property name itself must also survive (the route reads .parserKey).
if ! grep -q "parserKey" "$ROUTE_CHUNK"; then
  echo "MISSING: the literal 'parserKey' property does not appear in the built route chunk"
  MISSING=$((MISSING + 1))
fi

if [ "$MISSING" -eq 0 ]; then
  echo "OK: all $TOTAL parserKey literals (plus the .parserKey property) present in $ROUTE_CHUNK"
  exit 0
else
  echo "FAIL: $MISSING expected literal(s) absent from the production build."
  echo "A parser is likely relying on ParserClass.name — that key WILL break in prod."
  exit 1
fi
