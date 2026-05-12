#!/bin/bash
# Bootstraps the macOS local environment for the audio pipeline:
# installs ffmpeg via Homebrew, creates the project-root .venv, and
# installs the Python packages used by dev/audio/audio-build-generate.py.
# Assumes python3 and Homebrew are already installed; aborts otherwise.

set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "Checking prerequisites..."
missing=0
if ! command -v python3 >/dev/null 2>&1; then
  echo "  ERROR: python3 not found. Install Python 3 (e.g. 'brew install python') and retry."
  missing=1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "  ERROR: Homebrew not found. Install from https://brew.sh/ and retry."
  missing=1
fi
if [ "$missing" -ne 0 ]; then
  exit 1
fi
echo "  python3: $(python3 --version)"
echo "  brew:    $(brew --version | head -1)"

echo ""
echo "Step 1/3: ffmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
  echo "  already installed ($(ffmpeg -version | head -1))"
else
  brew install ffmpeg
fi

echo ""
echo "Step 2/3: Python virtual environment"
if [ -d "$PROJECT_ROOT/.venv" ]; then
  echo "  .venv already exists at $PROJECT_ROOT/.venv, skipping creation"
else
  python3 -m venv "$PROJECT_ROOT/.venv"
  echo "  created $PROJECT_ROOT/.venv"
fi

echo ""
echo "Step 3/3: Python packages (soundfile, mlx-audio, mlx)"
"$PROJECT_ROOT/.venv/bin/pip" install --upgrade pip
"$PROJECT_ROOT/.venv/bin/pip" install soundfile mlx-audio mlx

echo ""
echo "Audio environment ready."
echo "Next: ./dev/audio/audio-build-all.sh (will download the TTS model on first run, ~3.4 GB)"
