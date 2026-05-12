#!/bin/bash
# Applies radio/computerized voice effect to all generated TTS clips.
# Input: dev/audio/data/generated/*.wav -> Output: src/assets/voices/*.wav

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT_DIR="$PROJECT_ROOT/dev/audio/data/generated"
OUTPUT_DIR="$PROJECT_ROOT/src/assets/voices"
VERIFY_SCRIPT="$PROJECT_ROOT/dev/audio/audio-verify-clips.ts"

shopt -s nullglob
input_files=("$INPUT_DIR"/*.wav)
shopt -u nullglob

COUNT=0
TOTAL=${#input_files[@]}

if [ "$TOTAL" -eq 0 ]; then
  echo "No generated clips found in $INPUT_DIR/"
  exit 0
fi

echo "Verifying generated clips before rebuilding processed voice assets..."
node --import tsx "$VERIFY_SCRIPT" "$INPUT_DIR" --allow-extra

# Processed clips are a deterministic derivative of the unprocessed voices,
# so the target folder is rebuilt from scratch on every effect pass.
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

for file in "${input_files[@]}"; do
  COUNT=$((COUNT + 1))
  NAME=$(basename "$file")
  OUTPUT_FILE="$OUTPUT_DIR/$NAME"

  echo "  [$COUNT/$TOTAL] $NAME"
  # Radio-style pass: speeds the voice up slightly, narrows the band, and limits peaks for a compact computerized announcement sound.
  ffmpeg -y -i "$file" -filter_complex "
    [0:a]atempo=1.2,highpass=f=400,lowpass=f=2500,volume=3,alimiter=limit=0.9[out]
  " -map "[out]" "$OUTPUT_FILE" 2>/dev/null
done

echo "Verifying processed clips in $OUTPUT_DIR..."
node --import tsx "$VERIFY_SCRIPT" "$OUTPUT_DIR" --allow-extra

echo "Done. Processed $COUNT generated clips into $OUTPUT_DIR/"
