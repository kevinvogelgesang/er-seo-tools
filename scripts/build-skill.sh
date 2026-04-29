#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_SRC="$REPO_ROOT/skills/pillar-analysis-narrative"
SF_DOC="$REPO_ROOT/docs/screaming-frog-setup.md"
DIST_DIR="$REPO_ROOT/dist/skills"
STAGING="$DIST_DIR/pillar-analysis-narrative"

# Version is a single line in version.txt — robust against YAML formatting drift.
VERSION_FILE="$SKILL_SRC/version.txt"
[ -f "$VERSION_FILE" ] || { echo "ERROR: $VERSION_FILE missing" >&2; exit 1; }
VERSION=$(tr -d ' \n\r\t' < "$VERSION_FILE")
[ -n "$VERSION" ] || { echo "ERROR: version.txt is empty" >&2; exit 1; }

# Pre-build sanity loop — fail loud if any expected file is missing.
for f in SKILL.md README.md scripts/fetch_analysis.py scripts/post_narrative.py templates/memo_structure.md; do
  [ -f "$SKILL_SRC/$f" ] || { echo "ERROR: $SKILL_SRC/$f missing" >&2; exit 1; }
done
[ -f "$SF_DOC" ] || { echo "ERROR: $SF_DOC missing (build needs to copy it into the skill)" >&2; exit 1; }

rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -r "$SKILL_SRC"/* "$STAGING/"
cp "$SF_DOC" "$STAGING/templates/screaming-frog-setup.md"

cd "$DIST_DIR"
ZIP_NAME="pillar-analysis-narrative-${VERSION}.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" "pillar-analysis-narrative/"

echo "Built: $DIST_DIR/$ZIP_NAME"
