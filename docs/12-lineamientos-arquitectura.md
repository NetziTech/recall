# 12 — Lineamientos de arquitectura (NO NEGOCIABLES)

> Reglas absolutas que TODO el codigo de este proyecto debe cumplir. Ningun
> agente, ninguna excepcion, ningun "por ahora pasalo y despues lo
> arreglamos". Si una linea de codigo viola alguna de estas reglas, el
> validador correspondiente la rechaza y vuelve al implementador.

---

## 1. Los 6 lineamientos

### 1.1 Clean Architecture

Las dependencias apuntan **siempre hacia el dominio**. El dominio no conoce
nada del exterior.

```
Presentation → Application → Domain ← Infrastructure
```

**Capas internas de cada modulo:**
- `domain/` — entidades, value objects, agregados, eventos, **interfaces de
  repositorios**, servicios de dominio. **Sin imports externos.**
- `application/` — casos de uso, puertos de entrada (input ports), DTOs.
  Puede importar de `domain/` (mismo modulo) y de `shared/`. Nada mas.
- `infrastructure/` — adaptadores: implementaciones concretas de
  repositorios, drivers de DB, clientes HTTP, etc. Puede importar de
  `domain/`, `application/` (mismo modulo) y `shared/`. Nada mas.

**Direcciones permitidas:**
```
infrastructure → application → domain
                 application → domain
                              ↑
                              shared (transversal)
```

**Direcciones PROHIBIDAS:**
- `domain` → cualquier cosa que no sea `domain/` mismo modulo o tipos basicos de TS
- `application` → `infrastructure`
- Cualquier modulo → cualquier otro modulo (excepto `shared`)

### 1.2 Domain-Driven Design (DDD)

El codigo habla el idioma del negocio (Ubiquitous Language).

| Concepto | Que es | Donde vive |
|---|---|---|
| **Entidad** | Identidad + comportamiento. Igualdad por id | `domain/entities/` |
| **Value Object** | Inmutable, igualdad por valor (no por id) | `domain/value-objects/` |
| **Agregado** | Cluster de entidades con una raiz. La raiz controla invariantes y es el unico punto de acceso desde fuera | `domain/aggregates/` |
| **Repositorio (interface)** | Contrato de persistencia, en dominio | `domain/repositories/` |
| **Repositorio (impl)** | Adaptador concreto, en infrastructure | `infrastructure/persistence/` |
| **Servicio de dominio** | Logica que cruza varios agregados | `domain/services/` |
| **Evento de dominio** | Algo significativo paso (`DecisionRecorded`, `WorkspaceUnlocked`) | `domain/events/` |
| **Caso de uso** | Una operacion del sistema (`RememberDecisionUseCase`) | `application/use-cases/` |
| **Puerto** | Interface en application que abstrae infraestructura | `application/ports/` |
| **DTO** | Estructura plana para cruzar la frontera de application | `application/dtos/` |

**Reglas DDD:**
- Entidades **no** tienen setters libres. Mutaciones via metodos con
  significado de negocio: `decision.markSuperseded(by)` no `decision.superseded_by = ...`.
- Value objects **siempre** validan invariantes en el constructor.
- Agregados **garantizan invariantes** internos al ejecutar mutaciones.
- Repositorios trabajan con **agregados completos**, no con filas SQL.
- El **lenguaje** del dominio es el del negocio: `WorkspaceConfig`,
  `MemoryEntry`, `EncryptionEnvelope`. NO `Row`, `Record`, `Item` genericos.

### 1.3 Hexagonal Architecture (Ports & Adapters)

El dominio define **puertos** (interfaces). La infraestructura implementa
**adaptadores** (clases concretas).

**Ejemplo:**

```typescript
// modules/memory/domain/repositories/decision-repository.ts
export interface DecisionRepository {
  findById(id: DecisionId): Promise<Decision | null>;
  save(decision: Decision): Promise<void>;
  findActive(): Promise<readonly Decision[]>;
}

// modules/memory/infrastructure/persistence/sqlite-decision-repository.ts
export class SqliteDecisionRepository implements DecisionRepository {
  constructor(private readonly db: Database) {}
  // ...
}
```

**El negocio nunca sabe como se persiste ni como se expone.**

Tipos de puertos:
- **Driving (input) ports**: lo que el mundo exterior puede pedirle al
  dominio. Vive en `application/ports/in/`. Ejemplo: `RememberDecisionPort`.
  Implementado por use cases.
- **Driven (output) ports**: lo que el dominio pide al exterior. Vive en
  `domain/repositories/` o `application/ports/out/`. Ejemplo:
  `DecisionRepository`, `Embedder`, `Clock`. Implementado por adaptadores.

### 1.4 Principios SOLID

| Principio | Regla operativa |
|---|---|
| **SRP** (Single Responsibility) | Una clase = una razon para cambiar. Si el cambio "agregar un campo" obliga a tocar 5 metodos no relacionados, refactor |
| **OCP** (Open/Closed) | Extension por interfaces, no por modificacion. Nuevos kinds de memoria → nuevos VO/handlers, no `if (kind === "X")` en clase central |
| **LSP** (Liskov Substitution) | Subtipos sustituibles. Si `SqliteDecisionRepository extends DecisionRepository`, debe poder reemplazarlo sin romper nada que use la interface |
| **ISP** (Interface Segregation) | Interfaces pequenas y especificas. NO `IRepository<T>` con 50 metodos; SI `Reader<T>` + `Writer<T>` separados si tiene sentido |
| **DIP** (Dependency Inversion) | Depender de abstracciones. Use cases inyectan puertos, NO instancian adaptadores |

### 1.5 Modularidad estricta

**Regla 1:** Cada modulo es independiente.

```
src/modules/workspace/
src/modules/memory/
src/modules/retrieval/
src/modules/curator/
src/modules/secrets/
src/modules/encryption/
src/modules/mcp-server/
src/modules/cli/
```

**Regla 2:** Modulos NUNCA importan de otros modulos. Solo de `shared/`.

```typescript
// ✓ PERMITIDO en src/modules/memory/application/use-cases/remember.ts
import { Logger } from "../../../../shared/application/ports/logger.ts";
import { Decision } from "../../domain/aggregates/decision.ts";

// ✗ PROHIBIDO
import { Workspace } from "../../../workspace/domain/aggregates/workspace.ts";
```

**Regla 3:** Si dos o mas modulos necesitan una funcionalidad, esa
funcionalidad **se mueve a `shared/`** inmediatamente. No se duplica.

**Regla 4:** El composition root (`src/composition/`) es el **unico lugar**
donde se "junta" todo. Ahi se instancian adaptadores y se inyectan en use
cases. Es la unica zona del codigo que importa de multiples modulos.

```typescript
// ✓ PERMITIDO solo en src/composition/server.ts
import { RememberDecisionUseCase } from "../modules/memory/application/use-cases/...";
import { SqliteDecisionRepository } from "../modules/memory/infrastructure/persistence/...";
import { McpServer } from "../modules/mcp-server/...";
```

**Modulo transversal `shared/`:**
- `shared/domain/value-objects/` — VO comunes: `Id`, `Timestamp`, `Tags`,
  `WorkspaceId`, `Tokens`
- `shared/domain/errors/` — clases base de error + codigos JSON-RPC
- `shared/domain/types/` — tipos comunes que cruzan modulos
- `shared/application/ports/` — puertos comunes: `Database`, `Logger`,
  `Embedder`, `KDF`, `Clock`, `IdGenerator`
- `shared/infrastructure/` — adaptadores comunes: `SqliteDatabase`,
  `PinoLogger`, `FastembedAdapter`, `Argon2idKDF`, `SystemClock`,
  `Uuidv7Generator`

**Validacion automatica:** un script (`scripts/validate-modules.ts`) corre
en CI y rechaza commits con cross-imports indebidos.

#### 1.5.1 ADR-001 — Cross-imports `retrieval`/`curator` → `memory`

**Status:** ACCEPTED — provisional, pendiente ratificacion por
`clean-architecture-validator` en Fase 3 (cuando exista la triada
`domain` + `application` + `infrastructure` por modulo y el validador
pueda inspeccionar todas las direcciones de import).

**Fecha:** 2026-04-27.

**Contexto.** Durante la Fase 1 (Domain Modeling) las tareas 8
(`retrieval/domain`) y 9 (`curator/domain`) requirieron, por diseño del
producto, importar tipos definidos en `memory/domain`:

- **`retrieval/domain` necesita projections read-only de las entradas
  almacenadas en `memory`**. La capa de retrieval ensambla un
  `ContextBundle` (las 7 capas de contexto descritas en `docs/04`) y
  cada capa cita memorias por referencia. Los `*Ref` (`DecisionRef`,
  `EntityRef`, `TaskRef`, `TurnRef`, `OpenQuestionRef`,
  `WorkspaceAnchorPayload`) son projections finas: agrupan los pocos
  campos de un agregado de `memory` que el bundle muestra, junto con
  ids fuertes (`DecisionId`, `EntityId`, `TaskId`, `TurnId`,
  `SessionId`) y VOs descriptivos (`EntityKind`, `EntityName`,
  `EntityDescription`, `Scope`, `DecisionTitle`, `TaskTitle`,
  `TaskStatus`, `TaskPriority`, `TurnSummary`, `SessionIntent`,
  `OpenQuestion`, `EmbeddingStatus`, `LastUsed`, `UseCount`). No se
  importa ningun aggregate completo desde `retrieval`.

- **`curator/domain` necesita aggregates completos de `memory` para
  operar sobre su lifecycle**. El curador es un servicio de mantenimiento
  cuyo dominio es exactamente la evolucion temporal de las entradas:
  decay (todos los kinds), consolidacion (solo `Learning`), prune
  (todos los kinds tras decay severo). Por diseño, sus servicios de
  dominio piensan en terminos de aggregates de `memory`:
  `consolidation-detector.ts` razona sobre `Learning` completos y
  `decay-calculator.ts` / `decay-factor.ts` consumen `LearningSeverity`
  y `MemoryEntryKind` para elegir el factor por kind/severity.

**Decision.** Se autoriza explicita y acotadamente:

| Direccion | Permitido | Restriccion |
|---|---|---|
| `retrieval/domain` → `memory/domain` | SI | Solo projections `*Ref` y VOs descriptivos de identidad (read-only). PROHIBIDO importar aggregates completos. |
| `curator/domain` → `memory/domain` | SI | Aggregates completos (`Learning`) y VOs (`LearningSeverity`) cuando sean estrictamente necesarios para operaciones de lifecycle (decay, consolidacion). |
| Cualquier otro cross-import entre modulos | NO | Sigue prohibido sin excepcion. La regla 2 de §1.5 se mantiene intacta para el resto del sistema. |
| `memory/domain` → `retrieval/domain` o `memory/domain` → `curator/domain` (direccion inversa) | NO | El core context (`memory`) no conoce a sus consumidores derivados. |

**Cross-imports REALES detectados al cierre de Fase 1** (snapshot
inicial de la superficie autorizada):

`retrieval/domain` (11 archivos):
- `value-objects/decision-ref.ts` → `DecisionId`, `DecisionTitle`, `Scope`
- `value-objects/entity-ref.ts` → `EntityId`, `EntityKind`, `EntityName`, `EntityDescription`
- `value-objects/task-ref.ts` → `TaskId`, `TaskTitle`, `TaskStatus`, `TaskPriority`
- `value-objects/turn-ref.ts` → `TurnId`, `TurnSummary`
- `value-objects/open-question-ref.ts` → `OpenQuestion`, `SessionId`
- `value-objects/workspace-anchor-payload.ts` → `SessionId`, `SessionIntent`
- `value-objects/embedding-status.ts` → re-exports de `EmbeddingStatus`
- `value-objects/recency-score.ts` → `LastUsed`
- `value-objects/usage-score.ts` → `UseCount`
- `aggregates/context-bundle.ts` → `SessionId` (type-only)
- `events/context-bundle-assembled.ts` → `SessionId` (type-only)

`curator/domain` (3 archivos):
- `value-objects/decay-factor.ts` → `LearningSeverity`
- `services/decay-calculator.ts` → `LearningSeverity` (type-only)
- `services/consolidation-detector.ts` → `Learning` (aggregate completo)

**Alternativas rechazadas:**

| # | Alternativa | Razon de rechazo |
|---|---|---|
| (b) | Mover los `*Ref` y los VOs/aggregates compartidos a `shared/` | Los `*Ref` de retrieval son projections **del schema de `memory`** (que es el bounded context dueño de las entradas); moverlos a `shared/` los desconectaria de su dueño semantico, diluiria el contexto `memory` y degradaria la cohesion DDD. `shared/` es para tipos transversales sin dueño claro (`Id`, `Timestamp`, `Tags`, `Logger`, `Database`), no para tipos del nucleo de un dominio especifico. |
| (c) | Duplicar las definiciones localmente en `retrieval` y `curator` | Introduce drift inevitable entre las copias cuando `memory` evolucione (campos nuevos, validaciones nuevas, invariantes refinadas). Viola DRY, rompe trazabilidad y obliga a mantener tres parsers Zod en lugar de uno. |

**Consecuencias:**

- En Fase 3, `clean-architecture-validator` debe **ratificar
  explicitamente** esta excepcion al revisar la triada
  `domain` + `application` + `infrastructure` de cada modulo. Si la
  ratifica, el ADR pasa de `ACCEPTED — provisional` a `ACCEPTED — ratified`
  y se actualiza la fecha; si la rechaza, abre un nuevo ADR con la
  alternativa elegida y migra el codigo.
- Patron DDD aplicado: relacion **Customer-Supplier upstream-downstream**.
  El core context `memory` es **upstream** (publica un contrato de
  aggregates/VOs que no se rompe sin coordinacion); los contextos
  derivados `retrieval` y `curator` son **downstream** (dependen del
  contrato upstream). El composition root sigue siendo el unico que
  cruza ambos modulos en sentido vertical (instanciacion).
- El script `scripts/validate-modules.ts` (Fase 2.1) debe codificar esta
  excepcion: permitir imports `retrieval/**` → `memory/domain/**` y
  `curator/**` → `memory/domain/**`, y rechazar el resto de cross-imports
  sin excepcion.
- En Fase 5, agregar a la suite de tests un **snapshot test de
  superficies de import**: ejecuta `grep -rn "from '\.\./\.\./memory/'"`
  sobre `retrieval/` y `curator/`, compara contra la lista autorizada
  de este ADR, y falla si aparece una nueva importacion no listada.
  Cuando se autorice una nueva importacion, se actualiza la lista en el
  ADR (en el mismo PR que la introduce) y se regenera el snapshot.
- Si en algun momento un tercer modulo necesita importar de `memory` (o
  un cuarto cross-import surge entre modulos no listados aqui), NO se
  amplia este ADR: se abre un **nuevo ADR** con su propio analisis y se
  re-evalua si el sistema de modulos sigue siendo viable o si conviene
  promover el patron a una norma general (lo cual probablemente
  indicaria que `memory` deberia partirse o que parte de su VO/aggregate
  publico es realmente un kernel compartido).

#### 1.5.2 ADR-002 — PriorityBoost MULTIPLICATIVO en HybridScorer

**Status:** ACCEPTED — ratified by `architect-final-review` 2026-04-28
(Fase 5 Tarea 5.6).

**Fecha:** 2026-04-28.

**Contexto.** El spec `docs/01-arquitectura.md §2.6` describio
originalmente la formula de hybrid search con un termino aditivo de
prioridad explicita:

```
final_score = 0.4 * cosine_sim
            + 0.2 * bm25_normalized
            + 0.2 * recency_decay
            + 0.15 * usage_frequency
            + 0.05 * explicit_priority
```

La implementacion del dominio (`code/src/modules/retrieval/domain/`)
en Fase 1 modelo el `PriorityBoost` value object como un **factor
multiplicativo** sobre el score combinado:

```ts
final_score = base_score(cosine, bm25, recency, usage) * priority_boost
// con priority_boost ∈ [1.0, 10.0], default 1.0 (sin boost)
```

`PriorityBoost.of(N)` valida `N ∈ [1, 10]` y aplica multiplicacion al
`relevance_score`. La semantica fue revisada y APROBADA por
`ddd-validator` + `solid-validator` en ciclo 1 de Tarea 1.8 y por
`performance-auditor` en Tarea 3.3 sin observaciones.

**Decision.** **Conformar el spec a la implementacion.** El dominio
mantiene la formula multiplicativa. `docs/01 §2.6` se actualiza para
reflejar la formula real.

**Justificacion.**

1. **El aditivo invierte el ranking en cola larga.** Si una decision
   tiene priority alta (delta `+0.05`) pero score base 0.001
   (resultado de larga cola, lexical-only match), termina ranqueada
   POR ENCIMA de un match con score base 0.5 sin priority. Esto
   contradice la semantica de "priority modula importancia, no la
   crea de la nada". La forma multiplicativa preserva el orden
   relativo y respeta la propiedad de invariancia bajo escalado: si
   A.score > B.score sin priority, entonces A.score * boost_A >
   B.score * boost_B siempre que boost_A >= boost_B.
2. **Cambiar a aditivo requiere tocar 4 archivos en
   `retrieval/domain`, 2 use cases en `retrieval/application`, 1
   contrato de persistencia y ~30 tests unit aprobados.** Coste alto,
   beneficio negativo.
3. **El spec de Fase 0 (docs/01 §2.6) fue redactado antes de modelar
   el ranker.** El dominio tiene autoridad sobre el spec en este
   punto. La doc se actualiza al codigo, no al reves.
4. **Factores tipicos** (configurables, no hardcoded):
   - `1.0` = neutral (default, sin boost).
   - `1.5` = warning (memorias tipo `learning` con severity `warning`).
   - `3.0` = critical (memorias tipo `learning` con severity
     `critical`).
   - `10.0` = excepcional (uso reservado para overrides explicitos
     del usuario via `mem.remember --priority`).

**Alternativas rechazadas:**

| # | Alternativa | Razon de rechazo |
|---|---|---|
| (a) | Conformar codigo al spec aditivo | Inversiones de ranking en cola larga; coste alto; beneficio negativo. |
| (b) | Mezcla aditivo + multiplicativo | Doble parametro a calibrar; combinacion no lineal opaca para debug; sin ventaja sobre multiplicativo puro. |
| (c) | Mover a CombineFn pluggable (Strategy) | Over-engineering para MVP; el algoritmo es estable y publico; agregar una abstraccion innecesaria contradice YAGNI. |

**Consecuencias:**

- `docs/01-arquitectura.md §2.6` recibe la formula multiplicativa
  oficial.
- Cualquier nuevo `kind` o `severity` que requiera priority
  particular debe modificar el factory `PriorityBoost.forKind(kind,
  severity)` (no el HybridScorer).
- v0.5+ puede introducir un parametro `priority_clamp` configurable
  (ej: maximo 5.0 en lugar de 10.0) si benchmarks muestran que valores
  muy altos saturan el ranking.

---

#### 1.5.3 ADR-003 — ContextLayerKind ACL (domain vs wire)

**Status:** ACCEPTED — ratified by `architect-final-review` 2026-04-28
(Fase 5 Tarea 5.6).

**Fecha:** 2026-04-28.

**Contexto.** El bounded context `retrieval` modela las 7 capas del
context bundle (ver `docs/04-capas-contexto.md`) usando nombres
**domain-flavoured** que reflejan la semantica del producto:

| `ContextLayerKind` (domain) | Que contiene |
|---|---|
| `workspace_anchor` | Identidad del workspace + sesion implicita actual |
| `project_constitution` | Memorias del kind `decision` con tag `constitution` (reglas no negociables) |
| `active_decisions` | Decisiones activas relevantes a la sesion |
| `entities_in_focus` | Entities citadas en los ultimos N turns |
| `open_questions` | Preguntas sin resolver capturadas |
| `recent_turns` | Resumenes de turnos recientes |
| `suggested_next` | Hints inferidos por curator (proximas tareas, learnings aplicables) |

El protocolo MCP (`docs/02-protocolo-mcp.md §4.2`) expone los nombres
**wire-flavoured** que el cliente Claude Code consume:

| `LayerName` (wire) | Como lo usa Claude Code |
|---|---|
| `system_identity` | Capa con maxima prioridad de tokens |
| `project_constitution` | Reglas constitucionales del proyecto |
| `active_tasks` | Tareas en curso |
| `recent_turns` | Historial reciente |
| `relevant_memory` | Memorias relevantes a la query |
| `code_map` | Mapa estructural del codigo |
| `open_questions` | Preguntas abiertas |

Los dos vocabularios son **conceptualmente distintos**: domain refleja
la **clasificacion semantica** de las memorias (que tipo de
informacion contiene la capa); wire refleja la **clasificacion del
consumer** (como Claude Code prioriza tokens y combina capas).

**Decision.** Aceptar el mapping permanente. El **composition root**
(`code/src/composition/wiring/get-context-facade-adapter.ts`) mantiene
una tabla bidireccional `ContextLayerKind ↔ LayerName` que vive en
`composition/wiring/context-layer-mapper.ts`. Domain y wire son
intencionalmente distintos.

**Justificacion.**

1. **Anti-Corruption Layer canonico DDD.** Son dos vocabularios
   validos de **dos bounded contexts distintos**: domain de retrieval
   (modelo del producto) y wire format del MCP (contrato externo).
   Forzar un solo nombre acopla domain con wire format, lo cual es
   exactamente lo que ACL evita.
2. **Mapping auditado y estable.** Tres reportes de validadores
   (clean-architecture-validator + solid-validator +
   architect-review-final) verifican el mapping sin observaciones.
3. **Sin drift mientras los literales esten centralizados.** El
   composition root es el unico lugar donde aparecen ambos
   vocabularios; cualquier rename lateral rompe el typecheck.

**Tabla wire ↔ domain (canonica):**

| `LayerName` (wire / `docs/02 §4.2`) | `ContextLayerKind` (domain) | Notas |
|---|---|---|
| `system_identity` | `workspace_anchor` | Identidad del workspace + sesion |
| `project_constitution` | `project_constitution` | Coincidencia textual (decision deliberada: el termino es wire-y-domain estable) |
| `active_tasks` | `active_decisions` + tasks subset | Wire agrega `tasks.status='in_progress'` desde memory module |
| `recent_turns` | `recent_turns` | Coincidencia textual |
| `relevant_memory` | `entities_in_focus` + suggested_next subset | Wire agrega `suggested_next.kind='learning'` |
| `code_map` | `entities_in_focus` filtrado por `kind='module'` | Wire proyecta entities con kind file/module |
| `open_questions` | `open_questions` | Coincidencia textual |

**Alternativas rechazadas:**

| # | Alternativa | Razon de rechazo |
|---|---|---|
| (a) | Renombrar domain para que coincida con wire | Acopla retrieval bounded context a la nomenclatura del MCP; cualquier cambio de wire format obliga a refactorizar dominio. |
| (b) | Renombrar wire para que coincida con domain | Cambio breaking del contrato MCP que clientes ya consumen via spec docs/02. |
| (c) | Eliminar el mapper y dejar solo wire en composition | El dominio pierde semantica explicita (`entities_in_focus` es mas claro que `relevant_memory`); reduce trazabilidad de retrieval. |

**Consecuencias:**

- `docs/02 §4.2` recibe nota al pie: "el wire format usa estos
  literales; el dominio interno los modela como `ContextLayerKind` —
  ver ADR-003".
- Cualquier nueva capa (>7) requiere actualizar la tabla
  bidireccional + el spec docs/02 §4.2 + un test de mapping en
  `composition/wiring/__tests__/context-layer-mapper.test.ts`.
- El validador `clean-architecture-validator` debe verificar que
  ningun import de `LayerName` (wire) aparezca en
  `modules/retrieval/domain/` o `modules/retrieval/application/`.
- v0.5+ podra introducir un mapper bidireccional generado desde un
  schema declarativo (yaml/json) si el catalogo crece. MVP usa tabla
  hardcoded por simplicidad.

---

### 1.6 Cero `any`, type-safety total

**Reglas:**
- `tsconfig.json` con:
  ```json
  {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true
  }
  ```
- ESLint con `@typescript-eslint/no-explicit-any: "error"`,
  `@typescript-eslint/no-unsafe-*: "error"`.
- Cualquier valor desconocido entra como `unknown` y se valida con Zod
  antes de usarse.
- JSON externo (input de tools MCP, JSON.parse de columnas): siempre
  parsear con Zod schema, nunca `as Type`.
- Genericos completos: `Repository<TAggregate, TId>` con bounds.
- **No `any`. No `as any`. No `// @ts-ignore`. No `// @ts-nocheck`.** Solo
  `// @ts-expect-error <razon>` con justificacion documentada y revisada
  por el architecture-validator.
- Funciones siempre con tipo de retorno explicito (regla ESLint
  `@typescript-eslint/explicit-function-return-type`).
- Discriminated unions para variantes (kind, mode, status).
- Resultado de operaciones que pueden fallar: `Result<T, E>` o
  excepciones tipadas. Nunca `T | null` ambiguo.

---

## 2. Estructura de carpetas obligatoria

```
code/
├── src/
│   ├── shared/                                         ← modulo transversal
│   │   ├── domain/
│   │   │   ├── value-objects/
│   │   │   │   ├── id.ts
│   │   │   │   ├── timestamp.ts
│   │   │   │   ├── tags.ts
│   │   │   │   ├── workspace-id.ts
│   │   │   │   └── tokens.ts
│   │   │   ├── errors/
│   │   │   │   ├── domain-error.ts
│   │   │   │   ├── json-rpc-error-codes.ts
│   │   │   │   └── ...
│   │   │   └── types/
│   │   │       └── result.ts
│   │   ├── application/
│   │   │   └── ports/
│   │   │       ├── database.ts
│   │   │       ├── logger.ts
│   │   │       ├── embedder.ts
│   │   │       ├── kdf.ts
│   │   │       ├── clock.ts
│   │   │       └── id-generator.ts
│   │   └── infrastructure/
│   │       ├── persistence/
│   │       │   ├── sqlite-database.ts
│   │       │   └── migration-runner.ts
│   │       ├── crypto/
│   │       │   ├── argon2id-kdf.ts
│   │       │   └── sqlcipher-driver.ts
│   │       ├── embedder/
│   │       │   ├── fastembed-adapter.ts
│   │       │   └── voyage-adapter.ts
│   │       ├── logger/
│   │       │   └── pino-logger.ts
│   │       ├── time/
│   │       │   └── system-clock.ts
│   │       └── id/
│   │           └── uuid-v7-generator.ts
│   ├── modules/
│   │   ├── workspace/
│   │   │   ├── domain/
│   │   │   │   ├── aggregates/
│   │   │   │   │   └── workspace.ts
│   │   │   │   ├── value-objects/
│   │   │   │   │   ├── workspace-mode.ts        ← shared|encrypted|private
│   │   │   │   │   └── workspace-config.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── workspace-repository.ts
│   │   │   │   └── services/
│   │   │   │       └── workspace-detector.ts    ← interface
│   │   │   ├── application/
│   │   │   │   ├── use-cases/
│   │   │   │   │   ├── initialize-workspace.ts
│   │   │   │   │   ├── change-mode.ts
│   │   │   │   │   └── ...
│   │   │   │   ├── ports/
│   │   │   │   │   └── in/
│   │   │   │   └── dtos/
│   │   │   └── infrastructure/
│   │   │       ├── persistence/
│   │   │       │   └── filesystem-workspace-repository.ts
│   │   │       └── detection/
│   │   │           └── filesystem-workspace-detector.ts
│   │   ├── memory/
│   │   │   └── ... (mismo patron)
│   │   ├── retrieval/
│   │   ├── curator/
│   │   ├── secrets/
│   │   ├── encryption/
│   │   ├── mcp-server/
│   │   └── cli/
│   └── composition/                                    ← composition root
│       ├── server.ts                                   ← entry MCP server
│       ├── cli.ts                                      ← entry CLI
│       ├── container.ts                                ← DI container
│       └── tool-registry.ts                            ← registra tools del MCP
├── tests/
│   ├── unit/
│   │   └── modules/<name>/...
│   ├── integration/
│   │   └── modules/<name>/...
│   └── e2e/
│       └── ...
├── migrations/                                         ← .sql files
├── scripts/
│   ├── validate-modules.ts                             ← valida cross-imports
│   └── ...
├── package.json
├── tsconfig.json
├── eslint.config.js
├── vitest.config.ts
├── sonar-project.properties
└── .gitignore
```

---

## 3. Convenciones de nombrado

### 3.1 Archivos
- `kebab-case.ts` para todos los archivos.
- Sufijos descriptivos:
  - `<name>.ts` — clase/funcion principal
  - `<name>.port.ts` — **interface de puerto** (Hexagonal Architecture).
    Convencion **obligatoria** para todo puerto declarado en
    `domain/repositories/`, `application/ports/` o `application/ports/out/`,
    en `shared/` y en cada `modules/<name>/`. Ratificada en Fase 2 con
    los 5 puertos transversales de `shared/application/ports/`
    (`database-connection.port.ts`, `logger.port.ts`, `clock.port.ts`,
    `id-generator.port.ts`, `embedder.port.ts`). El sufijo es
    coherente con el sufijo `Port` de identificadores TypeScript
    cuando hay ambiguedad (§3.2). Resuelve B-004.
  - `<name>.repository.ts` — interface de repositorio (en domain).
    Caso especial de puerto con sufijo dedicado por su rol DDD.
  - `<name>-repository.ts` — adaptador concreto (en infrastructure)
  - `<name>.use-case.ts` — caso de uso
  - `<name>.dto.ts` — DTO
  - `<name>.spec.ts` — test unitario
  - `<name>.integration.spec.ts` — test de integracion
  - `<name>.e2e.spec.ts` — test E2E

### 3.2 Identificadores TypeScript
- `PascalCase` para clases, interfaces, types, enums.
- `camelCase` para variables, funciones, metodos, propiedades.
- `UPPER_SNAKE_CASE` para constantes globales.
- Sin prefijo `I` para interfaces (`Repository`, no `IRepository`).
- Sufijo `Port` para puertos cuando ambiguo (`EmbedderPort`).

### 3.3 Lenguaje del dominio
- Nombres de entidades, VOs, agregados en **ingles** y reflejan el negocio.
- Comentarios tecnicos pueden estar en ingles.
- Mensajes de error visibles al usuario en **espanol** (segun lineamiento
  del CLAUDE.md global del usuario).

---

## 4. Reglas de testing

- **Cobertura minima global: 95%** (validada por SonarQube).
- **Cobertura minima en `domain/` y `application/`: 100%**. Estas capas
  no tocan I/O, no hay excusa.
- **Cobertura minima en `infrastructure/`: 90%**.
- Tests:
  - **Unit**: cada use case, cada VO, cada agregado, cada servicio de
    dominio. Sin DB, sin red.
  - **Integration**: por modulo, con DB SQLite real (in-memory o tmp).
  - **E2E**: cliente MCP test que se conecta al server y ejecuta flows
    completos.
- Tests usan **Vitest**.
- **Fixtures**: en `tests/fixtures/`, factorias que crean agregados validos
  para tests.
- **NO mocks de cosas que no son interfaces.** Si quieres mockear, hay que
  inyectar puerto.

---

## 5. Reglas de seguridad (resumen, detalle en 11)

- Cero `any` ya cubre buena parte de los OWASP de inyeccion (TS detecta
  tipos incorrectos).
- Prepared statements **siempre** en SQL. Nunca `${variable}` en SQL.
- Path traversal: paths siempre canonicalizados antes de usar.
- Secrets detection en 5 capas (ver `11-seguridad-modos.md`).
- Cifrado: argon2id KDF (parametros minimos: 64 MiB, 3 iter, 4 lanes) +
  AES-256 SQLCipher.
- Permisos `0600` en archivos de claves locales.

---

## 6. Reglas de performance (resumen)

- Latencias targets en `01-arquitectura.md` §10. **Si un PR las degrada
  sin justificacion documentada, se rechaza.**
- Indices apropiados en cada query frecuente.
- Embeddings async, no bloquean writes.
- WAL mode en SQLite.
- Benchmarks en `tests/benchmarks/` para queries criticas.

---

## 7. Como se valida cada lineamiento

Cada lineamiento tiene un agente validador especifico. Detalle en
`13-workflow-agentes.md`.

| Lineamiento | Validador |
|---|---|
| 1.1 Clean Architecture | `clean-architecture-validator` |
| 1.2 DDD | `ddd-validator` |
| 1.3 Hexagonal | `clean-architecture-validator` (cubre puertos+adaptadores) |
| 1.4 SOLID | `solid-validator` |
| 1.5 Modularidad | `clean-architecture-validator` (cubre cross-imports) |
| 1.6 Cero `any` | `solid-validator` (cubre type-safety) |
| Seguridad | `security-auditor` |
| Performance | `performance-auditor` |
| Coverage 95% + SonarQube | `qa-sonarqube-auditor` |

**Workflow:** ningun PR/cambio se da por aprobado hasta que TODOS los
validadores aplicables aprueben. Si uno rechaza, vuelve al implementador
con instrucciones especificas (archivo, linea, cambio concreto).

---

## 8. Excepciones (proceso)

Una excepcion a alguno de los lineamientos requiere:

1. Comentario `// EXCEPTION: <lineamiento>: <razon detallada>` en el codigo.
2. Issue / ticket que documente la decision.
3. Aprobacion del `clean-architecture-validator` con `EXCEPTION_APPROVED`.
4. Plan de cuando se eliminara la excepcion.

**Defaults:**
- 0 excepciones permitidas para `cero any`.
- 0 excepciones permitidas para `cross-import entre modulos`.
- Excepciones para SOLID: solo si la simplicidad justifica y el validador
  lo apoya.
