#!/bin/bash
# Debug script: single TTS request with verbose output to test API connectivity.

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$PROJECT_ROOT/.env" ] && set -a && source "$PROJECT_ROOT/.env" && set +a

MODEL="${AUDIO_VOICE_DESIGN_MODEL:-mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16}"
API="${AUDIO_TTS_API:-http://localhost:8000/v1/audio/speech}"

curl -v "$API" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"input\": \"Mossgate station. Small habitat. Bio-annex nation.\",
    \"task_type\": \"VoiceDesign\",
    \"instructions\": \"Older husky male voice. Low pitch. Slightly brisk pace. Each word clearly pronounced and emphasized. No emotion.\"
  }" \
  --output /dev/null \
  -w "\n\nHTTP Status: %{http_code}\nSize: %{size_download} bytes\n"
