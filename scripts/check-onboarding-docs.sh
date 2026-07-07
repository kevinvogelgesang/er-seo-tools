#!/usr/bin/env bash
# Validates docs/onboarding/: (1) every backtick repo path exists,
# (2) flags duration language in junior-path docs for manual review.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
tmp="$(mktemp)"

grep -RnoE --include='*.md' \
  '`(app|components|lib|prisma|scripts|test|docs|\.claude)/[^` ]+`|`(middleware\.ts|instrumentation\.ts|package\.json|ecosystem\.config\.js|CLAUDE\.md|tailwind\.config\.ts|README\.md|SECURITY\.md|\.env\.example|vitest\.config\.mts|next\.config\.ts|tsconfig\.json|audit-ci\.jsonc)`' \
  docs/onboarding > "$tmp" || true

while IFS= read -r line; do
  # grep -Rno output is file:line:match — the match itself may contain colons
  # (e.g. `lib/foo.ts:symbol`), so peel exactly two fields off the front.
  file="${line%%:*}"
  rest="${line#*:}"
  match="${rest#*:}"
  path="${match//\`/}"
  path="${path%%:*}"   # strip :line / :symbol suffix
  if [ ! -e "$path" ]; then
    echo "MISSING: $file -> $path"
    fail=1
  fi
done < "$tmp"
rm -f "$tmp"

# Junior-path docs must not contain pacing durations (manual-review list, not a hard fail).
for f in docs/onboarding/README.md docs/onboarding/0[0-2]-*.md docs/onboarding/05-*.md docs/onboarding/06-*.md; do
  [ -e "$f" ] || continue
  grep -niE '\b(minute|hour|day|week|month)s?\b' "$f" | sed "s|^|DURATION? $f:|" || true
done

if [ "$fail" -eq 1 ]; then
  echo "FAIL: missing anchors above"
  exit 1
fi
echo "OK: all anchors exist (review any DURATION? lines above)"
