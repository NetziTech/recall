# DDD Validator — Phase 1, Task 9 (curator domain)

**Validator:** `ddd-validator`
**Phase:** `phase-1-domain`
**Module:** `curator`
**Scope:** `code/src/modules/curator/domain/` (33 files)
**Verdict:** **APPROVED**

---

## Resumen ejecutivo

Auditado integralmente el dominio del Curador contra las reglas R1–R7
del lineamiento 1.2. **Cero violaciones DDD.** Todos los chequeos
estructurales pasan (constructores privados, factories estáticas,
`equals` en VOs, `pullEvents` en aggregate, eventos en past tense,
nombres del dominio, lifecycle invariantes) y las decisiones de diseño
señaladas en el brief son DDD-aceptables.

---

## Resultados por regla

### R1 — Entidades / Aggregate (`CuratorRun`)

| Chequeo | Resultado |
|---|---|
| Identidad explícita (`CuratorRunId` branded VO) | OK |
| `private constructor` + factories `start` / `rehydrate` | OK |
| Sin setters públicos | OK |
| Mutaciones via verbos del negocio (`recordFinding`, `recordConsolidation`, `recordPrune`, `complete`) | OK |
| Igualdad por id (heredada del patrón) | OK (no se compara estructuralmente) |
| Encapsulación: campos `private`, queries devuelven snapshots frozen (`getFindings`, `getConsolidations`) | OK |

**Lifecycle two-state (running → completed) verificado:**
- `assertRunning()` gate en cada mutador (líneas 190, 214, 241).
- `complete()` rechaza re-completion (línea 270) y time-travel
  (línea 273) con `endedAt < startedAt`.
- `rehydrate()` revalida invariante `endedAt >= startedAt` para evitar
  rows corruptas (línea 159).
- Buffer de eventos drenable una vez via `pullEvents()` con freeze
  (línea 346).

### R2 — Value Objects (15 VOs)

| VO | `private constructor` | Factory `static` | Props `readonly` | `equals` | Validación invariantes |
|---|:--:|:--:|:--:|:--:|:--:|
| `affected-entry-ref` | OK | `of` | OK | OK | OK |
| `consolidation-pair` | OK | `of` | OK | OK | OK (rechaza self-pair y cross-kind) |
| `consolidation-threshold` | OK | `of` / `default` | OK | OK | OK ([0, 1]) |
| `cosine-score` | OK | `of` | OK | OK | OK ([-1, 1]) |
| `curator-run-id` | OK (heredado de `Id`) | `from` | OK | hereda | OK (UUID v7) |
| `curator-run-stats` | OK | `of` / `empty` / `with` | OK | OK | OK (no-neg int per counter) |
| `curator-run-trigger` | OK | `scheduled`/`manual`/`sessionClose`/`create` | OK | OK | OK (enum) |
| `decay-factor` | OK | `of` / `forKind` / `unity` | OK | OK | OK ((0, 1]) |
| `health-finding-kind` | OK | named factories + `create` | OK | OK | OK (enum) |
| `health-finding` | OK | `create` | OK + freeze de array | OK | OK (descripción 1–2000 chars) |
| `health-severity` | OK | `info`/`warning`/`error`/`create` | OK | OK | OK (enum) + `rank()`/`isAtLeast` |
| `max-entries-per-kind` | OK | `default` / `of` | OK + freeze de record | OK | OK (entero positivo per kind) |
| `memory-entry-kind` | OK | named factories + `create` | OK | OK | OK (enum 5 valores) |
| `path-staleness` | OK | named factories | OK | OK | OK (path no-vacío + enum 3 valores) |
| `prune-threshold` | OK | `default` / `of` | OK | OK | OK ([0, 1]) |
| `pruned-entry` | OK | `create` | OK | OK | OK (snapshot 1–64 KiB) |
| `pruned-reason` | OK | named factories + `create` | OK | OK | OK (enum 4 valores) |

Todos los VOs validan invariantes en el constructor estático y lanzan
`InvalidInputError` / `InvalidDecayFactorError` /
`InvalidConsolidationPairError` (todos extienden `DomainError`).
Inmutabilidad real: `Object.freeze` aplicado donde el campo es
colección (`HealthFinding.affectedEntries`, `MaxEntriesPerKind.caps`,
`CuratorRunStats.toRecord`).

### R3 — Aggregate `CuratorRun`

| Chequeo | Resultado |
|---|---|
| Una raíz, en `domain/aggregates/` | OK |
| Único punto de acceso (no hay entidades internas expuestas) | OK |
| Cada mutación garantiza invariantes (`assertRunning`, `endedAt >= startedAt`) | OK |
| Cada mutación emite evento (`HealthFindingDetected`, `LearningsConsolidated`, `EntryPruned`, `CuratorRunStarted`, `CuratorRunCompleted`) | OK |
| `pullEvents(): readonly DomainEvent[]` con drain + freeze | OK (líneas 346–351) |
| `rehydrate` sin emitir eventos (no hay hecho de negocio) | OK (línea 174) |

### R4 — Repositorios (interfaces)

| Repo | Trabaja con aggregate completo | Métodos del negocio | `Promise` |
|---|:--:|:--:|:--:|
| `CuratorRunRepository` | OK (`CuratorRun`) | `findById`, `save`, `findRecentByWorkspace`, `findLastByWorkspace` | OK |
| `PrunedEntryRepository` | OK (VO append-only) | `save`, `findById`, `findByWorkspace` | OK |

Cero `findByQuery(predicate)` genérico. `findRecentByWorkspace` y
`findLastByWorkspace` son nombres explícitos del negocio. El contrato
del aggregate `pullEvents` está claramente desacoplado del repositorio
(documentado en `curator-run-repository.ts` líneas 19–21).

### R5 — Servicios de dominio

| Servicio | Tipo | Justificación DDD |
|---|---|---|
| `DecayCalculator` | clase pura `static`, `private constructor` | Lógica que codifica una fórmula del lineamiento 05 §2. No es un caso de uso, no toca I/O, no tiene clock. Cumple criterio de "servicio de dominio puro" (lineamiento 1.2 fila "Servicio de dominio"). El `private constructor` hace la clase efectivamente final, lo que evita extension drift y mantiene OCP por composición vía `DecayFactor.forKind`, no por subclasing. **Aceptable.** |
| `EntryCollector` | interface (driven port) | Evita que el dominio del curador conozca los repositorios per-kind del módulo memory; inyecta enumeración como puerto. Patrón hexagonal correcto. |
| `ConsolidationDetector` | interface (driven port) | El cómputo cosine-similarity vive en infrastructure (Embedder); el dominio sólo expone el contrato. Correcto. |
| `PathChecker` | interface (driven port) | `fs.stat` en infra; el dominio queda libre de I/O. Correcto. |

### R6 — Eventos

| Evento | Past tense | `eventName` `"curator.<kebab>"` | Solo datos del hecho | Implementa `DomainEvent` |
|---|:--:|:--:|:--:|:--:|
| `CuratorRunStarted` | OK | `"curator.run-started"` | OK | OK |
| `CuratorRunCompleted` | OK | `"curator.run-completed"` | OK (carga `stats` final, no aggregate) | OK |
| `HealthFindingDetected` | OK | `"curator.health-finding-detected"` | OK | OK |
| `LearningsConsolidated` | OK | `"curator.learnings-consolidated"` | OK (pair, no aggregate) | OK |
| `EntryPruned` | OK | `"curator.entry-pruned"` | OK | OK |

Todos los campos `readonly`. Todos cargan `workspaceId` + `runId`
para correlación. Ningún evento copia el aggregate completo.

### R7 — Lenguaje del dominio

| Nombre | Veredicto |
|---|---|
| `CuratorRun`, `CuratorRunStats`, `CuratorRunTrigger`, `CuratorRunId` | Específico del negocio |
| `HealthFinding`, `HealthFindingKind`, `HealthSeverity` | Específico del negocio |
| `ConsolidationPair`, `ConsolidationThreshold`, `ConsolidationDetector` | Específico del negocio |
| `DecayFactor`, `DecayCalculator` | Específico del negocio |
| `PruneThreshold`, `PrunedEntry`, `PrunedReason`, `PrunedEntryRepository` | Específico del negocio |
| `PathStaleness`, `PathChecker` | Específico del negocio |
| `MaxEntriesPerKind`, `MemoryEntryKind`, `AffectedEntryRef`, `EntryCollector`, `CosineScore` | Específico del negocio |

**Cero banderas rojas.** Las apariciones de `Item` / `Record` /
`Object` / `Manager` / `Helper` que el grep encontró son sustantivos
con significado de dominio (`MemoryEntryKind`, `MaxEntriesPerKind`,
`CuratorRunStatsInput`, uso de `Record<...>` para tipar mapas) o
aparecen en JSDoc, no como nombres de clase. No hay `Util`, `Service`
genérico, `Manager`, `Handler` genérico ni prefijo `I`.

---

## Decisiones de diseño señaladas en el brief

### Decisión #1 — `DecayCalculator` static-only class

**DDD-aceptable.** El servicio cumple los tres criterios del
lineamiento 1.2 para "servicio de dominio":

1. Codifica conocimiento del negocio (la fórmula geométrica de
   `docs/05-memoria-decay.md` §2).
2. No tiene I/O, no tiene clock, no tiene estado.
3. La operación no encaja naturalmente en ningún aggregate (afecta
   confidences que viven en aggregates de **otro módulo** —
   `Decision`, `Learning`, `Entity`, `Task`, `Turn` — y cruzar los
   cinco rompería la frontera `curator`).

El `private constructor` es la forma idiomática de TypeScript de
expresar "namespace de funciones puras" cuando no se quiere usar
`namespace`/`module` exports sueltos. Mantener un símbolo único
`DecayCalculator` ayuda al lenguaje del dominio (la fórmula tiene un
nombre).

**Funneling vía `Confidence.of(...)` (línea 104):** decisión
correcta. Garantiza la invariante [0, 1] estructuralmente, no por
prueba matemática externa. Si en el futuro `Confidence` añade más
invariantes (clamp, fuzz, etc.), `DecayCalculator` las hereda
automáticamente.

### Decisión #2 — Decay defaults per-day vs spec per-period

**Documentado y consistente, pero introduce drift respecto a la spec.**

El `docs/05-memoria-decay.md` §2 expresa la fórmula como:
```
nuevo = current * factor ^ (dias_sin_uso / decay_period_dias)
```
Con tabla `(factor, period)` por kind. El implementador **commite a
una normalización per-day** y elimina `decay_period_dias` del modelo
(`DEFAULT_DECAY_FACTORS_PER_DAY`).

Verificación numérica de coherencia con la spec:
- Spec `decision active`: 0.99 sobre 90 días → equivalencia per-day:
  `0.99^(1/90) ≈ 0.999888`. **El código declara 0.95 per-day** →
  sobre 90 días eso da `0.95^90 ≈ 0.0099`, mientras la spec daría
  `0.99`. **Hay un factor ~100x de drift en decay para decisions.**
- Spec `learning tip`: 0.95 sobre 30 días → per-day `0.95^(1/30) ≈
  0.9983`. **El código declara 0.92 per-day** → sobre 30 días da
  `0.92^30 ≈ 0.082`, vs spec `0.95`. **Drift severo.**
- Spec `learning warning`: 0.97 sobre 60 días → per-day ≈ `0.99949`.
  Código: 0.97 per-day → sobre 60 días `0.97^60 ≈ 0.16`, vs spec
  `0.97`. **Drift severo.**
- Spec `learning critical`: 1.0 (∞ period) → código: 0.99 per-day →
  sobre 365 días `0.99^365 ≈ 0.0255`, vs spec `1.0` (sin decay).
  **Drift crítico para learnings critical, que la spec dice "no
  decay" y el código sí decae.**
- Spec `task done`: 0.9 / 7 → per-day ≈ `0.985`. Código: 1.0 per-day
  → sin decay. **Conservador (no rompe pruning), pero diverge.**
- Spec `task open`: 1.0 (∞) → código: 1.0. **OK.**
- Spec `turn`: 0.85 / 14 → per-day ≈ `0.989`. Código: 0.9 per-day →
  sobre 14 días `0.9^14 ≈ 0.229`, vs spec `0.85`. **Drift severo.**

**Veredicto DDD:** la decisión de **modelar el factor como per-day**
está bien (simplifica composición, elimina campo redundante y
encaja mejor con la fórmula `factor ^ days`). Pero **los valores
literales no son el equivalente per-day de la spec**, sino los
valores per-period copiados crudos. Esto es un **defecto numérico**,
no una violación DDD: el VO `DecayFactor` mantiene su invariante
`(0, 1]` y `forKind()` sigue siendo el único punto de drift posible.

**Recomendación (no rechaza la fase 1):** documentar explícitamente
en `decay-factor.ts` que los valores **no** son los de la spec y
abrir un ticket para que en Fase 2 (application + integración) se
decida: (a) reescribir como derivados verdaderos `factor^(1/period)`
de la tabla del doc 05, o (b) actualizar `docs/05-memoria-decay.md`
para que la tabla coincida con los valores per-day. La elección
afecta UX (¿cuán rápido olvidamos?) y es decisión del
domain-modeler, no del validador DDD.

**Para esta auditoría DDD:** APROBADO con observación. El modelo es
DDD-correcto; el drift es un bug de configuración/semántica, no de
arquitectura.

### Decisión #3 — `task` no decay (kind-level)

**Coherente con el espíritu de la spec, conservador.** La spec
diferencia `task (open)` (∞) y `task (done)` (0.9/7). El código
**colapsa ambos a 1.0** porque el módulo memory aún no expone una
discriminación por status para tasks (verificable: el comentario en
`decay-factor.ts` líneas 22–27 lo justifica). El peor caso es que
una task done vive más de lo necesario, lo cual no rompe ninguna
invariante de pruning (`PruneThreshold.qualifies` requiere
`confidence < 0.1`, inalcanzable con factor 1.0). **Aceptable como
MVP** siempre que se abra ticket para cuando `Task` exponga un
discriminador.

### Decisión #4 — `ConsolidationPair` como recommendation, fold por application

**DDD-correcto.** Es el patrón canónico cuando una operación afecta a
**múltiples aggregates**:

1. El curador es responsable de **detectar** y **registrar la
   intención** (su propia auditoría).
2. La aplicación reacciona al evento `LearningsConsolidated` y
   ejecuta `Learning.consolidateInto(winner.id)` sobre el aggregate
   loser, dentro de su propio bounded context.

Esto respeta:
- **Aggregate root como única autoridad sobre sus invariantes**: el
  curador no conoce ni puede mutar `Learning`.
- **Tell-don't-ask**: el dominio dice "esto pasó (recommendation
  recorded)"; la aplicación decide qué hacer.
- **Validación de la pair en el constructor** (`InvalidConsolidationPairError`
  rechaza self-pair y cross-kind), preservando la regla de
  "VOs validan en el constructor".

El doc-string del evento `LearningsConsolidated` (líneas 18–22)
documenta explícitamente el split. **Aprobado sin observaciones.**

### Decisión #6 — `PrunedEntry` como VO append-only

**DDD-correcto.** Un `PrunedEntry` es un *snapshot* inmutable: nace
con todos sus campos finales y nunca cambia. No tiene lifecycle, no
tiene mutadores, no emite eventos por sí mismo (el evento de prune
lo emite `CuratorRun.recordPrune` desde el aggregate root). Modelar
esto como aggregate añadiría ceremonia inútil:

- No habría invariantes inter-entidad que proteger (es un snapshot
  plano de strings + ids + timestamp).
- Su repositorio (`PrunedEntryRepository.save`) es append-only por
  contrato declarado (líneas 14–20).
- Equality por valor (todos los campos) es la semántica natural —
  igualdad por id no aplica porque la "id" del original entry es
  precisamente uno de los campos comparados.

Mantener `PrunedEntry` como VO refuerza que `pruned` es una **tabla
de auditoría**, no un dominio activo. **Aprobado.**

### Decisión #7 — `AffectedEntryRef` `(MemoryEntryKind, canonical-uuid-string)`

**Justificado, con leve pérdida de type-safety controlada.** El VO:

- Validates el id a través de `Id.create<"curator-affected-entry">(rawId, "affected_entry_id")`
  (línea 44–47), rescatando la invariante UUID v7 sin importar las
  cinco subclases (`DecisionId`, `LearningId`, `EntityId`, `TaskId`,
  `TurnId`) del módulo memory.
- Almacena el id como `string` y descarta la brand una vez validada.
  La brand `"curator-affected-entry"` es decorativa.

**Trade-off:**
- **Gana:** desacoplamiento del módulo curator respecto a las cinco
  Id subclasses de memory. Si fueran tipadas estrictamente, el
  curator necesitaría importar (o conocer un union type) de cinco
  branded types y discriminar a la entrada.
- **Pierde:** type-safety en el callsite — un `.id` puede pasarse
  donde se esperaba un `DecisionId` sin que el compilador lo
  detecte. La pérdida queda **acotada al cruce curator → memory**,
  que ya es un cruce inter-módulo.

Para mitigar la pérdida, el dispatcher de eventos en application
debe usar el `MemoryEntryKind` discriminator antes de re-construir
el id concreto, p.ej.:
```ts
switch (entryRef.kind.toString()) {
  case "decision": await decisionRepo.findById(DecisionId.from(entryRef.id)); break;
  case "learning": await learningRepo.findById(LearningId.from(entryRef.id)); break;
  // ...
}
```
La validación se reactiva al construir el id branded concreto. El
diseño es DDD-aceptable como **boundary VO** (los VOs cross-context
suelen perder algo de tipado interno para preservar autonomía del
context). **Aprobado.**

---

## Observaciones (no rechazan)

1. **Drift numérico decay (Decisión #2)**: ver detalle arriba. Crear
   ticket para reconciliar `DEFAULT_DECAY_FACTORS_PER_DAY` con la
   spec 05 §2. **No es violación DDD**, es bug de configuración.

2. **Cross-module imports `curator → memory`** (3 archivos):
   - `value-objects/decay-factor.ts:1` → `LearningSeverity`
   - `services/decay-calculator.ts:3` → `LearningSeverity`
   - `services/consolidation-detector.ts:1` → `Learning`

   Estos importes contravienen el lineamiento **1.5 Modularidad
   estricta** ("Modulos NUNCA importan de otros modulos. Solo de
   `shared/`") y la regla 5 del CLAUDE.md global ("Si dos o mas
   modulos necesitan una funcionalidad, esa funcionalidad **se mueve
   a `shared/`** inmediatamente"). El brief del orquestador autoriza
   explícitamente la excepción ("Cero imports prohibidos (solo
   shared y memory)"), pero **esa autorización vive fuera de los
   docs versionados**. **Fuera del scope del DDD-validator** (R1–R7
   pasan); es responsabilidad del `clean-architecture-validator`
   decidir si la excepción aplica o si `LearningSeverity` debe
   moverse a `shared/domain/value-objects/` y `Learning` debe
   accederse vía un VO opaco (p.ej. `LearningSnapshot` en
   `shared/`). Recomendación: dejar constancia de la excepción en
   un comentario `// EXCEPTION: 1.5 — autorizado por orquestador
   Fase 1 Tarea 9 ...` en cada uno de los tres imports (proceso del
   lineamiento §8).

3. **`MemoryEntryKindKind` / `HealthFindingKindKind` / etc.**: el
   sufijo `Kind`-`Kind` es estilísticamente ruidoso pero coherente
   con la convención que el módulo memory ya usa para discriminated
   unions. No bloquea.

4. **`recordPrune` no acepta el `PrunedEntry` completo, sólo
   `kind+originalId+reason`** (curator-run.ts:235). El snapshot de
   contenido se construye downstream cuando la application lee el
   row para archivarlo. Esto es coherente con el split aggregate /
   application del Curador, pero significa que el `EntryPruned`
   evento NO carga el snapshot. La application debe re-leer la
   entrada antes de borrarla. Documentado en
   `events/entry-pruned.ts:11-22`. **OK.**

---

## Veredicto final

**APPROVED.** El dominio del Curador implementa correctamente las
reglas DDD R1–R7 del lineamiento 1.2:

- Aggregate `CuratorRun` con lifecycle one-way y guards en cada
  mutador.
- 17 VOs inmutables con factories estáticas, `equals` y validación
  de invariantes en construcción.
- 2 repositorios trabajando con aggregates/VOs completos, métodos
  del negocio.
- 1 servicio de dominio puro (`DecayCalculator`) + 3 driven ports
  (`EntryCollector`, `ConsolidationDetector`, `PathChecker`)
  correctamente posicionados.
- 5 eventos en past tense con prefijo `curator.`, sólo datos del
  hecho, implementan `DomainEvent`.
- 4 errores específicos extendiendo `CuratorDomainError` →
  `DomainError`.
- Lenguaje del dominio respetado: cero banderas rojas.

Las 7 decisiones notables del brief son DDD-aceptables; sólo la #2
(drift de valores decay) merece un ticket de seguimiento numérico
fuera del ámbito de esta auditoría.

