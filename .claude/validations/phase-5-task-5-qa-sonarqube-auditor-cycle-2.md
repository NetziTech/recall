# Validación QA + SonarQube — Fase 5 Tarea 5.5 — Ciclo 2

**Validator:** `qa-sonarqube-auditor`
**Fecha:** 2026-04-28
**Veredicto:** REJECTED

---

## Quality Gate

**Status:** `ERROR` (FAIL)
**Dashboard:** https://sonar.netzi.dev/dashboard?id=mcp-memoria-inteligente
**Periodo de análisis:** PREVIOUS_VERSION (desde 2026-04-28T10:39:13Z)
**caycStatus:** `over-compliant`

### Condiciones violadas (2)

| Métrica | Operador | Threshold | Actual ciclo 1 | Actual ciclo 2 | Status |
|---|---|---|---|---|---|
| `coverage` | < | 95 | 91.5 | **93.9** | ERROR |
| `new_coverage` | < | 95 | 71.7 | **75.5** | ERROR |

Mejora vs ciclo 1: +2.4 pts en `coverage`, +3.8 pts en `new_coverage`. Insuficiente — siguen ambos bajo 95%.

### Condiciones OK (12)

| Métrica | Threshold | Actual | Status |
|---|---|---|---|
| `new_reliability_rating` | ≤ A | A (1) | OK |
| `new_security_rating` | ≤ A | A (1) | OK |
| `new_maintainability_rating` | ≤ A | A (1) | OK |
| `new_security_review_rating` | ≤ A | A (1) | OK |
| `new_duplicated_lines_density` | ≤ 3% | 0.0 | OK |
| `duplicated_lines_density` | ≤ 3% | 1.3 | OK |
| `new_blocker_violations` | = 0 | 0 | OK |
| `new_bugs` | = 0 | 0 | OK |
| `new_critical_violations` | = 0 | **0** | OK ✓ |
| `new_violations` | = 0 | **0** | OK ✓ |
| `new_vulnerabilities` | = 0 | 0 | OK |
| `new_sqale_debt_ratio` | ≤ 5% | 0.0 | OK |

---

## Confirmación issues ciclo 1 (RESUELTOS)

| Issue ciclo 1 | Status actual | Comentario |
|---|---|---|
| `S3735` CRITICAL `sqlite-memory-entry-writer.ts:111` `void` operator | **CLOSED** | API: `key=aff81ede-…` resolved 2026-04-28 14:22 |
| `S7746` MAJOR `sqlite-memory-entry-writer.ts:112` `Promise.resolve` | **CLOSED** | API: `key=1b31c62a-…` resolved 2026-04-28 14:22 |
| `S7746` MAJOR `sqlite-memory-entry-writer.ts:173` `Promise.resolve` | **CLOSED** | API: `key=4ce14ae3-…` resolved 2026-04-28 14:22 |

`GET /api/issues/search?severities=CRITICAL,MAJOR&inNewCodePeriod=true&statuses=OPEN,CONFIRMED,REOPENED` → **`total=0`**.
Los 9 sitios reportados por backend (`void input.workspaceId` + 7× `Promise.resolve(...)`) están confirmados arreglados.

---

## Métricas de cobertura (Sonar API)

| Métrica | Valor | Target | Δ vs ciclo 1 |
|---|---|---|---|
| `coverage` (overall) | 93.9 % | ≥ 95 | +2.4 |
| `line_coverage` | 94.3 % | — | +1.7 |
| `branch_coverage` | 92.5 % | — | +1.4 |
| `new_coverage` | 75.5 % | ≥ 95 | +3.8 |
| `new_line_coverage` | 74.1 % | — | n/d |
| `new_branch_coverage` | 81.0 % | — | n/d |
| `lines_to_cover` | 24 688 | — | — |
| `uncovered_lines` | 1 415 | — | — |
| `uncovered_conditions` | 460 | — | — |

### Métricas vitest reportadas (informativo)
- `vitest run --coverage` reportó: global lines **96.02 %**, domain **99.13 %**, application **99.33 %**, infrastructure **~95 %**.
- Vitest exit ≠ 0 por thresholds estrictos por carpeta (domain 100 %, application 100 %, branches 95 %) pero **no afecta a Sonar** (Sonar se basa en `coverage/lcov.info`).

---

## Causa raíz de la discrepancia (96 % vitest vs 93.9 % Sonar)

`vitest.config.ts` excluye correctamente del cálculo:
- `src/composition/**`
- `src/**/*.port.ts`
- `src/**/index.ts`
- `src/modules/*/domain/repositories/*.ts`

`sonar-project.properties` **no replica** estas exclusiones — solo excluye `*.spec.ts`, `*.bench.ts`, `migrations/`, `dist/`. Resultado: Sonar mide composition root (0 % cov, 452 LOC sin cubrir) y bootstrap (3.4 %, 283 LOC) como negativos, lo que diluye `coverage` de 96 % → 93.9 %.

### Top-15 directorios peor cubiertos (Sonar)

| Path | Coverage | Líneas no cubiertas |
|---|---|---|
| `src/composition` | 0.0 % | 452 |
| `src/composition/event-bus` | 0.0 % | 28 |
| `src/composition/facades` | 0.0 % | 267 |
| `src/composition/tools` | 0.0 % | 8 |
| `src/composition/wiring` | 0.0 % | 124 |
| `src/bootstrap` | 3.4 % | 283 |
| `src/modules/encryption/infrastructure/database` | 42.9 % | 4 |
| `src/modules/cli/infrastructure/output` | 44.1 % | 52 |
| `src/modules/encryption/infrastructure/errors` | 57.3 % | 87 |
| `src/modules/cli/application/dtos` | 66.7 % | 1 |
| `src/modules/encryption/infrastructure` | 78.4 % | 239 |
| `src/modules/curator/application/errors` | 80.0 % | 7 |
| `src/modules/encryption/infrastructure/kdf` | 80.2 % | 19 |
| `src/modules/encryption/infrastructure/cipher` | 80.6 % | 55 |
| `src/modules/encryption/infrastructure/persistence` | 84.3 % | 70 |

Las dos primeras categorías (composition + bootstrap) son **wiring puro / composition root** — explícitamente excluidos por `docs/12 §1 R4` del cálculo "global ≥ 95 %". El resto es deuda real (sobre todo `encryption/infrastructure` ~78 %).

---

## Requisitos para APPROVED en ciclo 3

Dos caminos posibles (decisión humana / orchestrator):

### Opción A — Alinear Sonar con vitest (recomendado, no destructivo)
Añadir a `code/sonar-project.properties`:

```
sonar.coverage.exclusions=\
  src/composition/**,\
  src/bootstrap/**,\
  src/**/*.port.ts,\
  src/**/index.ts,\
  src/modules/*/domain/repositories/*.ts
```

Esto refleja la decisión arquitectónica documentada (composition root no es lógica de negocio testeable). Estimado post-fix: `coverage` ≈ 96 %, `new_coverage` ≈ 95-96 % → quality gate PASS.

### Opción B — Cubrir realmente los gaps de infrastructure
- Encryption infrastructure (`cipher`, `kdf`, `errors`, `persistence`): +~370 LOC a cubrir.
- CLI output: +52 LOC.
Estimado: subir overall coverage a ~95.5 %. Más costoso, no resuelve `new_coverage` 75.5 % por sí solo si los archivos nuevos son composition.

**Recomendado:** Opción A + un sweep menor a `encryption/infrastructure/cipher` y `kdf` (los gaps reales de seguridad merecen tests aunque pasen el gate).

> Nota: `branch_coverage` global 92.5 % NO es condición del quality gate (Sonar mide solo `coverage` y `new_coverage` que son lines+branches combinados). No requiere relajar threshold.

---

## Resumen ejecutivo

| Aspecto | Ciclo 1 | Ciclo 2 | Cambio |
|---|---|---|---|
| Quality gate | FAIL | FAIL | sin cambio |
| Coverage overall | 91.5 % | 93.9 % | +2.4 ✓ |
| New coverage | 71.7 % | 75.5 % | +3.8 ✓ |
| New critical violations | 1 | **0** | resuelto ✓ |
| New violations | 3 | **0** | resuelto ✓ |
| Tests passing | 2 163 | 2 406 | +241 ✓ |
| Domain lines | 93.93 % | 99.13 % | +5.20 ✓ |
| Application lines | 98.75 % | 99.33 % | +0.58 ✓ |

Backend resolvió **todos los issues del ciclo 1** (S3735 + S7746) y elevó cobertura material. Pero quality gate **continúa en ERROR** por las dos condiciones de coverage que dependen de la configuración de exclusiones en `sonar-project.properties`, no del trabajo de tests.

---

## Veredicto

**REJECTED** — Quality gate FAIL en `coverage` (93.9 % < 95 %) y `new_coverage` (75.5 % < 95 %).

Bloqueante NO es falta de tests (vitest mide 96 %), sino que `sonar-project.properties` no excluye composition/bootstrap como sí hace `vitest.config.ts`. Acción requerida en ciclo 3: añadir `sonar.coverage.exclusions` (Opción A) y re-correr scanner. No se aprueba un quality gate ERROR — sin negociación en threshold 95 %.
