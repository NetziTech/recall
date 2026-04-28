# DDD Validation — Phase 1, Task 2: workspace/domain (Cycle 1)
**Validator:** ddd-validator
**Date:** 2026-04-27
**Verdict:** APROBADO

## Resumen del ciclo

El ciclo anterior (`phase-1-task-2-ddd-validator.md`) cerró con un único bloqueante: la incompatibilidad entre el contrato `eventName` declarado en `shared/domain/types/domain-event.ts` (PascalCase past-tense) y el formato adoptado en los cuatro eventos del workspace (`"workspace.*"` kebab-case con namespace por contexto). El orquestador adoptó la **opción B (recomendada por el auditor)**: relajar el contrato del shared para reconocer el formato `<module>.<event-name-in-past-tense-kebab-case>`. Adicionalmente, el `domain-architect` aplicó las siete advertencias triviales y cosméticas listadas en el ciclo 0.

Este ciclo verifica que el bloqueante quedó resuelto, que las correcciones se aplicaron tal como se pactaron, y que no aparecieron regresiones colaterales por el cambio.

## Hallazgos

### CRÍTICOS (bloquean aprobación)

Ninguno.

### ADVERTENCIAS (no bloquean pero a corregir antes de cerrar fase)

Ninguna nueva. Las advertencias del ciclo 0 quedaron resueltas (ver "Verificación de correcciones" abajo). Quedan como ítems abiertos no-bloqueantes para cierre de Fase 1, ya levantados en el ciclo 0 y NO objeto de re-validación en este ciclo:

- **[`docs/11-seguridad-modos.md` §5 vs `aggregates/workspace.ts:37-42`]** Inconsistencia documental: el código prohíbe `encrypted -> shared` directa (forzando paso intermedio por `private`), mientras que el spec literal lista la transición como permitida con warning. Es **defendible pero diverge de la spec literal**. Decisión de orquestador para cierre de fase: o actualizar el spec, o relajar el código. No es violación DDD per se.
- **[`embedder-spec.ts:38-44`]** La tabla `FASTEMBED_MODEL_DIMENSIONS` está hardcoded. Aceptable hoy (3 entradas), candidato a extracción a un `EmbedderModelCatalog` si crece.
- **[`workspace-path.ts`]** El VO no se referencia desde el aggregate `Workspace` ni desde `WorkspaceConfig` (solo lo consume `WorkspaceDetector` como input). Decisión defendible que el path NO sea estado del aggregate (lo gestiona el adapter); conviene documentarlo en el JSDoc de `Workspace` para el siguiente lector.
- **[`workspace-mode.ts:54-72`]** `WorkspaceMode.create` valida case-sensitively. Coherente con la nota en líneas 50-52 ("case is significant"). Decisión menor para coordinar con el parser de `config.json`.

### POSITIVOS (qué quedó bien hecho en este ciclo)

#### Bloqueante anterior — resuelto en limpio

- **[`code/src/shared/domain/types/domain-event.ts:18-25`]** El JSDoc del shared documenta ahora el formato canónico `<module>.<event-name-in-past-tense-kebab-case>`, con tres ejemplos (`"workspace.initialized"`, `"memory.decision-recorded"`, `"curator.learnings-consolidated"`) que cubren los tres prefijos de bounded context más comunes del proyecto. La justificación queda explicitada: "the module prefix prevents collisions across the eight bounded contexts; the kebab-case past tense reads naturally in audit logs". El comentario es claro, machine-readable, y se mantiene el invariante de estabilidad de `eventName` como contrato público (líneas 23-25).
- **[`workspace-initialized.ts:24`, `workspace-mode-changed.ts:22`, `workspace-unlocked.ts:21`, `workspace-locked.ts:19`]** Los cuatro literales de `eventName` se conservan tal como estaban: `"workspace.initialized"`, `"workspace.mode-changed"`, `"workspace.unlocked"`, `"workspace.locked"`. Cumplen el contrato actualizado al pie de la letra: el prefijo `"workspace."` corresponde al bounded context, y el sufijo está en kebab-case past-tense (initialized/mode-changed/unlocked/locked). Ningún cambio fue necesario en este lado, lo que confirma que la decisión de adoptar la opción B fue la correcta para el dominio.
- **[Re-aprobación implícita de Tarea 1]** El cambio de JSDoc en `domain-event.ts` es contrato-compatible (el tipo `eventName: string` no cambia), no rompe ningún consumidor existente, y narra explícitamente el formato esperado para cualquier evento futuro del proyecto. La trazabilidad queda en el JSDoc mismo.

#### Advertencias del ciclo 0 — resueltas

- **[`invalid-mode-transition-error.ts:1`]** `import type { WorkspaceMode }` aplicado correctamente. El import se usa exclusivamente como anotación de tipo (líneas 46-47, 50-51); el `import type` es lo correcto y satisface `@typescript-eslint/consistent-type-imports`.
- **[`invalid-mode-transition-error.ts`]** El reexport de `JSON_RPC_CATALOG = JsonRpcErrorCodes` quedó eliminado (grep en archivo: 0 occurrencias). El JSDoc de la clase (líneas 37-41) explica explícitamente la decisión: "this error class deliberately does NOT re-export it: a domain error should not act as a secondary entry-point for the transport-level catalog". Decisión bien justificada y dejada por escrito para futuras consultas.
- **[`workspace-domain-error.ts:31-45` + las dos subclases]** API unificada a `jsonRpcCode: number | null` como **campo `readonly` abstracto en la base** + override con `readonly` field-initialiser en cada subclase (`WorkspaceLockedError:26` con `JsonRpcErrorCodes.ENCRYPTED_LOCKED`, `WorkspaceAlreadyInitializedError:27` con `null`, `InvalidModeTransitionError:45` con `null`). La asimetría método-vs-campo del ciclo 0 quedó eliminada. El JSDoc de la base documenta la regla canónica: `number` cuando hay código asignado en `docs/02-protocolo-mcp.md` §6 / `docs/11-seguridad-modos.md` §8, `null` cuando el dominio abstiene de asignar. Excelente para el adapter MCP que mapea uniforme con un único `instanceof + .jsonRpcCode`.
- **[`aggregates/workspace.ts:80-94`]** Copia defensiva del array `events` aplicada (`this.events = [...events]`). El JSDoc inline (líneas 89-93) explica la razón: "prevents external aliasing when a caller (test or factory) later mutates the array they passed in". Las dos factories (`initialize` líneas 112-118, `rehydrate` línea 138) siguen creando su propio array localmente, así que la copia es realmente defensiva, no necesaria. Decisión correcta para minimizar impacto del cambio.
- **[`aggregates/workspace.ts:158-160`]** Rename `assertNotAlreadyInitialized()` → `rejectReinitialization(): never` aplicado. La firma `: never` es importante: comunica al type-checker que el método siempre lanza, lo que permite control flow analysis correcto en los call-sites. El JSDoc (líneas 141-157) explicita la semántica nueva: "This is NOT a conditional assert — the name is deliberate". Resuelve la objeción del ciclo 0 sobre el patrón anti-intuitivo (un `assert*` que siempre lanza).
- **[`workspace-mode.ts:85-97`]** Las tres factories convenience renombradas a `sharedMode()`, `encryptedMode()`, `privateMode()` con sufijo `Mode` uniforme. El JSDoc (líneas 75-84) documenta la razón: "The suffix is required for `privateMode` because `private` is a reserved word in TypeScript class context, and we apply it to the other two to keep the surface consistent". Simétrico, predecible, sin disonancia.
- **[`workspace-mode.ts:12,22` y `embedder-spec.ts:23,25`]** `as const` arrays como única fuente de verdad para los union types. `WORKSPACE_MODE_KINDS = ["shared", "encrypted", "private"] as const` (línea 12) genera el tipo `WorkspaceModeKind = (typeof WORKSPACE_MODE_KINDS)[number]` (línea 22). Mismo patrón en `EMBEDDER_PROVIDERS` (líneas 23-25). El comentario en líneas 8-11 cita explícitamente la motivación ("avoids the previous duplication between a hand-written union literal and a separate validation array which could drift if a new variant was added to one but not the other"). Excelente práctica para evitar drift entre literal type y la lista de validación. Mirrors el patrón ya aprobado en `JsonRpcErrorCodes`.

#### Otros positivos confirmados (no regresionaron)

- **Cero imports externos al dominio.** `grep -rE "^import .* from" workspace/domain/ | grep -v "shared/domain" | grep -v "modules/workspace/domain"` → 0 resultados. Cumple §1.4 del lineamiento.
- **Cero setters públicos.** `grep -rE "set [a-zA-Z]+\("` en `workspace/domain/` → 0 resultados. Conforme R1.
- **Cero asignaciones `this.X = ...` fuera del constructor en VOs y eventos.** Verificado por grep: las únicas mutaciones de `this.X` viven en (a) constructores (aggregate, errores, eventos), (b) métodos de mutación legítimos del aggregate (`changeMode`, `unlock`, `lock`). Conforme R1+R2+R6.
- **Constructor `private` en TODOS los VOs y en el aggregate.** Verificado por grep `^(  )?(public )?constructor` en `aggregates/` y `value-objects/`: las únicas coincidencias son `private constructor` (líneas: `Workspace:80`, `DisplayName:34`, `EmbedderSpec:77`, `WorkspaceConfig:54`, `WorkspaceMode:46`, `WorkspacePath:38`). Conforme R1+R2.
- **Aggregate raíz único.** `Workspace` es la única clase en `aggregates/`. Conforme R3.
- **Eventos se emiten correctamente en cada mutación con éxito.** Verificado en aggregate: `initialize` → `WorkspaceInitialized`, `changeMode` → `WorkspaceModeChanged`, `unlock` → `WorkspaceUnlocked`, `lock` → `WorkspaceLocked`. Eventos contienen solo el hecho (workspace_id + payload mínimo + occurredAt). Conforme R6.
- **`pullEvents(): readonly DomainEvent[]` con drain del buffer.** Líneas 310-315: copia, vacía, freeze. Sin regresión por la copia defensiva del constructor (el `pullEvents` opera sobre `this.events`, que es ahora un array propio del aggregate, lo cual es exactamente el comportamiento esperado: callers que rehidratan no comparten state). Conforme R3.
- **`WorkspaceMode.kind`, `EmbedderSpec.{provider,model,dim}`, `WorkspacePath.value`, `DisplayName` (heredado), `WorkspaceConfig.*` siguen siendo `readonly` y validan invariantes en factories.** Sin regresión.
- **Repositorio trabaja con aggregate completo.** `WorkspaceRepository.findById/save` sin cambios. Conforme R4.
- **Lenguaje del dominio impecable.** `grep -rEi "(item|record|data|object|manager|helper)"` en `workspace/domain/` (excluyendo comentarios e imports) → solo coincidencias en JSDoc descriptivo y el `Object.freeze` necesario para `as const` arrays. Cero `Item`, `Manager`, `Helper`, `Util`, `Handler`, `Service` genérico, ni prefijo `I` en interfaces. Conforme R7.

## Veredicto justificado

El bloqueante único del ciclo 0 quedó resuelto en limpio: el JSDoc del shared en `code/src/shared/domain/types/domain-event.ts` documenta ahora el formato canónico `<module>.<event-name-in-past-tense-kebab-case>` con justificación técnica (prevención de colisiones cross-context, lectura natural en audit logs) y tres ejemplos concretos. Los cuatro eventos del workspace cumplen literalmente el formato sin haber requerido cambio. La decisión de adoptar la opción B (relajar el contrato del shared) en lugar de la opción A (renombrar los eventos a PascalCase) fue la correcta para el largo plazo del proyecto: el namespacing por bounded context es buena ingeniería para event buses futuros y respeta la consistencia que el implementador del módulo workspace ya había adoptado.

Las siete advertencias triviales del ciclo 0 fueron aplicadas tal como se pactaron, todas con JSDoc actualizado para que la decisión quede trazable en el código (no solo en el reporte de validación). En particular destaco:

- La unificación de `jsonRpcCode: number | null` como **campo `abstract readonly` en la base** con `readonly` field-initialiser en cada subclase es la solución correcta: simplifica el adapter MCP (un solo `instanceof + .jsonRpcCode` para mapear todo error de workspace), elimina la asimetría método-vs-campo entre `WorkspaceLockedError` e `InvalidModeTransitionError`, y deja en el dominio la decisión de qué errores tienen código asignado vs cuáles dejan al adapter elegir.
- El rename `assertNotAlreadyInitialized()` → `rejectReinitialization(): never` no solo resuelve la objeción semántica sino que aprovecha la firma `: never` para que el type-checker propague correctamente el control flow en los call-sites futuros de los use cases.
- Los `as const` arrays como única fuente de verdad para `WorkspaceModeKind` y `EmbedderProvider` siguen el patrón ya aprobado en `JsonRpcErrorCodes`. Es la mejor defensa contra drift entre literal type y array de validación.
- La copia defensiva de `events` en el constructor del aggregate, aunque las dos factories actuales no la necesitan (cada una crea su propio array), protege contra escenarios futuros (tests que rehidratan con un array compartido, hipotéticos otros factory) sin costo material.

No detecto issues nuevos introducidos por los cambios. La verificación cruzada de los tres ejes principales (cero imports externos al dominio, cero setters públicos, cero mutaciones fuera de métodos legítimos) sigue limpia. El lenguaje del dominio sigue impecable. El aggregate, los VOs, los eventos, el repositorio y el detector mantienen su forma DDD correcta.

Las advertencias no-bloqueantes pendientes para cierre de Fase 1 (inconsistencia documental sobre `encrypted -> shared`, `WorkspacePath` no expuesto en el aggregate, hardcode de `FASTEMBED_MODEL_DIMENSIONS`, case-sensitivity de `WorkspaceMode.create`) ya fueron levantadas en el ciclo 0 y NO son objeto de este ciclo. Ninguna afecta la corrección DDD del módulo.

## Próximo paso recomendado

APROBADO → la capa `workspace/domain/` está lista para que el implementador avance a `workspace/application/` (Fase 1 Tarea 3, si aplica) o a la siguiente tarea del backlog según planificación del orquestador.

Recordatorios para cierre de Fase 1 (no bloquean avance):

1. **Decisión de orquestador sobre `encrypted -> shared` directa:** o actualizar `docs/11-seguridad-modos.md` §5 para documentar la prohibición conservadora, o relajar el código de `ALLOWED_TRANSITIONS` para honrar la spec literalmente con flag de `requiresExplicitConfirmation`.
2. **Documentar en JSDoc de `Workspace`** por qué `WorkspacePath` no es parte del estado del aggregate (queda solo en `WorkspaceDetector` como input).
3. (Opcional, futuro) Considerar extraer `FASTEMBED_MODEL_DIMENSIONS` a un `EmbedderModelCatalog` propio si el catálogo crece.
4. (Opcional, futuro) Confirmar con orquestador la política case-sensitivity de `WorkspaceMode.create` vs el parser de `config.json`.
