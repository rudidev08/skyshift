#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
file_path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')

case "$file_path" in
  */iterate-skill-*.local/next-prompt.txt) ;;
  *) exit 0 ;;
esac

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
helper="$script_dir/zellij-clear-resume.sh"
log_file=${TMPDIR:-/tmp}/zellij-clear-resume.log

{
  printf -- '--- auto-clear hook fired at %s for %s ---\n' "$(date)" "$file_path"
  bash "$helper" "$file_path" 2>&1 || true
} >> "$log_file"

exit 0
