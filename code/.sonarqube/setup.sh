#!/usr/bin/env bash
# Setup idempotente de SonarQube para mcp-memoria-inteligente.
#
# Estrategia:
#   1. Valida token + conectividad.
#   2. Crea proyecto si no existe (sino lo deja como esta).
#   3. Crea quality gate si no existe.
#   4. Lee TODAS las condiciones actuales del gate.
#   5. Para cada condicion deseada:
#        - Si NO existe          -> CREATE
#        - Si existe e identica  -> SKIP
#        - Si existe distinta    -> UPDATE (usando el id real)
#   6. Asocia el gate al proyecto.
#
# Maneja correctamente quality gates creados con template "Clean as You Code"
# que ya traen condiciones pre-poblada.
#
# Requiere env vars:
#   SONAR_HOST_URL  (ej: https://sonar.netzi.dev)
#   SONAR_TOKEN     (token con rol Global Administrator)

set -uo pipefail

# ============================================================================
# Configuracion
# ============================================================================

PROJECT_KEY="mcp-memoria-inteligente"
PROJECT_NAME="MCP Memoria Inteligente"
PROJECT_BRANCH="main"
GATE_NAME="MCP Memoria Strict"

# Condiciones deseadas: "metric|operator|error_threshold"
# Operadores: LT (less than), GT (greater than)
# Ratings: 1=A, 2=B, 3=C, 4=D, 5=E. GT 1 = peor que A.
declare -a CONDITIONS=(
  # Coverage
  "new_coverage|LT|95"
  "coverage|LT|95"

  # Duplications
  "new_duplicated_lines_density|GT|3"
  "duplicated_lines_density|GT|3"

  # Ratings (peor que A en codigo nuevo)
  "new_maintainability_rating|GT|1"
  "new_reliability_rating|GT|1"
  "new_security_rating|GT|1"
  "new_security_review_rating|GT|1"

  # Counts (cero tolerancia en codigo nuevo)
  "new_bugs|GT|0"
  "new_vulnerabilities|GT|0"
  "new_blocker_violations|GT|0"
  "new_critical_violations|GT|0"

  # Technical debt
  "new_sqale_debt_ratio|GT|5"
)

# ============================================================================
# Output helpers
# ============================================================================

if [ -t 1 ]; then
  GREEN="\033[0;32m"
  RED="\033[0;31m"
  YELLOW="\033[1;33m"
  BLUE="\033[0;34m"
  DIM="\033[2m"
  BOLD="\033[1m"
  RESET="\033[0m"
else
  GREEN="" RED="" YELLOW="" BLUE="" DIM="" BOLD="" RESET=""
fi

ok()   { printf "${GREEN}✓${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}!${RESET} %s\n" "$1"; }
err()  { printf "${RED}✗${RESET} %s\n" "$1" >&2; }
info() { printf "${BLUE}→${RESET} ${BOLD}%s${RESET}\n" "$1"; }
dim()  { printf "${DIM}  %s${RESET}\n" "$1"; }
die()  { err "$1"; exit 1; }

# ============================================================================
# HTTP helpers
# ============================================================================

# Vars globales seteadas por http_post / http_get:
#   HTTP_STATUS  ej: "200"
#   HTTP_BODY    cuerpo del response
HTTP_STATUS=""
HTTP_BODY=""

# Uso: http_post "/api/path" "key1" "val1" "key2" "val2" ...
http_post() {
  local path="$1"
  shift
  local body_file
  body_file=$(mktemp -t sonarq.XXXXXX)
  local -a args=("-sS" "-o" "$body_file" "-w" "%{http_code}" "-u" "${SONAR_TOKEN}:" "-X" "POST")
  while [ "$#" -gt 0 ]; do
    args+=("--data-urlencode" "$1=$2")
    shift 2
  done
  args+=("${SONAR_HOST_URL}${path}")

  HTTP_STATUS=$(curl "${args[@]}" 2>/dev/null || echo "000")
  HTTP_BODY=$(cat "$body_file")
  rm -f "$body_file"
}

# Uso: http_get "/api/path?query=X"
http_get() {
  local path="$1"
  local body_file
  body_file=$(mktemp -t sonarq.XXXXXX)
  HTTP_STATUS=$(curl -sS -o "$body_file" -w "%{http_code}" \
    -u "${SONAR_TOKEN}:" \
    "${SONAR_HOST_URL}${path}" 2>/dev/null || echo "000")
  HTTP_BODY=$(cat "$body_file")
  rm -f "$body_file"
}

# URL-encode de un string
url_encode() {
  python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"
}

# ============================================================================
# Validacion previa
# ============================================================================

[ -n "${SONAR_HOST_URL:-}" ] || die "SONAR_HOST_URL no esta seteada"
[ -n "${SONAR_TOKEN:-}" ]    || die "SONAR_TOKEN no esta seteada"
command -v curl    >/dev/null || die "curl no esta instalado"
command -v python3 >/dev/null || die "python3 no esta instalado"

printf "${BOLD}Setup SonarQube${RESET}\n"
echo "  Host:     $SONAR_HOST_URL"
echo "  Project:  $PROJECT_KEY"
echo "  Gate:     $GATE_NAME"
echo

# ============================================================================
# 1. Validar token
# ============================================================================

info "Validando token..."
http_get "/api/authentication/validate"
[ "$HTTP_STATUS" = "200" ] || die "No se pudo conectar (HTTP $HTTP_STATUS): $HTTP_BODY"
echo "$HTTP_BODY" | grep -q '"valid":true' || die "Token invalido o expirado: $HTTP_BODY"
ok "Token valido"

# ============================================================================
# 2. Proyecto (idempotente)
# ============================================================================

info "Verificando proyecto..."
http_get "/api/projects/search?projects=$(url_encode "$PROJECT_KEY")"
if [ "$HTTP_STATUS" = "200" ] && echo "$HTTP_BODY" | grep -q "\"key\":\"${PROJECT_KEY}\""; then
  ok "Proyecto ya existe"
else
  http_post "/api/projects/create" \
    "name" "$PROJECT_NAME" \
    "project" "$PROJECT_KEY" \
    "mainBranch" "$PROJECT_BRANCH"

  case "$HTTP_STATUS" in
    200|201) ok "Proyecto creado" ;;
    *)       die "Error HTTP $HTTP_STATUS creando proyecto: $HTTP_BODY" ;;
  esac
fi

# ============================================================================
# 3. Quality gate (idempotente)
# ============================================================================

info "Verificando quality gate..."
http_get "/api/qualitygates/show?name=$(url_encode "$GATE_NAME")"
if [ "$HTTP_STATUS" = "200" ] && echo "$HTTP_BODY" | grep -q "\"name\":\"${GATE_NAME}\""; then
  ok "Quality gate ya existe"
else
  http_post "/api/qualitygates/create" "name" "$GATE_NAME"
  case "$HTTP_STATUS" in
    200|201) ok "Quality gate creado" ;;
    *)       die "Error HTTP $HTTP_STATUS creando gate: $HTTP_BODY" ;;
  esac
fi

# ============================================================================
# 4. Leer condiciones existentes
# ============================================================================

info "Leyendo condiciones del gate..."
http_get "/api/qualitygates/show?name=$(url_encode "$GATE_NAME")"
[ "$HTTP_STATUS" = "200" ] || die "Error leyendo gate: $HTTP_BODY"

# Parsear a formato "metric|id|op|error" (una linea por condicion)
existing_file=$(mktemp -t sonarq_existing.XXXXXX)
echo "$HTTP_BODY" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)
for c in data.get('conditions', []):
    print(c['metric'] + '|' + c['id'] + '|' + c['op'] + '|' + str(c['error']))
" > "$existing_file"

n_existing=$(wc -l < "$existing_file" | tr -d ' ')
ok "Condiciones actuales en el gate: $n_existing"

if [ "$n_existing" -gt 0 ]; then
  while IFS='|' read -r metric _ op error; do
    dim "  · $metric $op $error"
  done < "$existing_file"
fi

# ============================================================================
# 5. Sincronizar condiciones (CREATE / UPDATE / SKIP)
# ============================================================================

info "Sincronizando ${#CONDITIONS[@]} condiciones deseadas..."

n_created=0
n_updated=0
n_skipped=0
n_failed=0

for cond in "${CONDITIONS[@]}"; do
  IFS='|' read -r metric op threshold <<< "$cond"

  existing_line=$(grep "^${metric}|" "$existing_file" || true)

  if [ -z "$existing_line" ]; then
    # No existe → CREATE
    http_post "/api/qualitygates/create_condition" \
      "gateName" "$GATE_NAME" \
      "metric" "$metric" \
      "op" "$op" \
      "error" "$threshold"

    case "$HTTP_STATUS" in
      200|201)
        ok "  CREATE  $metric $op $threshold"
        n_created=$((n_created + 1))
        ;;
      400)
        # SonarQube reporta condiciones duplicadas con mensaje cripico
        # ("Conversion = ')'") cuando una condicion CaYC ya existe pero
        # nuestro listado no la atrapo. Tratar como SKIP.
        if echo "$HTTP_BODY" | grep -qiE "Conversion|already|duplicate|exists"; then
          warn "  SKIP    $metric (probable CaYC existente: $HTTP_BODY)"
          n_skipped=$((n_skipped + 1))
        elif echo "$HTTP_BODY" | grep -qiE "metric.*not found|unknown metric"; then
          warn "  SKIP    $metric (metrica no existe en este SonarQube)"
          n_skipped=$((n_skipped + 1))
        else
          err "  FAIL    $metric: HTTP 400 $HTTP_BODY"
          n_failed=$((n_failed + 1))
        fi
        ;;
      *)
        err "  FAIL    $metric: HTTP $HTTP_STATUS $HTTP_BODY"
        n_failed=$((n_failed + 1))
        ;;
    esac

  else
    # Existe → comparar y decidir
    IFS='|' read -r _ existing_id existing_op existing_error <<< "$existing_line"

    if [ "$existing_op" = "$op" ] && [ "$existing_error" = "$threshold" ]; then
      ok "  SKIP    $metric ($op $threshold sin cambios)"
      n_skipped=$((n_skipped + 1))
    else
      # Update con el id real
      http_post "/api/qualitygates/update_condition" \
        "id" "$existing_id" \
        "metric" "$metric" \
        "op" "$op" \
        "error" "$threshold"

      case "$HTTP_STATUS" in
        200)
          ok "  UPDATE  $metric: $existing_op $existing_error → $op $threshold"
          n_updated=$((n_updated + 1))
          ;;
        *)
          err "  FAIL    update $metric: HTTP $HTTP_STATUS $HTTP_BODY"
          n_failed=$((n_failed + 1))
          ;;
      esac
    fi
  fi
done

rm -f "$existing_file"

echo
dim "Resumen condiciones:"
dim "  Creadas:        $n_created"
dim "  Actualizadas:   $n_updated"
dim "  Sin cambios:    $n_skipped"
dim "  Fallidas:       $n_failed"

# ============================================================================
# 6. Asociar gate al proyecto
# ============================================================================

info "Asociando gate al proyecto..."

# Verificar si ya esta asociado (idempotente)
http_get "/api/qualitygates/get_by_project?project=$(url_encode "$PROJECT_KEY")"
if [ "$HTTP_STATUS" = "200" ] && echo "$HTTP_BODY" | grep -q "\"name\":\"${GATE_NAME}\""; then
  ok "Gate ya estaba asociado al proyecto"
else
  http_post "/api/qualitygates/select" \
    "gateName" "$GATE_NAME" \
    "projectKey" "$PROJECT_KEY"

  case "$HTTP_STATUS" in
    200|204) ok "Gate asociado al proyecto" ;;
    *)       die "Error HTTP $HTTP_STATUS asociando gate: $HTTP_BODY" ;;
  esac
fi

# ============================================================================
# 7. Resumen final
# ============================================================================

echo
if [ "$n_failed" -eq 0 ]; then
  ok "Setup completo sin errores."
else
  warn "Setup completo con $n_failed fallidas. Revisa los mensajes arriba."
fi
echo
echo "Proyecto:    ${SONAR_HOST_URL}/dashboard?id=${PROJECT_KEY}"
echo "Quality:     ${SONAR_HOST_URL}/quality_gates/show/$(url_encode "$GATE_NAME")"
echo
dim "Para correr el scanner cuando exista codigo:"
dim "  cd code && npm run test:coverage && npx sonar-scanner"

[ "$n_failed" -eq 0 ] || exit 1
