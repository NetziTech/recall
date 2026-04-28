# Phase 4 — Task 5 — Security Auditor

**Validator**: security-auditor
**Scope**: `code/src/modules/memory/application/` + `code/src/modules/memory/infrastructure/` + `code/src/shared/application/ports/event-publisher.port.ts`
**Reference docs**: `HANDOFF.md` §6.7, `docs/11-seguridad-modos.md`, `docs/12-lineamientos-arquitectura.md` §1.5
**Date**: 2026-04-27

---

## Resumen

Auditoría OWASP Top 10 sobre los ~61 archivos del módulo `memory` (application + infrastructure) y el puerto `event-publisher.port.ts` recién publicado en `shared`.

El módulo está diseñado defensivamente: todas las queries SQL usan prepared statements, los repositorios validan workspace pinning en cada operación, los importers validan estrictamente con Zod antes de reconstruir agregados, el wipe es transaccional sobre `DELETE` (no `DROP`), y los logs nunca incluyen contenido de decisiones, learnings, turns o entities (solo IDs/metadata estructurada). El parser de markdown (handoff) es heurístico simple, sin regex catastróficos y con cap duro (`MAX_LINES = 10000`).

La detección de secretos vive en el módulo `secrets/` (separado, sin acoplamiento) y la integración la hace el composition root / capa CLI vía `audit --check-secrets`. Esto respeta la frontera modular declarada en `docs/12 §1.5`. El export envelope NO incluye `secret_audit_log` ni `key_validator_blob` (verificado en `export-memory.port.ts` línea 48), lo que cumple "No incluye passphrase, key, salt en el JSON".

**Hallazgos**: 0 críticos, 0 high, 0 medium, 1 low (refinamiento opcional de invariante en wipe), 3 info (documentación de boundaries).

---

## CRÍTICOS

Ninguno.

---

## HIGH

Ninguno.

---

## MEDIUM

Ninguno.

---

## LOW

### LOW-1 — `WipeMemoryUseCase` no expone parámetro de confirmación tipado

- **Archivo**: `code/src/modules/memory/application/use-cases/wipe-memory.use-case.ts:29-47`
- **Archivo**: `code/src/modules/memory/application/ports/in/wipe-memory.port.ts:41-43`
- **OWASP**: A04 — Insecure Design (defense-in-depth)
- **Detalle**: El use case espera `{ workspaceId }` y procede sin un flag `confirmed: true` adicional. El JSDoc del puerto sí dice explícitamente "The CLI parser is the layer that enforces the `WIPE` literal confirmation; this use case trusts the caller and proceeds." (línea 18-19), por lo que el contrato está documentado y delegado conscientemente a la capa CLI. Esto es aceptable para MVP, pero un parámetro `confirmation: "WIPE"` en el método sería defense-in-depth: si en el futuro otro caller (MCP, REST) invoca `WipeMemory.wipe(...)` sin pasar por el parser CLI, no hay segunda barrera.
- **Severidad**: low (el contrato actual es explícito y `SqliteMemoryWiper` es transaccional, así que un wipe mal dirigido no deja estado parcial; la única consecuencia sería pérdida de datos sin la confirmación literal).
- **Sugerencia (no bloqueante)**: agregar a `WipeMemory.wipe(...)` un campo `readonly confirmation: "WIPE"` tipado literal y validar `if (input.confirmation !== "WIPE") throw …` en el use case. Sin esto, el use case sigue siendo seguro siempre que TODO caller pase por la validación de la capa CLI.

---

## INFO

### INFO-1 — La integración con secrets-detection vive fuera del módulo memory

- **Archivos**: `record-decision.use-case.ts`, `record-learning.use-case.ts`, `record-entity.use-case.ts`, `record-turn.use-case.ts`
- **Detalle**: Ninguno de los `RecordX` use cases invoca un scanner de secretos antes de persistir. Esto es por diseño (`docs/12 §1.5`): el módulo `secrets/` existe separadamente y la composition root / capa MCP-CLI orquesta el escaneo (capa 1 de detección, ver `docs/11 §6`). Verificado: el flag `--check-secrets` se manejaen `code/src/modules/cli/application/use-cases/handlers/secrets-handlers.ts` y existe `secrets/infrastructure/hook/filesystem-pre-commit-hook-installer.ts` para capa 5. Las capas 2-4 son responsabilidad del MCP server adapter. La frontera modular se respeta correctamente; no es violación.
- **Sugerencia (no bloqueante)**: agregar a los JSDoc de los `RecordX` use cases una línea explícita: "secret detection es responsabilidad del adapter MCP/CLI antes de invocar este use case (ver docs/11 §6, capa 1)". Mejora descubribilidad.

### INFO-2 — `AuditMemoryUseCase` no escanea secretos (consistencia ≠ secrets)

- **Archivo**: `audit-memory.use-case.ts`
- **Detalle**: El use case implementa solo checks de consistencia (orphan supersession/consolidation/relations). El comando CLI `mcp-memoria audit --check-secrets` se enruta por separado al módulo `secrets/` (verificado en `commander-cli-parser.ts` línea 151 y `secrets-handlers.ts` línea 42). El nombre `AuditMemory` puede confundirse con "audit completo incluyendo secretos", pero el JSDoc del puerto (`audit-memory.port.ts` líneas 41-60) lista explícitamente las 5 verificaciones que hace; no menciona secretos. Está bien delimitado.

### INFO-3 — `JsonMemoryImporter` re-pinea `workspaceId` (cross-workspace import autorizado)

- **Archivo**: `json-memory-importer.ts:207`, `196-199`
- **Detalle**: El importer NO rechaza un JSON cuyo `workspaceId` original sea distinto del actual; en vez de eso, **re-anchora** cada agregado al `input.workspaceId` recibido. El JSDoc (líneas 196-199) lo documenta: "Cross-workspace imports re-pin every aggregate's `workspaceId` to the supplied `input.workspaceId`." Esto es deliberado y necesario para portabilidad (export workspace A → import workspace B en otra máquina). El usuario menciona "Workspace_id matching (si el JSON dice workspace X y el actual es Y → error o crear workspace nuevo)". El comportamiento actual (re-pin) es funcionalmente equivalente a "crear workspace nuevo" sin la creación. No es un bug; está bien documentado.

---

## Verificaciones realizadas

| Regla | Verificación | Resultado |
|-------|-------------|-----------|
| A03 SQL injection (template strings) | `grep -rEn "db\.(prepare\|exec\|run)\([\`'\"][^...]*\$\{"` en `memory/` | 0 matches |
| A03 SQL injection (string concat en SQL) | `grep -rEn "\$\{[^}]+\}"` filtrado por keywords SQL | 0 matches en SQL |
| Prepared statements | `grep -rEn "prepare\("` en `memory/infrastructure/persistence/` | 26 calls — todas con constantes `SQL_*` o variables que solo eligen entre constantes hardcoded (`sqlite-decision-repository.ts:176-181`) |
| `console.X` calls | `grep -rn "console\."` en `memory/` | 0 matches |
| Hardcoded credentials | `grep -rEn "password\|secret\|apiKey\|token"` en `memory/` | 0 matches sustantivos (solo referencias a "token budget" en JSDoc de VOs y a tabla `secret_audit_log` en docs) |
| Logs de contenido | Inspección manual de cada `logger.X` call (10 archivos) | 0 logs incluyen `title`, `rationale`, `text`, `summary`, `description` |
| Workspace pinning | `grep -rn "assertWorkspace\|workspace mismatch"` | 21 ocurrencias en 7 repos (todos defienden cross-workspace) |
| Wipe atómico | Lectura `sqlite-memory-wiper.ts` | `this.db.transaction(...)` envuelve los DELETEs (línea 69) |
| Wipe NO usa DROP TABLE | Búsqueda `DROP` en wiper | 0 matches; solo 11 sentencias `DELETE FROM <tabla>` |
| Wipe preserva schema/migraciones | Lista de tablas afectadas | NO incluye `_meta`, `pruned`, `curator_runs`, ni tablas de schema; solo tablas de datos memory + retrieval |
| Import validation con Zod | Lectura `json-memory-importer.ts` | `EnvelopeSchema.parse(decoded)` antes de cualquier `Decision.rehydrate(...)` (línea 220) |
| Import schemaVersion check | `json-memory-importer.ts:227-231` | Rechaza si `envelope.schemaVersion !== 1` |
| Export NO incluye secrets/keys | `export-memory.port.ts:48` (JSDoc) + `json-memory-exporter.ts` snapshot fields | Verificado: no incluye `secret_audit_log`, `key_validator_blob`, salts, ni passphrase |
| Markdown parser ReDoS | Inspección de los 7 regex en `markdown-handoff-parser.ts` | Patrones simples sin nested quantifiers; cap `MAX_LINES = 10000` defensivo |
| Markdown parser sin eval | Búsqueda `eval\|Function\(` | 0 matches |
| `SqliteEmbeddingEnqueuer` prepared | Lectura `sqlite-embedding-enqueuer.ts` | `SQL_INSERT` constante con placeholders, sin interpolación |
| `SqliteEmbeddingEnqueuer` no loguea contenido | Sin import de `Logger` | Confirmado (no loggea) |
| Eventos publicados con `await` (acoplamiento al outbox) | Lectura de `record-decision.use-case.ts:90` etc. | `await this.events.publishAll(...)` en cada record use case; el publisher decide la estrategia (sync vs outbox) — adapter responsibility |

---

## Veredicto

**APPROVED**

Cero críticos. Las defensas implementadas son consistentes con `docs/11-seguridad-modos.md` y respetan la frontera modular de `docs/12 §1.5`. El único hallazgo low (LOW-1) es una mejora opcional de defense-in-depth para el wipe; el contrato actual ya delega correctamente la confirmación a la capa CLI y está documentado explícitamente. Los 3 info documentan decisiones arquitectónicas correctas (boundaries entre memory y secrets, re-pin de workspaceId en import) que merecen ser explicitadas en JSDoc para descubribilidad pero no son violaciones.

