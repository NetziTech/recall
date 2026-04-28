# Phase 4 — Composition Root — Clean Architecture Validator

**Phase**: `phase-4-composition`
**Validated**: 2026-04-27
**Validator**: `clean-architecture-validator`
**Scope**: `code/src/composition/` (21 archivos) + `code/src/bootstrap/` (5 archivos)

---

## Resumen ejecutivo

La arquitectura del wiring es **conforme** a los lineamientos
`docs/12 §1.5` (Regla 4 — composition es la única excepción legítima
cross-módulo) y `§3.1` (convención `.port.ts`). El composition root
construye el grafo por DI explícita, sin service locator ni singletons
globales, y respeta el aislamiento de módulos en ambas direcciones
(módulos no importan composition; composition no define puertos).

Los 19 stubs `Pending*` documentados son la única forma legítima de
wirear los gaps funcionales (módulo memory sin app+infra, encryption
sin persistence concreto, multi-key v0.5 fuera de alcance, D-102
diferido). Cada stub implementa el puerto completo y rechaza con error
tipado `code: "composition.*-pending"`. Esto NO viola Clean
Architecture; es un disputed gap funcional rastreable.

---

## CRÍTICOS (violaciones arquitectónicas)

**Ninguno.**

---

## No críticos / observaciones

1. `composition/cli.ts` y `composition/server.ts` son one-liners
   (`import "../bootstrap/cli-entrypoint.ts"`). Son targets estables de
   `tsup` para los binarios `dist/cli.js` y `dist/server.js`. El
   acoplamiento `composition → bootstrap` es asimétrico (lo normal es
   `bootstrap → composition`), pero se justifica por el build
   pipeline. Aceptable.
2. `bootstrap/event-bus.ts` y `bootstrap/tool-registry-bootstrap.ts` son
   re-exports puros desde `composition/` para facilitar el surface al
   build script. Sin lógica duplicada. Conforme.
3. `mcp-server-wiring.ts` línea 41 menciona "boot-time singletons"
   refiriéndose a `dispatcher` y `registry` — son singletons del
   container (alcance de instancia), NO singletons globales. Correcto.

---

## Verificaciones ejecutadas

| Regla | Cómo se verificó | Resultado |
|---|---|---|
| A.1 — composition puede importar todos los módulos | Lectura de `container.ts`, `wiring/*.ts`, `facades/*.ts` | OK (intencional) |
| A.2 — ningún módulo importa de composition | `grep -rEn "from ['\"][^'\"]*composition" code/src/modules/` | 0 matches |
| A.3 — bootstrap solo importa de composition + shared + node:* | `grep -E "^import" code/src/bootstrap/*.ts` | 0 imports a `modules/` |
| A.4 — `validate-modules` PASS | `npm run validate:modules` | PASS (8 módulos OK) |
| B.1 — DI por construcción explícita | Lectura de `buildContainer` y wirings | OK — cada UC recibe puertos por constructor |
| B.2 — sin `getContainer()` global | `grep -rEn "getContainer\|globalThis"` en composition | 0 matches |
| B.3 — sin imports de container desde modules | `grep -rEn "container" code/src/modules/` | 0 matches |
| C — stubs implementan puertos completos | Lectura de `pending-*.ts` y facades | OK — todos lanzan error tipado con código `composition.*-pending` |
| D — composition NO define puertos | `find composition -name "*.port.ts"` | 0 matches |
| E.1 — entrypoints sin lógica de negocio | Lectura de `cli-entrypoint.ts` (69 lns), `mcp-server-entrypoint.ts` (86 lns) | OK — solo bootstrap + signal handlers |
| E.2 — SIGTERM/SIGINT con shutdown limpio + secure-zero | `composition-root.ts` líneas 217-229 | OK — `unlockedKey.bytes.fill(0)` |
| F — D-102 documentado en JSDoc | `mcp-server-facades.ts` líneas 158-187 (tabla wire ↔ domain) | OK — diferido a Fase 5 con tabla completa |

---

## Disputes y stubs (gaps funcionales, NO arquitectónicos)

El wiring expone correctamente cinco superficies de stubs documentados.
Cada una rechaza con error tipado y se rastrea con código canónico:

1. **`PendingEncryptionConfigRepository`** (composition/persistence/) —
   gap de Fase 3 D-309: el módulo encryption no produjo el adapter
   concreto que mapea VOs crypto a la slice on-disk
   (`docs/03 §2`). Código: `composition.encryption-config-repository-pending`.
2. **`PendingLearningRepository` + `PendingSessionRepository`**
   (composition/persistence/) — el módulo `memory` solo tiene
   `domain/`; faltan `application/` + `infrastructure/`. Inyectados en
   `ConsolidateSimilarUseCase` y `RollupSessionUseCase`. Código:
   `composition.memory-repository-pending`.
3. **`PendingDestroyEncryptionFacade`** — el use case
   `DestroyEncryption` (transición `encrypted → private`) no existe en
   el módulo encryption. Código: `composition.destroy-encryption-pending`.
4. **4 stubs MCP** (`PendingGetContextFacade`, `PendingRecallMemoryFacade`,
   `PendingRememberFacade`, `PendingTrackTaskFacade`) — el primero
   bloqueado por D-102 (mapping wire ↔ domain de `ContextLayerKind`),
   los otros tres por gap del módulo memory. Código:
   `composition.mcp-facade-pending`.
5. **8 stubs CLI** (`ExportKey`, `Rekey`, `AddKey`, `Audit`,
   `UninstallHook`, `ImportHandoff`, `Export`, `Import`, `Wipe`,
   `Stats`, `Server`) — multi-key v0.5 (`docs/11 §7`), use cases del
   módulo memory ausentes, y `UninstallHook` que necesita un use case
   nuevo en secrets. Código: `composition.cli-facade-pending`.

**Recomendación arquitectónica**: estos gaps requieren al menos UNA
tarea adicional de cierre antes de Fase 5 testing E2E:

- **Tarea sugerida 4.5 (memory module application+infrastructure)**:
  ship `RememberDecisionUseCase`, `RememberLearningUseCase`,
  `TrackTaskUseCase`, `LearningRepository` (sqlite),
  `SessionRepository` (sqlite), `MemoryEntryProjectionRepository`
  read-side. Cierra disputes 2, 4 (parcial), 5 (parcial: audit,
  export, import, wipe, stats, importHandoff).
- **Tarea sugerida 4.6 (encryption persistence + destroy)**: ship
  `SqliteEncryptionConfigRepository` con la codificación base64 de
  `KdfParams`/`EncryptedMasterKey`/`KeyValidatorBlob`/`SaltBytes`/`KeyEnvelope`,
  más `DestroyEncryptionUseCase`. Cierra disputes 1 y 3.
- **D-102** (mapping `LayerNameWire ↔ ContextLayerKindValue`) y
  multi-key v0.5 quedan correctamente diferidos a Fase 5 architect.

Hasta que estas tareas se completen, los flujos correspondientes
fallarán con errores tipados claros — comportamiento adecuado para una
release alpha.

---

## Verdict

**APPROVED** — La arquitectura del composition root es correcta. Cero
violaciones de modularidad, cero ports en composition, cero
service-locator, DI por construcción, entrypoints minimalistas con
shutdown limpio y secure-zero de claves. Los 19 stubs `Pending*` son
gaps funcionales documentados con error tipado, no violaciones
arquitectónicas.

**Recomendación**: agendar **Tareas 4.5 (memory app+infra) y 4.6
(encryption persistence + destroy)** antes de Fase 5 testing E2E para
cerrar los gaps funcionales. D-102 y multi-key v0.5 permanecen
diferidos al architect de Fase 5 según lo planeado.
