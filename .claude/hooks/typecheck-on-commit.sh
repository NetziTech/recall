#!/usr/bin/env bash
# PreToolUse(Bash) hook: corre `npm run typecheck` antes de `git commit` que toca code/src/.
# Razon: ataja PRs rotos antes del commit local. Tarda 5-15 s en commits con cambios
# en code/src/, cero overhead en commits de docs/HANDOFF.
set -euo pipefail

CMD=$(jq -r '.tool_input.command // ""')

# Match `git commit` (mismo patron que block-protected-commit.sh).
if ! echo "$CMD" | grep -qE '(^|[[:space:];&|])git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-$PWD}"

# ¿Hay cambios staged en code/src/?
STAGED=$(git -C "$REPO" diff --cached --name-only 2>/dev/null || echo "")
if ! echo "$STAGED" | grep -qE '^code/src/'; then
  exit 0
fi

# Correr typecheck. Captura stderr+stdout para incluir en el mensaje de bloqueo.
if ! TC_OUTPUT=$(cd "$REPO/code" && npm run typecheck 2>&1); then
  {
    echo "BLOCKED: typecheck fallo. Cambios en code/src/ requieren tsc strict pasando."
    echo "----- typecheck output -----"
    echo "$TC_OUTPUT"
    echo "----------------------------"
    echo "Fix los errores de tipo y re-intenta el commit."
  } >&2
  exit 2
fi

exit 0
