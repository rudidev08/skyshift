#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: zellij-clear-resume.sh [--dry-run] [--pane-id ID] [--delay SECONDS] [--no-effort] NEXT_PROMPT_FILE

Queue /clear, /effort max, and the resume prompt into the current zellij pane.
Run only after iterate-skill has written durable checkpoint state.

  --delay SECONDS   delay before sending /clear (default 2). Bump if Claude's
                    final assistant message is still rendering when keystrokes
                    arrive — the helper cannot detect input readiness.
  --no-effort       skip the /effort max keystroke (keeps the user's current
                    effort setting).
USAGE
}

fail() {
  printf 'zellij-clear-resume: %s\n' "$*" >&2
  exit 1
}

dry_run=0
delay=2
pane_id=${ZELLIJ_PANE_ID:-}
set_effort=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --pane-id)
      [[ $# -ge 2 ]] || fail "--pane-id requires a value"
      pane_id=$2
      shift 2
      ;;
    --delay)
      [[ $# -ge 2 ]] || fail "--delay requires a value"
      delay=$2
      shift 2
      ;;
    --no-effort)
      set_effort=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      fail "unknown option: $1"
      ;;
    *)
      break
      ;;
  esac
done

[[ $# -eq 1 ]] || fail "expected exactly one next-prompt file"

next_prompt_file=$1
[[ -r "$next_prompt_file" ]] || fail "cannot read next-prompt file: $next_prompt_file"
command -v zellij >/dev/null 2>&1 || fail "zellij is not on PATH"

prompt=$(cat "$next_prompt_file")
[[ -n "$prompt" ]] || fail "next-prompt file is empty: $next_prompt_file"

# Embedded LF/CR would be sent as raw bytes by write-chars; the TTY interprets
# them as Enter, submitting partial prompts as separate turns. The orchestrator
# is supposed to produce single-line resume prompts — reject anything else
# rather than silently mangle it.
case $prompt in
  *$'\r'*)
    fail "next-prompt file has carriage returns (CRLF endings?); convert to LF: $next_prompt_file"
    ;;
  *$'\n'*)
    fail "next-prompt file has embedded newlines; iterate-skill resume prompts must be single-line: $next_prompt_file"
    ;;
esac

if [[ "$dry_run" -eq 1 ]]; then
  printf 'zellij-clear-resume dry run\n'
  printf '  next prompt: %s\n' "$next_prompt_file"
  printf '  pane id: %s\n' "${pane_id:-<none>}"
  printf '  delay: %s seconds\n' "$delay"
  if [[ "$set_effort" -eq 1 ]]; then
    printf '  queued input: /clear -> /effort max -> resume prompt\n'
  else
    printf '  queued input: /clear -> resume prompt (--no-effort)\n'
  fi
  if [[ -z "$pane_id" ]]; then
    printf '  fallback: not inside zellij; run /clear manually, then provide %s\n' "$next_prompt_file"
  fi
  exit 0
fi

if [[ -z "$pane_id" ]]; then
  printf 'zellij-clear-resume: not inside zellij; ZELLIJ_PANE_ID is not set.\n' >&2
  printf 'Manual fallback: run /clear, then provide %s.\n' "$next_prompt_file" >&2
  exit 2
fi

# Send subshell output to a log file (not /dev/null) so a late failure inside
# the backgrounded sequence — stale pane id, daemon hiccup, bad delay — leaves
# a diagnostic trace instead of silently stopping after /clear.
log_file=${TMPDIR:-/tmp}/zellij-clear-resume.log

nohup bash -c '
set -euo pipefail
pane_id=$1
delay=$2
set_effort=$3
prompt=$4

sleep "$delay"
zellij action write-chars -p "$pane_id" -- "/clear"
zellij action send-keys -p "$pane_id" Enter
if [[ "$set_effort" -eq 1 ]]; then
  sleep 0.8
  zellij action write-chars -p "$pane_id" -- "/effort max"
  zellij action send-keys -p "$pane_id" Enter
fi
sleep 0.4
zellij action write-chars -p "$pane_id" -- "$prompt"
zellij action send-keys -p "$pane_id" Enter
' iterate-zellij-clear-resume "$pane_id" "$delay" "$set_effort" "$prompt" >"$log_file" 2>&1 &

if [[ "$set_effort" -eq 1 ]]; then
  printf 'Queued zellij /clear + /effort max + resume prompt for pane %s (log: %s).\n' "$pane_id" "$log_file"
else
  printf 'Queued zellij /clear + resume prompt for pane %s (log: %s).\n' "$pane_id" "$log_file"
fi
