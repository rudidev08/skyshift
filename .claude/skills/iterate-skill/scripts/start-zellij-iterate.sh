#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: start-zellij-iterate.sh [--session NAME] [--cwd DIR] [--claude COMMAND] [-- CLAUDE_ARG...]

Start or attach a zellij session for an iterate-skill run. When creating a new
session, start Claude in the current directory so checkpoint automation can
target the Claude pane later.
USAGE
}

fail() {
  printf 'start-zellij-iterate: %s\n' "$*" >&2
  exit 1
}

default_session_name() {
  local base sanitized hash
  base=${PWD##*/}
  if [[ -z "$base" || "$base" == "/" ]]; then
    base="iterate-skill"
  fi

  sanitized=$(printf '%s' "$base" | sed 's/[^[:alnum:]_.-]/-/g; s/--*/-/g; s/^-//; s/-$//')
  if [[ -z "$sanitized" ]]; then
    sanitized="iterate-skill"
  fi

  # Append a hash of the absolute path so two repos with the same basename
  # (e.g. /work/foo and /other/foo) don't share a session.
  hash=$(printf '%s' "$PWD" | shasum | cut -c1-6)
  printf '%s-%s\n' "$sanitized" "$hash"
}

kdl_quote() {
  local value
  value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '"%s"' "$value"
}

session_name=""
cwd=$PWD
claude_cmd=${CLAUDE_CMD:-claude}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session|-s)
      [[ $# -ge 2 ]] || fail "--session requires a value"
      session_name=$2
      shift 2
      ;;
    --cwd)
      [[ $# -ge 2 ]] || fail "--cwd requires a value"
      cwd=$2
      shift 2
      ;;
    --claude)
      [[ $# -ge 2 ]] || fail "--claude requires a value"
      claude_cmd=$2
      shift 2
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

[[ -d "$cwd" ]] || fail "working directory does not exist: $cwd"
command -v zellij >/dev/null 2>&1 || fail "zellij is not on PATH"

claude_path=$(command -v "$claude_cmd" 2>/dev/null || true)
[[ -n "$claude_path" ]] || fail "Claude command is not on PATH: $claude_cmd"

if [[ -z "$session_name" ]]; then
  session_name=$(default_session_name)
fi

if [[ -n "${ZELLIJ:-}" ]]; then
  cd "$cwd"
  # Rename the current pane so name-based pane targeting matches the
  # outside-zellij path (which sets pane name="claude" via the layout).
  zellij action rename-pane claude >/dev/null 2>&1 || true
  exec "$claude_path" "$@"
fi

# Filter EXITED (resurrectable) sessions out of the live-session check —
# `list-sessions --short` reports them identically to running ones, which would
# cause `attach` to resurrect an empty session and never reach the
# create-with-layout path below.
sessions=$(zellij list-sessions --no-formatting 2>/dev/null || true)

if printf '%s\n' "$sessions" \
    | awk -v name="$session_name" '$1 == name && !/EXITED/ { found=1 } END { exit !found }'; then
  exec zellij attach "$session_name"
fi

# A dead/EXITED session with the same name blocks --new-session-with-layout —
# zellij refuses to create a session whose name collides. Delete it first.
if printf '%s\n' "$sessions" \
    | awk -v name="$session_name" '$1 == name && /EXITED/ { found=1 } END { exit !found }'; then
  zellij delete-session "$session_name" >/dev/null 2>&1 \
    || fail "could not delete exited session: $session_name"
fi

quoted_args=""
for arg in "$@"; do
  quoted_args+=" $(kdl_quote "$arg")"
done

if [[ -n "$quoted_args" ]]; then
  layout_string=$(cat <<EOF
layout {
    pane name="claude" cwd=$(kdl_quote "$cwd") command=$(kdl_quote "$claude_path") {
        args$quoted_args
    }
}
EOF
)
else
  layout_string=$(cat <<EOF
layout {
    pane name="claude" cwd=$(kdl_quote "$cwd") command=$(kdl_quote "$claude_path")
}
EOF
)
fi

# Use --new-session-with-layout so create-session semantics are guaranteed
# even if a session named $session_name appears between the check above and
# this exec; `--session NAME --layout-string ...` would silently add the
# layout as new tabs to that pre-existing session instead of starting fresh.
layout_file=${TMPDIR:-/tmp}/start-zellij-iterate-layout.kdl
printf '%s\n' "$layout_string" >"$layout_file" \
  || fail "could not write layout file: $layout_file"
exec zellij --session "$session_name" --new-session-with-layout "$layout_file"
