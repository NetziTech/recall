# DDD Re-Validation — Phase 1, Task 7 (Cycle 1): cli/domain
**Validator:** ddd-validator
**Phase:** phase-1-domain (cli module — re-validation of cycle 0 blocker)
**Scope:** `code/src/modules/cli/domain/` (12 archivos: 1 aggregate, 5 VOs, 1 event, 4 errors, 1 repository)
**Date:** 2026-04-27
**Verdict:** APROBADO

El bloqueante único del ciclo 0 (catálogo `COMMAND_NAMES` con dos entradas — `"lock"` y `"status"` — sin respaldo en `docs/07-instalacion.md` §7) está resuelto. El catálogo final tiene exactamente las 20 entradas documentadas, en el mismo orden de la fuente de verdad. Se atendió además el hallazgo no bloqueante #2 (drift del comentario que citaba `docs/03-modelo-datos.md` §10 cuando la sección real es §4.8). No se introdujeron regresiones: el resto del módulo (VOs, agregado, repositorio, eventos, errores) permanece DDD-correcto y no se modificó.

---

## Verificaciones del ciclo

### V1. Catálogo `COMMAND_NAMES` — 20 entradas, orden coincide con docs/07 §7

**Archivo:** `code/src/modules/cli/domain/value-objects/command-name.ts:21-50`

Conteo automatizado:

```
$ grep -cE '^\s+"[a-z-]+",' code/src/modules/cli/domain/value-objects/command-name.ts
20
```

Mapping uno-a-uno contra `docs/07-instalacion.md` §7 (líneas 320-358):

| # | Catálogo (`command-name.ts`) | doc §7 (línea) | Sección agrupadora |
|---|---|---|---|
| 1 | `"init"` (L23) | L324 | Inicialización / mode |
| 2 | `"mode"` (L24) | L325 | Inicialización / mode |
| 3 | `"unlock"` (L26) | L328 | Encryption key lifecycle |
| 4 | `"forget-key"` (L27) | L329 | Encryption key lifecycle |
| 5 | `"export-key"` (L28) | L330 | Encryption key lifecycle |
| 6 | `"rekey"` (L29) | L331 | Encryption key lifecycle |
| 7 | `"add-key"` (L30) | L332 | Encryption key lifecycle |
| 8 | `"audit"` (L32) | L335 | Maintenance |
| 9 | `"sanitize"` (L33) | L336 | Maintenance |
| 10 | `"curator-run"` (L34) | L337 | Maintenance |
| 11 | `"curator-log"` (L35) | L338 | Maintenance |
| 12 | `"import-handoff"` (L37) | L341 | Migration |
| 13 | `"export"` (L39) | L344 | Backup / restore |
| 14 | `"import"` (L40) | L345 | Backup / restore |
| 15 | `"wipe"` (L41) | L346 | Backup / restore |
| 16 | `"install-hook"` (L43) | L349 | Hooks |
| 17 | `"uninstall-hook"` (L44) | L350 | Hooks |
| 18 | `"stats"` (L46) | L353 | Stats / health |
| 19 | `"health"` (L47) | L354 | Stats / health |
| 20 | `"server"` (L49) | L357 | Server entry-point |

Coincidencia exacta: 20/20. Los comentarios agrupadores del array (`// Initialisation / mode`, `// Encryption key lifecycle`, `// Maintenance`, `// Migration`, `// Backup / restore`, `// Hooks`, `// Stats / health`, `// Server entry-point`) reflejan el ordenamiento por secciones del propio doc, lo que mantiene la trazabilidad visual entre código y SSOT documental.

### V2. Cero referencias a `"lock"` o `"status"` como literales de comando

```
$ grep -rE "\"lock\"|\"status\"" code/src/modules/cli/domain/
NO MATCHES
```

Búsqueda más amplia (substrings) para descartar usos espurios:

```
$ grep -rnE "\block\b|\bstatus\b" code/src/modules/cli/domain/
command-args.ts:16        // "lock the domain to one specific argument syntax" (verbo inglés en JSDoc)
command-output.ts:6       // "the exit status the process is about to return" (status como sinónimo de exit code)
command-name.ts:54        // "stays in lock-step with the runtime list" (lock-step expresión)
exit-code.ts:48           // "stays in lock-step with the runtime catalog" (idem)
exit-code.ts:62           // "Value object representing the integer status with which the CLI..."
```

Las cinco menciones restantes son **legítimas y no constituyen comandos**: cuatro son inglés natural en docstrings (`lock the domain`, `lock-step`, `exit status`) y la última (`exit-code.ts:62`) describe el `ExitCode` VO. Igualmente, las cinco ocurrencias en `cli/domain/` que **contienen** las subcadenas `lock` o `status` provienen exclusivamente de:

- `"unlock"` (catálogo legítimo, doc §7 L328) y `mcp-memoria unlock` (referencias en docstrings).
- `lockedWorkspace` (clave de exit code, no comando — `exit-code.ts:40, 18, 68`).
- `lock-step` / `lock the domain` / `exit status` (inglés natural en docstrings).

Confirmación cross-módulo (sólo `cli/`):

```
$ grep -rn "\"lock\"\|\"status\"" code/src/modules/cli/
(sin resultados)
```

Cero residuos. El catálogo es ahora la única SSOT del set de comandos y coincide con la doc.

### V3. No hay regresiones por el cambio

Cambios efectivos en `command-name.ts`:

- Eliminadas 2 líneas (las que aportaban `"lock"` y `"status"`).
- Comentarios agrupadores ajustados al nuevo recuento (sigue habiendo 7 grupos, alineados con doc §7).
- `as const` se mantiene → `CommandNameValue` se sigue derivando automáticamente de la lista, ahora con 20 miembros en lugar de 22 (no rompe TypeScript: el tipo es más estrecho, lo cual era el efecto deseado).

Verificaciones DDD que **no** debían romperse y que sigo confirmando:

| Criterio | Estado |
|---|---|
| `private constructor` en `CommandName` (L83) | OK |
| Factory `create(...)` valida membresía vía `isValue` (L94-103) | OK |
| Factory `isValue(candidate)` itera sobre `COMMAND_NAMES` (L110-116) — sigue funcionando, ahora reconoce 20 | OK |
| Factory `all()` retorna copia frozen (L124-126) — ahora devuelve 20 entradas | OK |
| `equals(other)` por `value` (L132-134) | OK |
| `toString(): CommandNameValue` (L128-130) | OK |
| `UnknownCommandError` se sigue lanzando con el `raw` original (L96, L100) | OK |

Efecto contractual del cambio: `CommandName.create("lock")` y `CommandName.create("status")` — que antes devolvían instancias válidas — ahora lanzan `UnknownCommandError`. Esto es **deseado**: ningún caso de uso documentado dependía de esos tokens, no hay infraestructura ni applications-layer aún (Fase 1 = sólo dominio), y la coherencia con la SSOT documental es justamente lo que pedía el bloqueante. Cero callsites afectados en `cli/`:

```
$ ls code/src/modules/cli/
domain
```

Solo existe `domain/`. No hay aplicación ni infraestructura que pudiera romperse.

Resto del módulo no tocado:

| Archivo | Estado |
|---|---|
| `aggregates/command-history.ts` | sólo cambió el comentario de `MAX_CAPACITY` (V4) — ver abajo |
| `value-objects/command-args.ts` | intacto |
| `value-objects/command-output.ts` | intacto |
| `value-objects/exit-code.ts` | intacto |
| `value-objects/command-execution.ts` | intacto |
| `repositories/command-history-repository.ts` | intacto |
| `errors/*.ts` (4 archivos) | intactos |
| `events/command-executed.ts` | intacto |

### V4. Hallazgo no bloqueante #2 (drift de comentario JSDoc) atendido

**Archivo:** `code/src/modules/cli/domain/aggregates/command-history.ts:21-23`

Antes (ciclo 0): "ver `docs/03-modelo-datos.md` §10 'audit_log'".
Ahora (ciclo 1, L20-23):

```
 * Hard upper bound on the buffer size. Beyond this number, the
 * `CommandHistory` stops being a "recent activity" view and becomes a
 * full audit log — a concern that belongs to a dedicated audit module
 * (see `docs/03-modelo-datos.md` §4.8 "audit_log") rather than to the
 * CLI domain.
```

Verificación contra la doc:

```
$ grep -nE "^### 4\.8" docs/03-modelo-datos.md
347:### 4.8 Tabla `audit_log`
```

Sección `§4.8 Tabla audit_log` **existe** en `docs/03-modelo-datos.md` (línea 347-359), incluye DDL completa (`CREATE TABLE audit_log ...`, `CREATE INDEX idx_audit_time ...`) y propósito ("Audit trail completo …" en el preámbulo §4). Cita correcta. Drift resuelto.

---

## Estado de hallazgos del ciclo 0

| # | Severidad | Descripción | Estado |
|---|---|---|---|
| 1 | CRÍTICO | `COMMAND_NAMES` incluía `"lock"` y `"status"` no documentados en `docs/07-instalacion.md` §7 | **RESUELTO** — catálogo reducido a 20 entradas exactamente coincidentes |
| 2 | NO BLOQUEANTE | Drift de comentario: cita `docs/03 §10` en lugar de `§4.8` | **RESUELTO** — comentario actualizado |
| 3 | NO BLOQUEANTE | `CommandExecution.equals` no se invoca aún en ninguna invariante del dominio | **PENDIENTE (no bloqueante)** — el método sigue siendo defensa correcta del contrato VO; no requiere acción en Fase 1 |

---

## Reporte JSON

```json
{
  "validator": "ddd-validator",
  "phase": "phase-1-domain",
  "module": "cli",
  "cycle": 1,
  "verdict": "APROBADO",
  "blocker_resolved": {
    "rule": "R7-ubiquitous-language",
    "file": "code/src/modules/cli/domain/value-objects/command-name.ts",
    "previous_issue": "COMMAND_NAMES contained \"lock\" and \"status\" not present in docs/07-instalacion.md §7.",
    "resolution": "Removed both entries. Catalog now has exactly 20 entries matching docs/07 §7 in order: init, mode, unlock, forget-key, export-key, rekey, add-key, audit, sanitize, curator-run, curator-log, import-handoff, export, import, wipe, install-hook, uninstall-hook, stats, health, server.",
    "verified_by": [
      "grep -cE '^\\s+\"[a-z-]+\",' command-name.ts → 20",
      "grep -rE '\"lock\"|\"status\"' code/src/modules/cli/domain/ → no matches",
      "1:1 mapping vs docs/07-instalacion.md §7 (lines 320-358)"
    ]
  },
  "non_blocking_resolved": [
    {
      "rule": "doc-reference-accuracy",
      "file": "code/src/modules/cli/domain/aggregates/command-history.ts",
      "previous_issue": "Cited docs/03-modelo-datos.md §10 (non-existent) for audit_log.",
      "resolution": "Updated to docs/03-modelo-datos.md §4.8 — verified existing at line 347 of docs/03-modelo-datos.md."
    }
  ],
  "non_blocking_pending": [
    {
      "rule": "ddd-vo-equals-usage",
      "file": "code/src/modules/cli/domain/value-objects/command-execution.ts",
      "detail": "CommandExecution.equals not invoked by any domain invariant yet. Defense-in-depth, acceptable for Phase 1.",
      "blocking": false
    }
  ],
  "regressions": [],
  "notes": "Cero archivos del módulo distintos a command-name.ts y command-history.ts fueron modificados. Cero callsites afectados (la fase 1 sólo tiene domain/, no hay application/infrastructure todavía)."
}
```

---

## Conclusión

El módulo `cli/domain/` cumple ahora los lineamientos DDD §1.2 sin excepciones: identidad explícita en VOs, agregado con factory + invariantes custodiadas + `pullEvents()`, repositorio que trabaja con el agregado completo, evento `CommandExecuted` past-tense con payload self-describing, errores tipados con `code` estable y, ahora sí, **catálogo de comandos alineado uno-a-uno con la única SSOT documental** (`docs/07-instalacion.md` §7). Tarea 7 de Fase 1 aprobada por DDD.
