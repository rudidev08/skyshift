#!/bin/bash
# Generates 10 test voice samples using the VoiceDesign model for voice audition.
# Listen to the output samples and pick the best one as dev/audio/data/sample.wav.

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$PROJECT_ROOT/.env" ] && set -a && source "$PROJECT_ROOT/.env" && set +a

MODEL="${AUDIO_VOICE_DESIGN_MODEL:-mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16}"
API="${AUDIO_TTS_API:-http://localhost:8000/v1/audio/speech}"
OUTPUT_DIR="$PROJECT_ROOT/dev/audio/data/voice-design-samples"
mkdir -p "$OUTPUT_DIR"

for i in $(seq 1 10); do
  OUTPUT_FILE="$OUTPUT_DIR/sample-$i.wav"

  if [ -f "$OUTPUT_FILE" ]; then
    echo "Skipping sample $i (exists)"
    continue
  fi

  echo "Generating sample $i..."
  curl -s "$API" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"$MODEL\",
      \"input\": \"Mossgate. Small habitat. Bio-annex. Riftwake. Jumpship. Skyshift Cooperative.\",
      \"task_type\": \"VoiceDesign\",
      \"instructions\": \"Deep older male voice. Perfectly even and composed. Each word precisely articulated with equal weight. No warmth, no emotion, no variation. Clinical.\"
    }" \
    --output "$OUTPUT_FILE"
done
echo "Done. Samples in $OUTPUT_DIR/"
