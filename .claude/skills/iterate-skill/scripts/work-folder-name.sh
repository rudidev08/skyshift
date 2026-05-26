#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: work-folder-name.sh TARGET

Print the canonical iterate-skill work folder name for the given target.
The literal pattern is iterate-skill-<target>.local, with no dedup of an
"iterate-skill-" prefix on the target — the redundancy is intentional so the
outer folder does not visually collide with the target's own work folder
inside workspace/ (e.g. workspace/.iterate-skill-mock.local/).

TARGET may be a bare skill name or a path to a skill folder; only the
basename is used.

Examples:
  work-folder-name.sh iterate-skill-mock
    → iterate-skill-iterate-skill-mock.local
  work-folder-name.sh .claude/skills/iterate-skill-mock/
    → iterate-skill-iterate-skill-mock.local
USAGE
}

fail() {
  printf 'work-folder-name: %s\n' "$*" >&2
  exit 1
}

case "${1:-}" in
  --help|-h)
    usage
    exit 0
    ;;
esac

[[ $# -eq 1 ]] || { usage >&2; exit 1; }

target=$1
target=${target%/}
target=${target##*/}

[[ -n "$target" ]] || fail "TARGET resolved to empty string"

printf 'iterate-skill-%s.local\n' "$target"
