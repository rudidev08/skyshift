#!/usr/bin/env bash
# Fetches Phaser type definitions and AI agent skills for a specific release.
# Generates browsable API docs with typedoc, and mirrors the phaser skills/
# folder so the markdown files can be read locally. Outputs land in
# dev/phaser-docs.local/ and dev/phaser-skills.local/ (both gitignored).
# typedoc recipe originally from:
# https://phaser.discourse.group/t/how-to-build-the-api-docs-for-any-phaser-3-or-4-release/15242

PHASER_VERSION="v4.1.0"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCS_OUTPUT_DIR="$SCRIPT_DIR/phaser-docs.local"
SKILLS_OUTPUT_DIR="$SCRIPT_DIR/phaser-skills.local"
TEMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "Fetching Phaser $PHASER_VERSION type definitions and skills..."

git clone --no-checkout --depth 1 --branch "$PHASER_VERSION" \
  https://github.com/phaserjs/phaser.git "$TEMP_DIR/phaser"

cd "$TEMP_DIR/phaser"
git sparse-checkout init --cone
git sparse-checkout set types skills
git checkout "tags/$PHASER_VERSION"

echo "Generating API docs into $DOCS_OUTPUT_DIR..."

npx typedoc ./types/*.d.ts \
  --out "$DOCS_OUTPUT_DIR" \
  --includeVersion \
  --skipErrorChecking

echo "Copying agent skills into $SKILLS_OUTPUT_DIR..."

rm -rf "$SKILLS_OUTPUT_DIR"
cp -r "$TEMP_DIR/phaser/skills" "$SKILLS_OUTPUT_DIR"

echo ""
echo "Done."
echo "  Open the API docs: open $DOCS_OUTPUT_DIR/index.html"
echo "  Browse skills:     $SKILLS_OUTPUT_DIR/"
