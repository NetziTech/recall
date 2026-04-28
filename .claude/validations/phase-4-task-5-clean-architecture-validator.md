# Clean Architecture Validator — Phase 4 / Task 4.5

**Scope**: `code/src/shared/application/ports/event-publisher.port.ts` (NEW) +
`code/src/modules/memory/application/` (use cases, ports, errors) +
`code/src/modules/memory/infrastructure/` (persistence, embedding, import-export, errors).

## Resumen
- 14 in-ports + 7 out-ports en `memory/application/ports/` + 1 puerto en `shared/application/ports/`.
- 15 use cases (incl. `SessionContextHelper` colaborador interno).
- 10 archivos en `infrastructure/persistence/` (7 repos + stats + snapshot + wiper readers).
- 1 adapter en `infrastructure/embedding/` (`SqliteEmbeddingEnqueuer`).
- 3 adapters en `infrastructure/import-export/` (json exporter, json importer, markdown handoff parser).
- `npm run validate:modules` → `[OK] memory` sin cross-imports no autorizados.

## CRITICOS
**NINGUNO.**

## No criticos
- Spec del handoff mencionaba 6 out-ports; el codigo expone 7 (`memory-exporter`, `memory-importer`, `handoff-parser`, `embedding-enqueuer`, `memory-snapshot-reader`, `memory-stats-reader`, `memory-wiper`). La separacion exporter/importer/handoff-parser respeta SOLID-ISP (puertos pequenos) — no es una violacion, solo una desviacion numerica documentable.

## Verificaciones realizadas
| # | Check | Resultado |
|---|---|---|
| A1 | `application/` no importa `infrastructure/` | OK (grep 0 hits) |
| A2 | `domain/` no importa app/infra | OK (grep 0 hits) |
| A3 | Use cases inyectan puertos via constructor; cero `new <Adapter>` en application | OK (grep 0 hits sobre `new (Sqlite\|Json\|Markdown)`) |
| B1 | `memory/` no importa de `retrieval/curator/workspace/encryption/secrets/mcp-server/cli/` | OK (grep 0 hits) |
| B2 | `SqliteEmbeddingEnqueuer` escribe `embedding_queue` via `DatabaseConnection` directo, sin importar `EmbeddingQueueRepository` de retrieval | OK — JSDoc lineas 17-47 documenta el coupling explicito a la DDL `002__retrieval-schema.sql` y justifica por ADR-001 §1.5.1 |
| B3 | `npm run validate:modules` | PASS — `[OK] memory` |
| B4 | EventPublisher en `shared/application/ports/event-publisher.port.ts` | OK |
| C | `composition/` NO modificado en Task 4.5 (queda para 4.7) | OK — `wiring/` aun usa stubs `pending-memory-repositories.ts`; los wirings de memory se aplicaran en 4.7 |
| D | Convencion `.port.ts`: 14 in + 7 out + 1 shared = 22 ports, todos con sufijo correcto | OK |
| E | `grep "new (Sqlite\|Json\|Markdown\|Memory.*)"` en application/ | 0 hits |
| F | `SqliteEmbeddingEnqueuer` JSDoc documenta coupling SQL compartido | OK (lineas 17-47, cita docs/01 §2.7 y ADR-001) |
| G | `SessionContextHelper` recibe `sessions/clock/idGen/eventPublisher` por constructor; no instancia adapters; vive en `application/use-cases/` (helper, no port formal) | OK (lineas 54-60 del archivo) |
| H | 7 repos SQLite (`Decision/Learning/Entity/Task/Turn/Session/Relation`) implementan interface domain; cross-imports a propio `memory/domain/` (interno, OK); workspace scoping defensivo via `assertWorkspace(workspaceId)` pinned en constructor | OK (verificado en `sqlite-decision-repository.ts` lineas 123, 208-213) |
| I | Import/export adapters (`JsonMemoryExporter`, `JsonMemoryImporter`, `MarkdownHandoffParser`) en `infrastructure/import-export/`; cero `new` en application | OK |
| J | `SqliteMemoryStatsReader`, `SqliteMemorySnapshotReader`, `SqliteMemoryWiper` en `infrastructure/persistence/`, cada uno implementa su out-port | OK |
| K | EventPublisher port en shared, JSDoc explica uso cross-modulo, NO contiene impl (vive en composition/event-bus) | OK |
| Extra | `domain/` y `application/` libres de `zod`/`better-sqlite3` | OK (grep 0 hits) |

## Seccion: EventPublisher en shared/ — justificacion + estado W-3.3-DDD-2
**Ubicacion**: `code/src/shared/application/ports/event-publisher.port.ts`.

**Justificacion arquitectonica**:
1. `docs/12-lineamientos-arquitectura.md` §1.5 Regla 3 obliga a colocar funcionalidad usada por 2+ modulos en `shared/`. Eventos de dominio cruzan fronteras (recall invalida cache en `decision.superseded`, secrets reacciona a `secrets.detected`, curator escucha `memory.session-ended`), por lo que el puerto es *genuinamente* transversal.
2. SOLID-ISP respetado: el puerto solo expone `publish` y `publishAll` (path de escritura). El subscribe vive en la implementacion del bus en `composition/event-bus/`.
3. SOLID-DIP respetado: `DomainEvent` es la abstraccion comun (define `eventName`); el publisher es dimension-free.

**Estado W-3.3-DDD-2**: **CERRADO**. La JSDoc del puerto (lineas 16-18) documenta explicitamente el cierre del warning. Los use cases (`RecordDecision`, `SessionContextHelper`, `EndSession`, `RecordTurn`, `TrackTask`, etc.) ahora tienen un sumidero formal para `aggregate.pullEvents()` en lugar de descartarlos o falsearlos via Logger.

## Veredicto
**APPROVED.**

Cero violaciones criticas. Direccion de dependencias intacta. Aislamiento modular preservado (memory no toca retrieval/curator/workspace/encryption/secrets/mcp-server/cli; el coupling a `embedding_queue` es a nivel de DDL compartida, no de codigo). Composition root no tocado (correcto: queda para Task 4.7). EventPublisher port correctamente ubicado en `shared/` con JSDoc exhaustiva que cierra W-3.3-DDD-2. Todos los adapters implementan su puerto, todos los use cases reciben dependencias por constructor, todos los repos aplican workspace scoping defensivo. La convencion `.port.ts` se cumple en los 22 puertos nuevos.
