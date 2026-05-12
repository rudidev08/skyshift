#!/bin/bash
# Full audio pipeline: extract strings -> generate raw TTS -> apply effects to game assets.
# Run from anywhere — resolves project root from script location.

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$PROJECT_ROOT/.env" ] && set -a && source "$PROJECT_ROOT/.env" && set +a

if [ -x "$PROJECT_ROOT/.venv/bin/python" ]; then
  PYTHON_BIN="$PROJECT_ROOT/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python)"
else
  echo "Python not found. Create $PROJECT_ROOT/.venv or install python3 and ensure it is on PATH."
  exit 1
fi

echo "Step 1/3: Extracting audio strings from game data..."
npx tsx "$PROJECT_ROOT/dev/audio/audio-build-strings.ts"

echo ""
echo "Step 2/3: Generating unprocessed TTS audio (this takes a while)..."
"$PYTHON_BIN" "$PROJECT_ROOT/dev/audio/audio-build-generate.py"

echo ""
echo "Step 3/3: Applying radio effect to final voice assets..."
"$PROJECT_ROOT/dev/audio/audio-build-effect.sh"

echo ""
echo "Audio pipeline complete."
