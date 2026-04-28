# DDD Validation — Phase 1, Task 2: workspace/domain
**Validator:** ddd-validator
**Date:** 2026-04-27
**Verdict:** RECHAZADO (con bloqueante único: contrato `eventName`)

## Hallazgos

### CRÍTICOS (bloquean aprobación)

- **[code/src/modules/workspace/domain/events/workspace-initialized.ts:24]**
  **[code/src/modules/workspace/domain/events/workspace-mode-changed.ts:22]**
  **[code/src/modules/workspace/domain/events/workspace-unlocked.ts:21]**
  **[code/src/modules/workspace/domain/events/workspace-locked.ts:19]**
  Violación del contrato `DomainEvent.eventName`. La interface
  `shared/domain/types/domain-event.ts:18-20` declara explícitamente
  como invariante: `eventName` es "stable, machine-readable identifier
  in **PascalCase past tense** (e.g. `\"DecisionRecorded\"`)". Los
  cuatro eventos del módulo workspace usan kebab-case con namespace
  punto (`"workspace.initialized"`, `"workspace.mode-changed"`,
  `"workspace.unlocked"`, `"workspace.locked"`), incompatible con el
  contrato heredado. Hay dos caminos legítimos para resolverlo, y la
  decisión es de orquestador:

  1. **Conformar al contrato actual del shared:** renombrar literales a
     `"WorkspaceInitialized"`, `"WorkspaceModeChanged"`,
     `"WorkspaceUnlocked"`, `"WorkspaceLocked"`. Cero cambios en shared.
  2. **Relajar el contrato del shared para admitir namespacing:**
     editar `shared/domain/types/domain-event.ts:18-20` para documentar
     que el formato es `<context>.<past-tense-action>` en kebab-case
     con namespace por bounded context. Esta opción es mejor a largo
     plazo (permite filtrar por contexto en el bus, evita colisiones
     entre módulos) pero requiere actualizar el lineamiento R6 y
     re-aprobar Tarea 1. Si se elige esta vía, dejar trazabilidad en
     `docs/12-lineamientos-arquitectura.md` o en un ADR.

  Bloqueante porque hoy `DomainEvent.eventName` es la única fuente de
  verdad sobre el formato y los cuatro eventos del workspace lo violan.
  Propongo opción 2 (es la decisión documentada por el implementador,
  tiene sentido técnico, y el shared/domain ya pasó por DDD-validator
  con esa frase como invariante explícita — corregir es honrar la
  consistencia del proyecto).

### ADVERTENCIAS (no bloquean pero a corregir antes de cerrar fase)

- **[code/src/modules/workspace/domain/aggregates/workspace.ts:143-145]**
  `assertNotAlreadyInitialized()` siempre lanza `WorkspaceAlreadyInitializedError`,
  sin condición previa. La intención es que un adapter, tras
  `repo.findById(...)` que devolvió no-null, llame a este método sobre
  el aggregate ya rehidratado para abortar un flujo de re-init. Pero el
  contrato implícito ("solo llámame si querías init") es frágil:
  - El nombre `assert*` sugiere "verificar y lanzar si falla"; aquí
    siempre lanza, lo que es un patrón anti-intuitivo (es un
    `throwAlreadyInitialized()` disfrazado).
  - Lógicamente, este chequeo pertenece al use case
    `InitializeWorkspaceUseCase`, no al aggregate: el aggregate ya
    rehidratado no tiene forma de saber que el caller pretendía
    inicializar.
  Sugerencia: eliminar el método y dejar que el use case decida
  (`if (existing !== null) throw new WorkspaceAlreadyInitializedError(existing.getId())`),
  o renombrarlo a algo como `Workspace.refuseReinitialization(id)` como
  static helper que produzca el error. La clase `WorkspaceAlreadyInitializedError`
  se mantiene tal cual.

- **[code/src/modules/workspace/domain/errors/invalid-mode-transition-error.ts:1,80]**
  `JSON_RPC_CATALOG = JsonRpcErrorCodes` es exposición innecesaria del
  catálogo a través de la subclase de error. Cualquier consumidor puede
  importar `JsonRpcErrorCodes` directamente desde `shared/`. Reexportar
  como propiedad estática añade un segundo entry-point sin valor y
  acopla el error a la totalidad del catálogo (incluso a códigos no
  relacionados con workspace). Sugerencia: borrar la línea 80 y el
  comentario asociado (líneas 75-79). Si la intención es documentar
  "consideramos el catálogo y elegimos no asignar código", el JSDoc del
  método `defaultJsonRpcCode()` (líneas 56-67) ya lo explica.

- **[code/src/modules/workspace/domain/errors/invalid-mode-transition-error.ts:38-73]**
  Asimetría con `WorkspaceLockedError`. Este error expone
  `defaultJsonRpcCode(): number` (método), mientras que
  `WorkspaceLockedError:26` expone `jsonRpcCode: number = ...` (campo
  readonly). Ambos representan el mismo concepto ("código JSON-RPC
  canónico para esta falla"). El validador R6 no obliga el shape, pero
  la consistencia es relevante para el adapter que mapea errores en
  `mcp-server`. Sugerencia: alinear ambos usando un campo opcional
  `public readonly jsonRpcCode: number | null` en `WorkspaceDomainError`
  (con `null` significando "el dominio no asigna código y el adapter
  decide"). Eso unifica el contrato.

- **[code/src/modules/workspace/domain/aggregates/workspace.ts:80-90]**
  El constructor del aggregate recibe `events: DomainEvent[]` por
  parámetro (mutable) y lo guarda como `private readonly events`. El
  array es mutado por las mutaciones (`this.events.push(...)`) y por
  `pullEvents()` (`this.events.length = 0`). Funcionalmente es
  correcto, pero filtra al constructor un detalle de implementación que
  podría llevar a aliasing accidental si un caller (test) pasa el mismo
  array a dos workspaces. Sugerencia: el constructor no debe aceptar
  `events` desde fuera; las dos factories (`initialize`, `rehydrate`)
  ya construyen su propio array localmente (líneas 108-114 y 134), así
  que basta con eliminar el parámetro y crear el array dentro del
  constructor.

- **[code/src/modules/workspace/domain/value-objects/workspace-mode.ts:85-87]**
  Factory `WorkspaceMode.privateMode()` rompe el patrón de las otras
  dos (`shared()`, `encrypted()`). Es comprensible (`private` es
  reservado en TS), pero invita a inconsistencia. Sugerencia: o
  renombrar las tres a `*Mode()` (`sharedMode`, `encryptedMode`,
  `privateMode`) o usar `WorkspaceMode.of("private")`. La opción 1 es
  la más simétrica.

- **[code/src/modules/workspace/domain/value-objects/workspace-mode.ts:53-72]**
  Mensaje de error en `WorkspaceMode.create` (línea 67) es
  case-sensitive (`"shared" | "encrypted" | "private"`) pero la
  validación NO normaliza a lower-case (solo trim). Si el usuario
  escribe `"Shared"` en `config.json`, el error dice "must be one of
  'shared'..." pero el valor input ya está casi-correcto. El comentario
  en línea 51-52 confirma que es intencional ("case is significant").
  Es defendible (R7 — el wire format es lowercase canónico), pero
  conviene confirmar con orquestador si el parser de `config.json`
  hace lower-case antes de delegar al VO o si una entrada
  `"Shared"` se rechaza con `-32602`. Decisión menor.

- **[code/src/modules/workspace/domain/value-objects/embedder-spec.ts:35-41]**
  La tabla `FASTEMBED_MODEL_DIMENSIONS` está hardcoded en el VO. Es
  consistente con `docs/06-stack-tecnico.md` §8 al día de hoy, pero
  si en el futuro el catálogo crece (más modelos, otra dim), hay que
  tocar el VO. Sugerencia (no bloqueante): mover la tabla a un
  `EmbedderModelCatalog` (otro VO o una constante en `domain/`) si
  prevés que crezca. Por ahora 3 entradas, queda OK.

- **[code/src/modules/workspace/domain/value-objects/workspace-path.ts]**
  El VO está bien construido pero NO se usa dentro del propio
  aggregate `Workspace` ni en el `WorkspaceConfig` (solo lo consume
  `WorkspaceDetector` como input). Esto sugiere una de dos: (a) el
  workspace no necesita conocer su path porque el path lo gestiona el
  adapter (`FilesystemWorkspaceRepository`), o (b) falta exponer el
  path en `Workspace` / `WorkspaceConfig`. Revisar contra
  `docs/03-modelo-datos.md` §1: el `.mcp-memoria/` vive bajo el path
  del proyecto, pero el `workspace_id` es lo único que persiste en
  `config.json`. Decisión defendible que el path NO sea parte del
  estado del aggregate, pero conviene documentarlo explícitamente en
  el JSDoc de `Workspace` para que el siguiente lector no se pregunte
  por la ausencia.

- **[code/src/modules/workspace/domain/errors/workspace-domain-error.ts:21]**
  La clase es `abstract` (correcto) pero el `protected constructor`
  no aporta diferencia funcional sobre `private` o `public` para
  `abstract` (TS no permite instanciar abstract). Cosmético; OK.

- **[code/src/modules/workspace/domain/errors/invalid-mode-transition-error.ts:2]**
  Import de `WorkspaceMode` es como **value** pero solo se usa como
  **type** (líneas 40-41 y 44-45 son anotaciones de tipo;
  `from.toString()`/`to.toString()` opera sobre instancias recibidas
  por parámetro, no requiere la clase). El validador SOLID
  (`@typescript-eslint/consistent-type-imports`) lo marcará. Cambiar a
  `import type { WorkspaceMode } from ...`. Mismo análisis aplica a
  los imports de eventos en el aggregate: ya se usa `import type` en
  workspace.ts:1-3 y :11-12 (correcto), pero en :7-10 son `import`
  value (necesario porque se llama `new WorkspaceInitialized(...)`,
  etc.). OK ahí.

- **[Decisión `encrypted -> shared` PROHIBIDA]**
  Validada contra `docs/11-seguridad-modos.md` §5 y la tabla de
  transiciones. La doc lista la transición como **permitida con
  warning** ("Requiere unlock previo. Quita cifrado, deja DBs en
  plano. Warning: la historia de git tendrá entries cifrados antes y
  planos despues — diff sera grande"). El implementador la convirtió
  en **prohibida directa, exige paso por `private`**. Análisis:
  - **Pro de la decisión conservadora:** evita un commit sorpresa en
    el que de pronto los .db dejan de ser opacos y exponen historial.
    Forzar paso por `private` (que mueve a `.gitignore`) hace que el
    operador tenga un commit intermedio explícito antes de "abrir" el
    contenido al repo.
  - **Contra:** diverge del documento de spec que consideró el
    trade-off y aceptó la transición con warning. Implementar más
    estricto que el spec puede generar fricción operacional para
    equipos que sí quieren bajar el cifrado (caso legítimo: el
    repositorio se vuelve público y se decide que el contenido era
    no-sensible al final).
  - **Veredicto del auditor:** la decisión es defensible porque el
    spec misma usa "Warning" (señal de que el sistema debería
    encarecer la operación), pero NO es lo que dice la spec
    literalmente. Reportar al orquestador para que decida:
    - Si se mantiene la prohibición → actualizar
      `docs/11-seguridad-modos.md` §5 para documentarla y removerla
      de la matriz de transiciones admitidas.
    - Si se quiere honrar la spec literalmente → permitir la
      transición en `ALLOWED_TRANSITIONS.encrypted` con flag
      `requiresExplicitConfirmation: true` o equivalente, y dejar
      que el use case `ChangeMode` exija doble-confirm.
  Esto es una **inconsistencia documental, no una violación DDD**.
  No bloquea aprobación de la capa de dominio en sí, pero abre un
  riesgo de "el código y la doc dicen cosas distintas". La advertencia
  queda para Fase 1 cierre.

### POSITIVOS (qué quedó bien hecho)

- **Cero imports externos al dominio.** Los 16 archivos solo importan
  de `shared/domain/` (errores, VOs, types) o de
  `workspace/domain/` mismo. Cumple §1.4 sin excepciones.
  Verificación: `grep -rE "^import" workspace/domain/ | grep -v "shared/domain" | grep -v "workspace/domain"` → 0 resultados.
- **Cero setters públicos.** `grep -rE "set [a-zA-Z]+\("` en todo
  `workspace/domain/` → 0 resultados. Conforme R1.
- **Cero mutaciones fuera del constructor en VOs.** Las mutaciones de
  `this.X = ...` solo aparecen en el constructor del aggregate (líneas
  86-89) y en mutaciones legítimas del aggregate (líneas 179, 181,
  216, 242 — todas dentro de métodos de negocio: `changeMode`,
  `unlock`, `lock`). VOs y eventos solo asignan en el constructor.
- **Constructor `private` en TODOS los VOs y en el aggregate.**
  Verificado por grep. `DisplayName` lo declara en línea 34,
  `EmbedderSpec` en 74, `WorkspaceConfig` en 54, `WorkspaceMode` en
  45, `WorkspacePath` en 38, `Workspace` (aggregate) en 80. Conforme R1+R2.
- **Props `readonly` en TODOS los VOs y eventos.** Verificación de
  grep `private [a-zA-Z]+: ` sin `readonly` → 0; misma verificación
  para `public ` en eventos → 0. Conforme R2 y R6.
- **`equals()` en cada VO.** `WorkspaceMode:128`, `WorkspacePath:111`,
  `WorkspaceConfig:137`, `EmbedderSpec:118`. `DisplayName` lo hereda
  de `NonEmptyString` (línea 64 del shared) que ya tiene la guarda
  cross-subclass — buena práctica. Conforme R2.
- **Factories validan invariantes y lanzan `InvalidInputError`/`InvariantViolationError`.**
  `WorkspaceMode.create` (líneas 53-72): tipo, no-empty, set de valores
  legales. `WorkspacePath.create` (45-71): tipo, no-empty, no-NUL,
  abs-path, normalización trailing-sep. `DisplayName.create` (50-76):
  tipo, no-newline, trim+non-empty, max-length. `EmbedderSpec.create`
  (85-94): provider legal, model no-empty, dim coherente con tabla
  fastembed o requerido para voyage/openai. `WorkspaceConfig.create`
  (68-85): schema_version semver-shape. Conforme R2.
- **Aggregate raíz único.** `Workspace` es la única clase en
  `aggregates/`; entidades internas no se exponen (no hay ninguna —
  el aggregate es "thin" alrededor del config y la flag `unlocked`,
  lo cual es correcto: no hay sub-entidades con identidad propia
  dentro del workspace). Conforme R3.
- **Mutaciones con verbos de negocio.** `Workspace.changeMode(...)`
  (165), `unlock(...)` (203), `lock(...)` (229),
  `assertReadyForUse()` (260). Cero setters tipo `setMode`,
  `setUnlocked`. Conforme R1+R3.
- **Eventos emitidos en cada mutación con éxito.** `changeMode` emite
  `WorkspaceModeChanged` (líneas 183-190), `unlock` emite
  `WorkspaceUnlocked` (217-222), `lock` emite `WorkspaceLocked`
  (243-248), `initialize` emite `WorkspaceInitialized` (108-114).
  Eventos contienen solo el "hecho" (workspace_id, mode anterior/nuevo,
  occurredAt) — NO copia entera del aggregate. Conforme R6.
- **`pullEvents(): readonly DomainEvent[]` con drain del buffer.**
  Líneas 295-300: copia, vacía, freeze. Vacía solo si hay elementos
  (early return). Buen patrón para event-sourcing pull-based.
  Conforme R3.
- **Repositorio trabaja con aggregate completo.** `WorkspaceRepository`
  (líneas 33-47): `findById(WorkspaceId): Promise<Workspace | null>`
  + `save(Workspace): Promise<void>`. Sin partial-updates, sin
  `findByQuery(predicate)`, sin filas SQL. Operaciones `async`.
  `null` en lugar de error para "no existe" — decisión correcta
  (la ausencia es estado válido del flujo `mem.init`). Conforme R4.
- **`WorkspaceDetector` es interface (puerto).** Líneas 47-49:
  `export interface WorkspaceDetector { detect(rootPath: WorkspacePath): Promise<WorkspaceDetectionResult>; }`. Acompaña discriminated
  union `WorkspaceDetectionResult` (líneas 20-22). Conforme R5+ISP.
- **Errores tipados, extienden `WorkspaceDomainError` → `DomainError`.**
  Cuatro errores con `code` kebab-case estable
  (`workspace.invalid-mode-transition`, `workspace.locked`,
  `workspace.already-initialized`, abstract base). `WorkspaceLockedError`
  expone `jsonRpcCode = ENCRYPTED_LOCKED (-32107)` matching
  `docs/11-seguridad-modos.md` §8. Conforme R6+§5.
- **Lenguaje del dominio impecable.** Cero `Item`, `Manager`, `Helper`,
  `Util`, `Handler`, `Service` genérico. Cero prefijo `I` en
  interfaces (`WorkspaceRepository`, `WorkspaceDetector`,
  `DomainEvent` — los tres sin `I`). Nombres reflejan el negocio:
  `Workspace`, `WorkspaceMode`, `WorkspacePath`, `DisplayName`,
  `EmbedderSpec`, `WorkspaceConfig`, `WorkspaceLockedError`,
  `InvalidModeTransitionError`. Conforme R7.
- **Coherencia con `docs/03-modelo-datos.md` §2 (config.json).**
  Cobertura del slice canónico:
  - `schema_version` → `WorkspaceConfig.schemaVersion` (semver-validated)
  - `workspace_id` → `WorkspaceConfig.workspaceId: WorkspaceId`
  - `display_name` → `WorkspaceConfig.displayName: DisplayName`
  - `mode` → `WorkspaceConfig.mode: WorkspaceMode`
  - `created_at_ms` → `WorkspaceConfig.createdAt: Timestamp`
  - `embedder.{provider,model,dimension}` → `WorkspaceConfig.embedder: EmbedderSpec`
  Ausencias justificadas explícitamente en JSDoc del VO (líneas 31-39):
  `metadata` (free-form, application layer), `secrets`/`retrieval`/`curator`
  (otros bounded contexts, cross-module imports prohibidos), `kdf`/`kdf_params`/
  `key_validator_blob_b64`/`key_envelopes` (módulo `encryption`). Decisión
  alineada con §1.5 (modularidad estricta).
- **Coherencia con `docs/06-stack-tecnico.md` §8 (catálogo fastembed).**
  Tabla `FASTEMBED_MODEL_DIMENSIONS`: `BGESmallEN15: 384`,
  `MultilingualE5Base: 768`, `BGELargeEN: 1024` — match exacto con
  la doc. Decisión correcta de inferir dim para fastembed canónico y
  exigirla para voyage/openai (cuyo catálogo es abierto).
- **`unlocked` es runtime, NO se persiste.** Documentado en
  `WorkspaceRepository:24-27` y en `Workspace.rehydrate(config):134`
  (siempre arranca con `unlocked=false`). Coherente con
  `docs/11-seguridad-modos.md` §3 ("clave persiste en
  `~/.config/.../keys/`, no en el workspace"). Conforme con la
  decisión declarada del implementador.
- **Precondición "estar unlocked antes de mode-change" delegada al
  use case.** Documentado en `Workspace.changeMode:158-164`. Es la
  decisión correcta: el aggregate no tiene acceso a la cache de
  claves (`~/.config/.../keys/`) ni al prompt CLI; verificarlo allí
  rompería el aislamiento DIP.
- **`WorkspaceConfig.with*(...)` retorna nueva instancia.** `withMode`
  (92-102), `withEmbedder` (110-120), `withDisplayName` (125-135).
  Cada uno con short-circuit por igualdad. VO permanece inmutable.
  Conforme R2.
- **Discriminated union `WorkspaceDetectionResult`.** Líneas 20-22 de
  `workspace-detector.ts`. Cuando `exists: false`, `configPath: null`
  forzado por tipo — el caller no puede dereferenciar accidentalmente.
  Conforme §1.6 (type-safety total).
- **Comentarios cross-doc.** Cada archivo cita la sección de docs
  relevante (`docs/01-arquitectura.md` §4, `docs/03-modelo-datos.md`
  §2, `docs/11-seguridad-modos.md` §3/§5/§8, `docs/06-stack-tecnico.md`
  §8). Excelente para auditabilidad.

## Veredicto justificado

La entrega aplica DDD con rigor: aggregate único con identidad
inmutable, VOs inmutables que validan invariantes, eventos en past-tense
que solo cargan el hecho, repositorio que trabaja con aggregate
completo, servicios de dominio como interfaces (puertos),
errores tipados con código JSON-RPC documentado. Cero imports
externos, cero setters, cero lenguaje genérico. La cobertura del slice
de `config.json` es exactamente la que corresponde al bounded context
workspace (excluyendo correctamente `metadata`, `secrets`, `retrieval`,
`curator`, `kdf*` que viven en otros módulos).

El **único bloqueante** es la incompatibilidad entre el formato
declarado del `eventName` en `shared/domain/types/domain-event.ts:18-20`
("PascalCase past tense") y el formato adoptado en los cuatro eventos
del workspace (`"workspace.*"` kebab-case con namespace). Es una
violación literal del invariante R6, no resoluble en este módulo solo:
o se conforman los eventos al contrato vigente, o se relaja el
contrato del shared (con re-aprobación de Tarea 1 y actualización del
lineamiento). Mi recomendación es la opción 2 — el namespacing por
contexto es buena ingeniería para event buses futuros — pero la
decisión es de orquestador.

Las advertencias listadas son mejoras de consistencia (asimetría
entre `defaultJsonRpcCode()` y `jsonRpcCode`, factory `privateMode`
disonante, `JSON_RPC_CATALOG` reexportado innecesariamente,
`assertNotAlreadyInitialized` semánticamente raro, `events` como
parámetro mutable del constructor) y un punto documental importante
(la prohibición `encrypted -> shared` diverge del spec). Ninguna
bloquea aprobación una vez resuelto el bloqueante.

La decisión `encrypted -> shared` PROHIBIDA es **defensible pero
diverge de la spec literal**: el orquestador debe decidir si actualizar
la spec o relajar la regla en código. Reportada como advertencia
porque no es violación DDD per se (es coherencia documental).

## Próximo paso recomendado

RECHAZADO → resolver el bloqueante de `eventName` antes de continuar
con la implementación de application + infrastructure del módulo
workspace.

Acción inmediata sugerida (vía orquestador):
1. **Decidir formato canónico de `eventName`:** PascalCase past-tense
   (opción A, conforme al shared actual) vs `<context>.<kebab-action>`
   (opción B, consistente con la decisión del implementador y mejor
   para namespacing futuro).
2. Si **opción A**: corregir los 4 literales en
   `workspace-initialized.ts:24`, `workspace-mode-changed.ts:22`,
   `workspace-unlocked.ts:21`, `workspace-locked.ts:19`. Cero cambios
   en shared.
3. Si **opción B**: editar `shared/domain/types/domain-event.ts:18-20`
   para documentar el formato `<context>.<kebab-action>`,
   actualizar el ejemplo y la regla R6 en
   `docs/12-lineamientos-arquitectura.md` (mencionar namespacing por
   bounded context), re-validar Tarea 1 con el cambio.
4. Re-someter a `ddd-validator` para Fase 1 Tarea 2.

Recomendaciones para incorporar antes de cerrar Fase 1 (no bloquean
avance una vez resuelto el bloqueante, pero sí cierre):
1. Eliminar o renombrar `Workspace.assertNotAlreadyInitialized()`.
2. Unificar API de mapping JSON-RPC en errores del módulo
   (`jsonRpcCode` field-readonly vs `defaultJsonRpcCode()` method).
3. Eliminar `InvalidModeTransitionError.JSON_RPC_CATALOG`.
4. Quitar `events: DomainEvent[]` del constructor del aggregate
   (crearlo internamente).
5. Renombrar `WorkspaceMode.privateMode()` → simétrico con
   `sharedMode()` y `encryptedMode()`, o pasar a `of("private")`.
6. Cambiar `import { WorkspaceMode }` → `import type { WorkspaceMode }`
   en `invalid-mode-transition-error.ts:2`.
7. **Decisión de orquestador sobre `encrypted -> shared`:** o
   actualizar `docs/11-seguridad-modos.md` §5 para reflejar la
   prohibición conservadora, o relajar el código para honrar la spec
   literalmente con warning explícito.
8. Documentar en JSDoc de `Workspace` por qué `WorkspacePath` no es
   parte del estado del aggregate (queda solo en `WorkspaceDetector`
   como input).
