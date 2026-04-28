# DDD Validation — Phase 1, Task 1: shared/domain
**Validator:** ddd-validator
**Date:** 2026-04-27
**Verdict:** APROBADO

## Hallazgos

### CRÍTICOS (bloquean aprobación)
Ninguno.

### ADVERTENCIAS (no bloquean pero a corregir antes de cerrar fase)

- **[code/src/shared/domain/value-objects/workspace-id.ts:29]** Inconsistencia de nombrado de factory. El resto de VOs expone factories con verbos uniformes (`Tags.create`, `Confidence.of`, `Tokens.of`, `Timestamp.fromEpochMs`, `NonEmptyString.create`, `Id.create`). `WorkspaceId.from` rompe la convención. Sugerencia: renombrar a `WorkspaceId.create(raw)` para alinear con el patrón base de `Id.create`. Si se conserva `from`, documentar la convención `from*` para subclases de `Id` y aplicarla al resto de IDs futuros (DecisionId, LearningId, etc.) por consistencia.

- **[code/src/shared/domain/value-objects/id.ts:43-49]** `Id.create<TBrand>()` permite que cualquier caller pase un brand arbitrario en el call site (`Id.create<"foo">(...)`) y obtenga un `Id<"foo">`. Esto erosiona la garantía de que solo las subclases (WorkspaceId, etc.) puedan emitir ids con un brand específico. Sugerencia: marcar `Id.create` como deprecated/internal o eliminarlo a favor de obligar a usar siempre la subclase concreta (`WorkspaceId.create`, `DecisionId.create`...). Hoy no es bloqueante porque el desarrollo del dominio rico (Fase 1 §) aún no consume `Id` directamente, pero conviene cerrarlo antes de que aparezcan llamadas accidentales.

- **[code/src/shared/domain/value-objects/id.ts:95-98] vs [code/src/shared/domain/value-objects/non-empty-string.ts:64-68]** Asimetría en `equals()`: `NonEmptyString.equals` rechaza comparaciones cross-subclass (`other.constructor !== this.constructor`), pero `Id.equals` no. En runtime un `WorkspaceId` y un `DecisionId` con el mismo string devolverían `true` si alguien fuerza el cast. La protección hoy depende exclusivamente del brand a nivel tipo. Sugerencia: replicar el guard `other.constructor !== this.constructor` en `Id.equals` (defensa en profundidad). No bloqueante porque el branded type cubre el caso esperado en código bien tipado.

- **[code/src/shared/domain/value-objects/tags.ts:111-118]** `Tags.equals` es order-sensitive (documentado en líneas 22-25). Es una decisión de diseño consciente para preservar el orden de presentación, pero diverge de la intuición común de "Tags como conjunto". Confirmar con el orquestador si esta es la semántica deseada cuando, por ejemplo, dos turns con `["bug", "fix"]` y `["fix", "bug"]` se consideran distintos a efectos de invariantes (afecta consolidación del curator y dedup). Si la respuesta es "se consideran iguales", `equals` debe ordenar antes de comparar.

- **[code/src/shared/domain/value-objects/id.ts:76-80]** GRIS — Regex UUID v7. Pros: estricto sobre version nibble (`7`) y variant nibble (`[89ab]`), ambos requisitos de RFC 9562. Cons: no valida monotonía temporal (que es propia de v7) ni rechaza el "nil UUID" (`00000000-0000-7000-8000-000000000000`). Para validación estructural es suficiente; para validación de generación correcta, depende del adapter `UuidV7Generator` (shared/infra). Decisión recomendada: dejar como está, pero añadir test que documente que el "nil-pattern v7" pasa la validación intencionalmente para no acoplar el VO al generador.

- **[code/src/shared/domain/value-objects/timestamp.ts:117-119]** `Timestamp.toDate()` devuelve un `Date` mutable. Aunque `Timestamp` mantiene su invariante (el `epochMs` interno es readonly), un caller podría mutar el `Date` retornado. No es un fallo de DDD (el VO sigue siendo inmutable), pero conviene documentar que el `Date` retornado es una copia desechable. Alternativa: usar `Object.freeze` sobre el Date no funciona como esperado en JS; mejor mantener la convención y documentar.

- **[code/src/shared/domain/errors/invalid-input-error.ts:21] y [code/src/shared/domain/errors/invariant-violation-error.ts:27]** Constructores `public`. La regla R2 estricta exige `private constructor + factory`, pero esa regla aplica a Value Objects, no a clases de error. Los errores se construyen idiomáticamente vía `throw new InvalidInputError(...)`. Es correcto. Solo se anota para que el reporte deje constancia y no se interprete como omisión.

- **[code/src/shared/domain/value-objects/non-empty-string.ts:25]** `NonEmptyString` no tiene aún subclases concretas (DecisionTitle, EntityName, LearningContent, etc.), pero está pensada como base. Confirmar en el siguiente módulo (workspace-domain) que las subclases sigan el patrón documentado: factory propio con `super.normalize` (línea 45) y constructor `protected`. Si una subclase usa `NonEmptyString.create` directamente sin nombre de dominio, sería bandera roja R7.

- **Cobertura de VOs vs `docs/03-modelo-datos.md`** — los VOs comunes (`id`, `timestamp_ms`, `tags`, `confidence`, `tokens`, `workspace_id`) están cubiertos. Faltantes intencionales (correcto que NO estén en `shared`):
  - `severity` (tip|warning|critical) → `modules/memory`
  - `scope` (project|module) → `modules/memory`
  - `status`/`priority` para tasks → `modules/curator` o `modules/memory`
  - `entity_kind`, `relation` → `modules/memory`
  - `WorkspaceMode` (shared|encrypted|private) → `modules/workspace`
  Estos NO deben vivir en `shared` porque solo los consume un módulo. Validar esto en las próximas tareas.

### POSITIVOS (qué quedó bien hecho)

- **Cero imports externos.** Todos los imports en `shared/domain/` son intra-domain (errores ↔ VOs ↔ types). Cumple §1.4 (Cero imports externos en domain) sin excepciones.
- **Constructors privados/protegidos en TODOS los VOs.** `Id` y `NonEmptyString` usan `protected` deliberadamente porque son base para subclases con brand/identidad propia; `Timestamp`, `Tokens`, `Tags`, `Confidence` usan `private`. Conforme R2.
- **Cero setters.** Búsqueda `set X(` en todo el árbol no devuelve nada. Conforme R1.
- **Cero mutación fuera de constructor.** `this.X =` solo aparece dentro de constructores de errores (asignación inicial). Conforme R1.
- **`equals()` en todos los VOs.** `WorkspaceId` lo hereda correctamente de `Id`. Conforme R2.
- **Props readonly en TODOS los VOs.** Verificado vía grep (`private [a-zA-Z]+: ` sin `readonly` → 0 hits). Conforme R2.
- **Validación de invariantes en cada factory.** Cada VO valida exhaustivamente y lanza `InvalidInputError` o `InvariantViolationError` (subclases de `DomainError`). El error es tipado, con código estable (`invalid-input`, `invariant-violation`) y opcionalmente `field` o `invariant`. Conforme R2 y R5.
- **`DomainEvent` interface.** `readonly occurredAt: Timestamp`, `readonly eventName: string`, documentación explícita de past-tense (`DecisionRecorded`, `WorkspaceUnlocked`). Conforme R6.
- **`Result<T, E>` discriminated union.** Variantes `Ok<T>`/`Err<E>` con `kind: "ok"|"err"` readonly + type guards `isOk`/`isErr`. Cumple §1.6 ("Resultado de operaciones que pueden fallar: `Result<T, E>`").
- **Lenguaje del dominio.** Cero términos genéricos (`Item`, `Manager`, `Helper`, `Util`, `Service` genérico, `Handler` genérico, prefijo `I`). Nombres reflejan ubiquitous language: `Confidence`, `Tokens`, `Tags`, `Timestamp`, `WorkspaceId`. Conforme R7.
- **Branded types correctamente implementados.** `Brand<TValue, TBrand>` con `__brand` phantom-only, sin runtime cost. Permite que `WorkspaceId` y `DecisionId` futuros sean nominalmente distintos pese a compartir representación `string`. Excelente para prevenir bugs por confusión de IDs.
- **`Tokens.subtract` lanza `InvariantViolationError`** en vez de clamp silencioso. Decisión correcta: una resta inválida es un bug de la app, no un dato inválido.
- **`Confidence.decay` usa multiplicación** (cerrada sobre [0,1]) y valida `factor in [0,1]`. La invariante se mantiene por construcción matemática, no por post-clamp. Diseño DDD ejemplar.
- **`Timestamp.now(clockMs)` requiere clockMs externo.** Consistente con §1.4 (DIP) y la regla "el dominio nunca lee la wall clock".
- **`JsonRpcErrorCodes` vive en domain.** Correcto: el catálogo de errores es concepto del negocio (qué cosas pueden fallar), aunque los códigos numéricos sean infra-flavoured. Documentación clara del rango reservado MCP-Memoria (-32100..-32109).
- **`DomainError` documenta separación entre `InvalidInputError` (input externo) e `InvariantViolationError` (mutación que rompería el modelo).** Esta distinción semántica es clave para que la capa application/infra mapee errores a códigos JSON-RPC correctos.
- **JSDoc con sección "Invariants:" en cada VO.** Hace explícito el contrato. Modelo a seguir en los próximos módulos.

## Veredicto justificado

La entrega cumple el 100% de las reglas R1-R7 del lineamiento §1.2 sin
violaciones bloqueantes. Las advertencias listadas son mejoras de
consistencia (naming `from` vs `create`, defensa en profundidad en
`Id.equals`, semántica de `Tags.equals`) o aclaraciones de diseño que no
contravienen ninguna regla DDD. La arquitectura interna refleja el
ubiquitous language del dominio MCP-Memoria, las invariantes están
codificadas en los factories, los errores son tipados con códigos
estables, los eventos siguen el contrato past-tense, y el dominio no
importa absolutamente nada externo (ni siquiera node built-ins).

La cobertura de VOs comunes coincide con los conceptos transversales
documentados en `docs/03-modelo-datos.md` §2 y §4 (`id`, `timestamp_ms`,
`tags`, `confidence`, `tokens`, `workspace_id`). Los VOs específicos
por módulo (severity, scope, status, priority, entity_kind, mode) están
correctamente excluidos de `shared/` y se validarán en sus respectivos
módulos.

## Próximo paso recomendado

APROBADO → siguiente tarea: workspace-domain.

Recomendaciones para incorporar antes de cerrar Fase 1 (no bloquean
avance, pero sí cierre):
1. Renombrar `WorkspaceId.from` → `WorkspaceId.create` para
   consistencia, y aplicar el mismo patrón en futuros IDs.
2. Añadir guard `other.constructor !== this.constructor` en `Id.equals`
   como defensa en profundidad.
3. Decidir con el orquestador si `Tags.equals` debe ser order-sensitive
   (semántica actual) u order-insensitive (semántica de "set").
4. Considerar marcar `Id.create<TBrand>()` como protected/internal o
   eliminarlo, forzando el uso de subclases tipadas.
