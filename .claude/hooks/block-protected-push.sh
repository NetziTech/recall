#!/usr/bin/env bash
# PreToolUse(Bash) hook: aborta `git push` que afecte main o develop.
# Cubre dos casos:
#   1) Push implicito desde main/develop (current branch).
#   2) Push explicito a main/develop (e.g. `git push origin main`, `git push origin HEAD:main`).
# Branch protection del remote rechaza igual, pero el hook ataja en local antes
# de gastar el round-trip.
set -euo pipefail

CMD=$(jq -r '.tool_input.command // ""')

# Solo actuamos sobre `git push`.
if ! echo "$CMD" | grep -qE '(^|[[:space:];&|])git[[:space:]]+push([[:space:]]|$)'; then
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-$PWD}"
BRANCH=$(git -C "$REPO" branch --show-current 2>/dev/null || echo "")

# Caso 1: pushing desde main/develop (push implicito de esa branch).
if [[ "$BRANCH" == "main" || "$BRANCH" == "develop" ]]; then
  echo "BLOCKED: push desde branch protegida ($BRANCH). Branch protection del remote" >&2
  echo "rechaza igual. Trabaja desde feature branch + PR." >&2
  exit 2
fi

# Caso 2: push explicito a main/develop. Patrones:
#   git push origin main
#   git push origin develop
#   git push origin HEAD:main
#   git push origin feature:main
#   git push --force origin main
# Pattern: `main`/`develop` precedido por space/colon, seguido por space/end.
if echo "$CMD" | grep -qE '(^|[[:space:]:])(main|develop)([[:space:]]|$)'; then
  echo "BLOCKED: push directo a main/develop detectado en el comando." >&2
  echo "Usa PR via feature branch (branch protection lo bloquearia igual)." >&2
  exit 2
fi

exit 0
