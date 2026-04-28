# Validación QA + SonarQube — Fase 5 Tarea 5.5 — Ciclo 1

**Validator:** `qa-sonarqube-auditor`
**Fecha:** 2026-04-28
**Veredicto:** REJECTED

---

## Quality Gate

**Status:** `ERROR` (FAIL)
URL: https://sonar.netzi.dev/dashboard?id=mcp-memoria-inteligente

### Condiciones violadas

| Métrica | Operador | Threshold | Actual | Status |
|---|---|---|---|---|
| `coverage` | < | 95 | **91.5** | ERROR |
| `new_coverage` | < | 95 | **71.7** | ERROR |
| `new_critical_violations` | > | 0 | **1** | ERROR |
| `new_violations` | > | 0 | **3** | ERROR |

### Condiciones OK
- `new_reliability_rating` = 1 (A)
- `new_security_rating` = 1 (A)
- `new_maintainability_rating` = 1 (A)
- `new_security_review_rating` = 1 (A)
- `duplicated_lines_density` = 1.3% (<3)
- `new_blocker_violations` = 0
- `new_bugs` = 0
- `new_vulnerabilities` = 0
- `new_sqale_debt_ratio` = 0.47% (<5)

---

## Confirmación de issues del ciclo 0

| Issue ciclo 0 | Estado actual | Verificado vía API |
|---|---|---|
| S3516 BLOCKER (`default-secrets-scanner.ts:202`) | RESUELTO | `BLOCKER+BUG total=0` |
| S2612 vulnerability (`filesystem-pre-commit-hook-installer.ts`) | CLOSED | `vulnerabilities total=0 abiertas` (1 instancia con `status=CLOSED`) |
| S5852 ReDoS (`markdown-handoff-parser.ts:46`) | RESUELTO | sin issues abiertas en el archivo |
| Hotspots TO_REVIEW | 0 | `hotspots total=0` |

Los 3 fixes del ciclo 0 están confirmados como aplicados.

---

## Nuevos issues introducidos (bloqueantes)

Aparecen 3 NEW violations en un archivo modificado durante el ciclo 1:

| Rule | Severity | Archivo : línea | Mensaje |
|---|---|---|---|
| `typescript:S3735` | CRITICAL | `src/modules/curator/infrastructure/persistence/sqlite-memory-entry-writer.ts:111` | Remove this use of the `void` operator |
| `typescript:S7746` | MAJOR | `src/modules/curator/infrastructure/persistence/sqlite-memory-entry-writer.ts:112` | Prefer `return value` over `return Promise.resolve(value)` |
| `typescript:S7746` | MAJOR | `src/modules/curator/infrastructure/persistence/sqlite-memory-entry-writer.ts:173` | Prefer `return value` over `return Promise.resolve(value)` |

Estos disparan las condiciones `new_critical_violations=1` y `new_violations=3`.

**Suggested fix:**
- Línea 111: eliminar `void input.workspaceId;` (también en línea 180 si está presente). Si el parámetro no se usa, prefijar con `_` o removerlo del destructuring.
- Líneas 112, 173: cambiar `return Promise.resolve(value)` por `return value` dado que el método es `async` (await/return implícito ya envuelve en Promise).

---

## Métricas de cobertura (Vitest)

| Capa | % Lines | % Stmts | % Branch | % Funcs | Threshold | Status |
|---|---|---|---|---|---|---|
| Global | **93.26** | 93.26 | 91.16 | 96.83 | 95 | FAIL |
| `src/**/domain/**` | 93.93 | 93.93 | 93.38 | 96.28 | 100 | FAIL |
| `src/**/application/**` | 98.75 | 98.75 | 93.31 | 100 | 100 | FAIL |
| `src/**/infrastructure/**` | — | — | 86.61 | — | 90 (branch) | FAIL |

Coverage SonarQube (overall) = **91.5%** (vs 95 requerido). New code coverage = **71.7%** (vs 95).
Tests: **2163 passed** / 186 archivos. `tsc --noEmit` OK. `lint` OK.

### Brecha hasta 95%
- Global está a 93.26% lines / 91.16% branches.
- Faltan ~1.74 puntos de líneas y ~3.84 puntos de branches.
- Branches en infrastructure (86.61%) es el mayor lastre estructural.

Archivos infra <90% líneas detectados en el reporte:
- `infrastructure/filesystem` 89.39% lines (`filesystem.ts`)
- `application-bootstrap.ts` rama 85.71%
- `transaction-writer.ts` 85.29% lines
- `sqlite-database.ts` 88.48% lines

---

## Recomendación al humano (gap de cobertura ≥95)

- **Opción A (recomendada para mantener barra):** añadir tests para los archivos infra <90% (filesystem, transaction-writer, sqlite-database, application-bootstrap edge branches). Estimado: +1–2 puntos globales ⇒ 95%.
- **Opción B (pragmática):** relajar threshold global a 90% en `sonar-project.properties` y `vitest.config.ts`. Decisión humana — fuera del alcance del auditor.

---

## Veredicto final

**REJECTED.** Quality gate FAILED por 4 condiciones:
1. `coverage` 91.5 < 95.
2. `new_coverage` 71.7 < 95.
3. `new_critical_violations` = 1 (S3735 en `sqlite-memory-entry-writer.ts:111`).
4. `new_violations` = 3 (S3735 + 2× S7746 en mismo archivo).

**Acciones mínimas para APPROVED:**
1. Eliminar `void input.workspaceId` y reemplazar `return Promise.resolve(x)` por `return x` en `sqlite-memory-entry-writer.ts` líneas 111, 112, 173, 180, 183 (revisar todas las ocurrencias) ⇒ resuelve 3 new violations.
2. Subir cobertura global ≥95% (Opción A) o decisión humana de relajar threshold (Opción B).
3. Re-correr `sonar-scanner` y verificar `projectStatus.status = OK`.
