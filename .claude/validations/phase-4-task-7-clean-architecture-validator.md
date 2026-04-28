# Clean Architecture Validator — Fase 4 / Tarea 4.7 (Composition Re-wiring)

- **Validator**: `clean-architecture-validator`
- **Phase / Task**: phase-4 / task-7 (composition root re-wiring)
- **Auditor**: opus 4.7
- **Validated at**: 2026-04-27

## Resumen

Tarea 4.7 conecta los 12 stubs `Pending*` previos a los adapters reales producidos en Tareas 4.5 (memory) y 4.6 (encryption). El `composition/persistence/` directorio fue eliminado completamente. Los 5 stubs persistentes están justificados con JSDoc explícito y tipados a través de `CliFacadeNotImplementedError` / `McpFacadeNotImplementedError`. La modularidad se mantiene: el validator de módulos pasa (PASS), composition es el único punto cross-módulo, y workspace sigue sin importar de encryption (el cambio de puerto `DestroyEncryptionFacade` se mantiene confinado al contrato del puerto). El compile de TypeScript es limpio.

## Críticos

Ninguno.

## No críticos

Ninguno.

## Verificaciones realizadas

| Check | Resultado |
|---|---|
| `composition/persistence/` directorio | ELIMINADO (no existe) |
| `composition/persistence/pending-memory-repositories.ts` | NO EXISTE |
| `composition/persistence/pending-encryption-config-repository.ts` | NO EXISTE |
| `PendingDestroyEncryptionFacade` / `PendingGetContextFacade` / `PendingRecallMemoryFacade` / `PendingRememberFacade` / `PendingTrackTaskFacade` | NO EXISTEN |
| `PendingAuditFacade` / `PendingImportHandoffFacade` / `PendingExportFacade` / `PendingImportFacade` / `PendingWipeFacade` / `PendingStatsFacade` | NO EXISTEN |
| `grep "Pending" composition/` | Solo 5 stubs justificados (multi-key x3 + uninstall + server) |
| `npm run validate:modules` | PASS — sin violaciones |
| Cero imports cross-module fuera de composition | OK |
| Cero imports de `composition/` desde `modules/` | OK (solo JSDoc) |
| Puerto `DestroyEncryptionFacade` con `passphrase: string` + JSDoc actualizado | OK |
| `ChangeModeUseCase` propaga passphrase al facade | OK (l.107-112), valida no-vacío |
| Workspace NO importa de encryption | OK (verificado en validate:modules) |
| `EventBusPublisher` adapter en `composition/event-bus/` | OK |
| `Container.eventBus` y `Container.eventPublisher` expuestos | OK (l.396-397) |
| `eventPublisher` inyectado a use cases memory + workspace destroy | OK (memory-wiring l.182-238; container l.274) |
| `RememberFacadeAdapter` switch sobre `kind` con `default: never` exhaustive | OK (mcp-server-facades l.412-510) |
| 5 kinds (decision/learning/entity/turn/task) wirean a use cases reales | OK |
| `WIRE_TO_DOMAIN_LAYER_NAME` y `DOMAIN_TO_WIRE_LAYER_NAME` activas | OK (l.211-233) |
| 7 layers cubiertas, 3 divergencias documentadas | OK (system_identity, project_constitution, code_map) |
| `mem.task.get` / `mem.task.delete` disputes con `McpFacadeNotImplementedError` | OK (l.605-617) |
| `EntityKindWire` mapping defensivo | OK (l.749-759) |
| `tsc --noEmit` | PASS |

## 5 Stubs justificados (persistentes)

1. **`PendingExportKeyFacade`** (cli-facades.ts l.287) — JSDoc cita `docs/11 §3`. Master key es secret transient, no hay flujo de re-print.
2. **`PendingRekeyFacade`** (cli-facades.ts l.302) — JSDoc cita `docs/11 §7`. Requiere multi-envelope flow (multi-key v0.5).
3. **`PendingAddKeyFacade`** (cli-facades.ts l.316) — JSDoc cita multi-key v0.5.
4. **`PendingUninstallHookFacade`** (cli-facades.ts l.362) — JSDoc indica que el secrets module necesita un uninstall use case (gap de módulo).
5. **`PendingServerFacade`** (cli-facades.ts l.722) — JSDoc indica que el path canónico es el binario `mcp-memoria-server`; sub-process orchestration deferred.

Todos rechazan con `CliFacadeNotImplementedError` tipado.

## Veredicto

**APPROVED**

El re-wiring del composition root es arquitectónicamente correcto. Los 12 stubs `Pending*` fueron eliminados; los 5 que permanecen están justificados con JSDoc, tipados, y todos referencian gaps documentados (multi-key v0.5, secrets uninstall, server sub-process). La modularidad se preserva: `validate:modules` pasa, composition sigue siendo el único punto cross-módulo legítimo, workspace no importa de encryption a pesar del cambio de puerto. EventBus, RememberFacade discriminated union, ContextLayerKind mapping y disputes de `mem.task` están correctamente implementados.
