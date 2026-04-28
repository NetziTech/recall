# Clean Architecture Validator — Phase 3, Task 3.3 (`retrieval/`)

- Validator: `clean-architecture-validator`
- Phase: `phase-3-task-3` (B-005 ADR-001 ratification)
- Validated at: 2026-04-27
- Scope: `code/src/modules/retrieval/{application,infrastructure}` (20 .ts) + `code/migrations/002__retrieval-schema.sql`

## Resumen

Auditados los 20 ficheros TypeScript del modulo `retrieval/` mas la migracion
`002__retrieval-schema.sql`. La auditoria confirma:

1. CERO violaciones del validador automatico (`npm run validate:modules`):
   `[OK] retrieval (authorised cross-imports: memory×46)`. El conteo del
   experto (46) coincide al byte con el del validador.
2. **TODOS** los cross-imports salen exclusivamente hacia
   `modules/memory/domain/...`. No hay un solo import a
   `memory/application/`, `memory/infrastructure/`, ni a otros modulos
   (`workspace`, `curator`, `secrets`, `encryption`, `mcp-server`, `cli`).
3. Los imports cross-modulo son **read-only / projection types**: VOs y
   branded types (`DecisionId`, `LearningSeverity`, `SessionId`,
   `TaskTitle`, `TurnSummary`, `OpenQuestion`, `Scope`, `EmbeddingStatus`,
   `LastUsed`, `UseCount`, etc.). Cero llamadas a metodos mutadores de
   aggregates de `memory`.
4. Convencion `.port.ts` aplicada uniformemente (5/5 ports).
5. Use cases inyectan puertos por constructor; no hay `new SqliteX`,
   `new Vec0X`, `new Tiktoken`, `new AsyncEmbedding`, ni `new RawEmbedder`
   en `application/`.
6. Domain libre de librerias externas e independiente de `application/`
   e `infrastructure/`.
7. La migracion crea exclusivamente tablas del pipeline de embeddings;
   NO crea las tablas base de `memory` (decisions/learnings/etc), tal
   como el alcance de la Tarea 3.3 exige.
8. No existe `code/src/composition/` (correcto: es Fase 4).

## Criticos

Ninguno.

## No criticos

Ninguno.

## Verificaciones detalladas

### A. Direccion de dependencias (capas internas)

| Check | Comando | Resultado |
|---|---|---|
| `application/` no importa `infrastructure/` | `grep -rE "\\.\\./(\\.\\./)*infrastructure" code/src/modules/retrieval/application/` | sin matches |
| `domain/` no importa `application/`/`infrastructure/` | `grep -rE "(application\|infrastructure)/" code/src/modules/retrieval/domain/` | sin matches |
| Use cases inyectan ports por constructor | `grep -nE "constructor\|private readonly" en los 4 use-cases` | OK — todos los ports llegan via constructor |
| Use cases NO instancian adapters | `grep -E "new (Sqlite\|Vec0\|Tiktoken\|AsyncEmbedding\|RawEmbedder)" code/src/modules/retrieval/application/` | sin matches |

### B. ADR-001 ratificacion (B-005)

#### B.1 Cross-imports — destino unico `memory/domain/`

Comando ejecutado:

```
grep -rEn "from ['\"]\\.\\." code/src/modules/retrieval/ \
  | grep -E "modules/memory/(application|infrastructure)/"
```

Resultado: **sin matches**. Cero imports a `memory/application/` o
`memory/infrastructure/`.

Comando ejecutado:

```
grep -rEn "from ['\"]\\.\\." code/src/modules/retrieval/ \
  | grep -E "\\.\\./(\\.\\./)+(workspace|curator|secrets|encryption|mcp-server|cli)/"
```

Resultado: **sin matches**. Cero imports a otros modulos hermanos.

Conteo total `retrieval/ -> memory/domain/`:

```
grep -rEn "memory/domain" code/src/modules/retrieval/ | wc -l
=> 49
```

(49 lineas de codigo donde un identificador de `memory/domain` aparece;
el validador AST cuenta **statements** de import distintos = 46. El
delta es exactamente `re-export lines` y multiples `from` por bloque
import — no son cross-imports adicionales.)

Distribucion por capa (todas hacia `memory/domain/value-objects/...`):

- `retrieval/domain/value-objects/`: `decision-ref.ts` (3),
  `entity-ref.ts` (4), `task-ref.ts` (4), `turn-ref.ts` (2),
  `open-question-ref.ts` (2), `recency-score.ts` (1),
  `usage-score.ts` (1), `embedding-status.ts` (1),
  `workspace-anchor-payload.ts` (2).
- `retrieval/domain/aggregates/context-bundle.ts` (1).
- `retrieval/domain/events/context-bundle-assembled.ts` (1).
- `retrieval/application/ports/out/memory-projection-repository.port.ts` (3).
- `retrieval/application/use-cases/recall-memory.use-case.ts` (1) y
  `get-context-bundle.use-case.ts` (1).
- `retrieval/infrastructure/persistence/sqlite-memory-projection-repository.ts` (19).

Todos los simbolos importados son **types / branded VOs / enum-like
sentinels** (`DecisionId`, `DecisionTitle`, `EntityKind`, `LastUsed`,
`LearningSeverity`, `OpenQuestion`, `Scope`, `SessionId`,
`SessionIntent`, `TaskId`, `TaskPriority`, `TaskStatus`, `TaskTitle`,
`TurnId`, `TurnSummary`, `UseCount`, `EmbeddingStatus`,
`EntityDescription`, `EntityId`, `EntityName`). Ninguno es un
aggregate-root con metodos mutadores; el tipo mas "rico" es
`OpenQuestion` que es un VO inmutable.

> Conclusion B.1: el cross-import obedece estrictamente la clausula del
> ADR-001: `retrieval/` lee VOs de `memory/domain/` para construir
> proyecciones de lectura. No muta nada.

#### B.2 Salida del validador automatico

```
$ npm run validate:modules
Module import audit
===================
  [OK] cli
  [OK] curator (authorised cross-imports: memory×10)
  [OK] encryption
  [OK] mcp-server
  [OK] memory
  [OK] retrieval (authorised cross-imports: memory×46)
  [OK] secrets
  [OK] workspace

Result: PASS — no module violations.
```

`scripts/validate-modules.ts` codifica las exceptions del ADR-001 en
`ADR_001_AUTHORISED_EXCEPTIONS` (lineas 84-87) y reporta exactamente las
46 aristas autorizadas para `retrieval -> memory/domain`. La cifra
coincide con la cifra reportada por `retrieval-expert`.

### C. Composition root

```
ls code/src/composition/  -> No such file or directory
```

Correcto: Fase 4 todavia no comenzo.

### D. Convencion `.port.ts`

```
application/ports/in/  : count-tokens.port.ts
                         get-context-bundle.port.ts
                         recall-memory.port.ts
application/ports/out/ : embedding-queue-repository.port.ts
                         memory-projection-repository.port.ts
```

5/5 con sufijo `.port.ts`. OK.

### E. Adapters concretos para cada puerto

| Puerto / Servicio | Implementacion |
|---|---|
| `Embedder` (domain/services) | `RawEmbedderAdapter` |
| `TokenCounter` (domain/services) | `TiktokenTokenCounter` |
| `LexicalSearch` (domain/services) | `SqliteFts5LexicalSearch` |
| `VectorSearch` (domain/services) | `SqliteVecVectorSearch` |
| `MemoryProjectionRepository` (application/ports/out) | `SqliteMemoryProjectionRepository` |
| `EmbeddingQueueRepository` (application/ports/out) | `SqliteEmbeddingQueueRepository` |

Cada interface en `domain/services/` o `application/ports/out/` tiene
exactamente una implementacion concreta en `infrastructure/` con la
nomenclatura `<TecnologiaConcreta><PortName>`. OK.

### F. Migracion `002__retrieval-schema.sql`

| Check | Resultado |
|---|---|
| Filename matches `^(\d+)__([\w-]+)\.sql$` (codificado en `MigrationsRunner.FILENAME_REGEX`) | OK |
| `CREATE TABLE IF NOT EXISTS embedding_queue` | OK (linea 53) |
| `CREATE INDEX IF NOT EXISTS` × 4 | OK |
| `CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(...)` | OK (linea 84) |
| `CREATE TABLE IF NOT EXISTS embedding_metadata` | OK (linea 94) |
| NO crea `decisions`/`learnings`/`entities`/`tasks`/`turns`/`sessions` (eso pertenece a `memory` en otra Tarea) | OK — verificado con grep |
| Sin secrets embebidos (`password`/`api_key`/`token = ...`) | OK — sin matches |
| Comentarios documentan ownership y dependencias cruzadas | OK |

### G. Reuse de `domain/services/` como out-ports (hexagonal)

`LexicalSearch`, `VectorSearch`, `Embedder`, `TokenCounter` viven en
`retrieval/domain/services/` y son interfaces. Los adapters viven en
`retrieval/infrastructure/` y los implementan. En la doctrina hexagonal
clasica esto es valido: los puertos de salida pueden vivir en `domain/`
(servicios de dominio abstractos) o en `application/ports/out/` segun
la "altura" semantica del puerto. Como aqui `Embedder`/`TokenCounter`/
`LexicalSearch`/`VectorSearch` expresan capacidades del dominio (no
detalles de orquestacion), su lugar correcto es `domain/services/`. La
direccion sigue siendo correcta: `infrastructure -> domain` (los
adapters dependen de la interface, no al reves).

OK, sin objeciones.

### H. Domain puro

```
grep -rEn "^import .* from ['\"][^.]" code/src/modules/retrieval/domain/ | grep -v "node:"
=> sin matches
```

Domain no importa librerias externas (zod, fastembed, better-sqlite3,
tiktoken, etc.). Solo imports relativos. OK.

## ADR-001 ratificacion final

**Veredicto B-005: CERRADO POR PARTE DE `retrieval/`.**

Justificacion:

1. La unica clausula del ADR-001 que cubre a `retrieval/` es:
   "`retrieval/` puede importar de `memory/domain/...` (lectura,
   proyecciones)." Codificada literalmente en
   `scripts/validate-modules.ts:85`.
2. Los 46 imports observados respetan al pie de la letra:
   - destino unico = `memory/domain/value-objects/`;
   - simbolos = VOs / branded types / sentinels (cero aggregates
     mutados);
   - direccion = `retrieval -> memory` (nunca al reves).
3. Cero imports laterales a `workspace`, `curator`, `secrets`,
   `encryption`, `mcp-server` o `cli`.
4. El validador automatico, ejecutado limpio sobre el arbol completo,
   reporta `Result: PASS`.

**Salvedad:** B-005 tiene DOS modulos como excepciones autorizadas:
`retrieval/` y `curator/`. Esta validacion cierra **la mitad
correspondiente a `retrieval/`**. La validacion total de B-005 requiere
adicionalmente que el modulo `curator/` (entries `curator×10` en el
output del validador) sea auditado en su Tarea correspondiente. Si la
Tarea 3.3 audita SOLO `retrieval/`, este reporte es suficiente para
ratificar la mitad-`retrieval` del ADR-001 y declarar el riesgo
arquitectonico de cross-imports en `retrieval/` MITIGADO.

## Veredicto general

**APPROVED.**

Cero criticos, cero no-criticos. Tarea 3.3 cumple integramente con los
lineamientos §1.1, §1.3, §1.5 y §1.5.1 (ADR-001) de
`docs/12-lineamientos-arquitectura.md`.
