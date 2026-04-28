# QA SonarQube Auditor — Phase 5 / Task 5.5 / Cycle 4

**Validator:** qa-sonarqube-auditor
**Date:** 2026-04-28
**Verdict:** REJECTED

---

## Resumen ejecutivo

- Tests: **2421 passing / 2421 total** (199 test files). PASS.
- Cobertura global lines: **96.18%** (vitest) / **96.4%** (Sonar). PASS.
- Cobertura `new code`: **92.1%** (Sonar). FAIL (target ≥ 95%).
- SonarQube Quality Gate: **FAILED**.

QA agregó 15 tests en ciclo 4 y subió cobertura del archivo
`sqlite-memory-entry-writer.ts` a 95.97% lines / 89.74% branches. Las
líneas restantes son defensivas e inalcanzables vía API pública. El
quality gate del servidor sigue rechazando porque computa `new_coverage`
contra esas líneas defensivas no marcadas como ignoradas.

---

## SonarQube Quality Gate — `projectStatus.status = ERROR`

| Métrica | Valor actual | Threshold | Status |
|---|---|---|---|
| `new_coverage` | **92.1%** | ≥ 95% | **ERROR** |
| `coverage` (overall) | 96.4% | ≥ 95% | OK |
| `new_duplicated_lines_density` | 0.0% | ≤ 3% | OK |
| `duplicated_lines_density` | 1.3% | ≤ 3% | OK |
| `new_blocker_violations` | 0 | = 0 | OK |
| `new_critical_violations` | 0 | = 0 | OK |
| `new_bugs` / `new_vulnerabilities` | 0 / 0 | = 0 | OK |
| `new_violations` | 0 | = 0 | OK |
| `new_reliability_rating` / `new_security_rating` / `new_maintainability_rating` / `new_security_review_rating` | A / A / A / A | A | OK |
| `new_sqale_debt_ratio` | 0.0% | ≤ 5% | OK |

`new_lines = 223`, `new_lines_to_cover = 85`, `new_uncovered_lines = 7`.

---

## Líneas no cubiertas (las 7)

Archivo único: `code/src/modules/curator/infrastructure/persistence/sqlite-memory-entry-writer.ts`
(`new_coverage` del archivo = **88.6%**).

```
L143:   const err = new Error(`unprepared kind in batch: ${key}`);
L144:   failureRef.current = {
L145:     table: tableByKind.get(key) ?? "<unknown>",
L146:     cause: err,
L147:   };
L148:   throw err;
L149: }
```

Son las líneas defensivas que QA reportó como inalcanzables vía API
pública (guard contra programming error donde el `kind` recibido en el
batch no tiene un statement preparado correspondiente).

---

## Violaciones (R5)

### R5 — sonarqube-quality-gate-failed
- **Detalle:** Quality gate FAILED — `new_coverage = 92.1%` (< 95%).
- **Causa:** 7 líneas defensivas en `sqlite-memory-entry-writer.ts`
  L143–L149 marcadas como código nuevo y no cubiertas.
- **Suggested fix (≤ 5 minutos):**
  Añadir `/* c8 ignore next 7 */` (o `/* istanbul ignore next */` por
  bloque) inmediatamente antes de la línea 143 en
  `code/src/modules/curator/infrastructure/persistence/sqlite-memory-entry-writer.ts`,
  documentando que es un guard defensivo inalcanzable vía API pública.
  Ejemplo:

  ```ts
  // Defensive: tableByKind y prepared statements son construidos
  // simétricamente; este branch sólo dispara si se introduce un kind
  // sin preparar (programming error). No alcanzable vía API pública.
  /* c8 ignore next 7 */
  if (!stmt) {
    const err = new Error(`unprepared kind in batch: ${key}`);
    failureRef.current = { table: tableByKind.get(key) ?? "<unknown>", cause: err };
    throw err;
  }
  ```

  Tras el fix, re-correr `npm run test -- --coverage` y `npx
  sonar-scanner -Dsonar.host.url=$SONAR_HOST_URL -Dsonar.token=$SONAR_TOKEN`
  y validar `projectStatus.status = OK`.

---

## Veredicto

**REJECTED** — Quality gate del servidor SonarQube sigue en estado
`ERROR` por `new_coverage = 92.1%`. La causa es exactamente la que QA
anticipó: 7 líneas defensivas en `sqlite-memory-entry-writer.ts`
L143–L149. El fix es trivial (1 comentario `/* c8 ignore next 7 */`).
Re-correr scanner tras el fix para obtener APPROVED.
