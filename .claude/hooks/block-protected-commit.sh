#!/usr/bin/env bash
# PreToolUse(Bash) hook: aborta `git commit` cuando el branch actual es main o develop.
# Razon: 2 violaciones de flow en Phase-12 (commits a main por error). Branch protection
# del remote ataja el push pero no el commit local; este hook lo ataja antes.
# Lee tool_input JSON desde stdin (formato Claude Code hooks).
set -euo pipefail

CMD=$(jq -r '.tool_input.command // ""')

# Match `git commit` precedido por inicio/espacio/;/&/| y seguido por espacio o fin.
# Excluye: `git commit-tree`, `git log | grep commit`, etc.
if ! echo "$CMD" | grep -qE '(^|[[:space:];&|])git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-$PWD}"
BRANCH=$(git -C "$REPO" branch --show-current 2>/dev/null || echo "")

case "$BRANCH" in
  main|develop)
    echo "BLOCKED: commit en branch protegida ($BRANCH). Crea feature branch:" >&2
    echo "  git switch -c feat/<descripcion>   # o fix/, docs/, chore/, refactor/" >&2
    exit 2
    ;;
esac

exit 0
