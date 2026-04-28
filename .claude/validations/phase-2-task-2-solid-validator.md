# Validación SOLID + type-safety — Tarea 2.2 (shared/infrastructure)

**Validador**: `solid-validator`
**Fecha**: 2026-04-27
**Alcance**: `code/src/shared/infrastructure/` (12 archivos)

---

## Veredicto

**APROBADO** — La capa de adapters concretos cumple los lineamientos
1.4 (SOLID) y 1.6 (type-safety) sin violaciones bloqueantes.

---

## Comandos ejecutados

| Comando | EXIT |
|---------|-----:|
| `cd code && npx tsc --noEmit` | 0 |
| `cd code && npx eslint src/shared/infrastructure/` | 0 |
| `grep -rEn ": any\|<any>\|as any\|Array<any>\|Promise<any>" src/shared/infrastructure/` | (sin matches; ver nota) |
| `grep -rEn "// @ts-ignore\|// @ts-nocheck\|// @ts-expect-error" src/shared/infrastructure/` | (sin matches) |

Nota: el único `as ...` con palabra `any` reportado por el grep
("as unknown as") no contiene `any` de hecho — es un doble cast
`unknown → BetterSqlite3Database` (ver check 2 abajo).

---

## Tabla de checks (1-16)

| # | Check | Resultado | Detalle |
|---|---|---|---|
| 1 | Cero `any` en código fuente | PASS | Ningún `: any`, `<any>`, `Array<any>` ni `Promise<any>` en los 12 archivos. |
| 2 | Cero `as any` | PASS | El único cast con `as` que aparece es `as unknown as BetterSqlite3Database` (sqlite-database.ts:237). No es `as any`; es un doble cast con tipo concreto y está justificado por el JSDoc del `interface BetterSqlite3Database` (66-78) — la lib no exporta tipos completos. ESLint type-aware aprueba. |
| 3 | Cero `// @ts-ignore` / `@ts-nocheck` / `@ts-expect-error` | PASS | Ninguno. |
| 4 | Tipos de retorno explícitos en métodos públicos | PASS | Todos los métodos públicos declaran retorno (`Promise<SqliteDatabase>`, `RunResult`, `void`, `Timestamp`, `Id<TBrand>`, etc.). ESLint enforce `explicit-function-return-type` y `explicit-module-boundary-types` y pasa. |
| 5 | `tsc --noEmit` EXIT=0 | PASS | tsconfig estricto completo: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`. |
| 6 | ESLint sobre `src/shared/infrastructure/` EXIT=0 | PASS | Config flat con `strictTypeChecked` + `stylisticTypeChecked` + reglas type-safety propias (no-explicit-any, no-unsafe-*, ban-ts-comment, no-restricted-syntax bloqueando `as any`). 0 warnings. |
| 7 | Validación Zod en boundaries | PASS | El único boundary que recibe input externo no-SQL es `MigrationsRunner.discoverMigrationFiles` y `parseRow`. Los nombres de archivo se validan con la regex `FILENAME_REGEX` (línea 94) y el versionado se valida con `Number.isFinite + parseInt`. La fila `schema_migrations` se parsea defensivamente en `parseRow` (267-297) con type guards explícitos sobre `unknown` (typeof + Number.isInteger + length checks) y errores tipados `DatabaseError.migrationDirectoryInvalid`. SQL crudo de los archivos de migración se pasa tal cual a `db.exec` (no aplica Zod, según la propia regla del audit). |
| 8 | SRP — responsabilidad única por clase | PASS | `SqliteDatabase` solo gestiona conexión/pragmas/tx/prepare-exec; `MigrationsRunner` solo corre migrations; `PinoLogger` solo logging; `FastembedEmbedder` solo embed; `SystemClock`/`FakeClock` solo tiempo; `UuidV7IdGenerator`/`FakeIdGenerator` solo ids. Ninguna clase mezcla concerns. Ver tabla de método-count abajo. |
| 9 | OCP — variabilidad por inyección | PASS | No hay `if (kind === ...)` ni switch sobre strings discriminadoras. La variabilidad está en: (a) opciones de construcción tipadas con interfaces (`SqliteDatabaseOpenOptions`, `PinoLoggerOptions`, `FastembedEmbedderOptions`, `FakeClockOptions`, `FakeIdGeneratorOptions`); (b) `FakeIdGenerator.mode` es un literal union `"counter" \| "sequence"` exhaustivo. La extensión a nuevos modelos en `FastembedEmbedder` se hace agregando entradas a `FASTEMBED_DIMENSIONS` (no editando lógica). |
| 10 | LSP — Fake sustituible por real | PASS | `FakeClock` implementa `Clock` con la misma signatura que `SystemClock`; `now()`/`nowMs()` jamás throw. Pre/post-condiciones idénticas (la única validación de `Timestamp.fromEpochMs` se aplica en construcción, no en `now()`). `FakeIdGenerator` implementa `IdGenerator`; `generate()`/`generateString()` pueden throw `InvalidInputError` cuando la sequence se agota o counter overflow — esto es una pre-condición de configuración del test, no una violación de LSP del path normal. El doble `seed`+`sequence` se rechaza en construcción, no en runtime. Acceptable. |
| 11 | ISP — un puerto por adapter | PASS | `SqliteDatabase implements DatabaseConnection` (solo); `PinoLogger implements Logger` (solo); `FastembedEmbedder implements Embedder` (solo); `SystemClock`/`FakeClock implements Clock` (solo); `UuidV7IdGenerator`/`FakeIdGenerator implements IdGenerator` (solo); `MigrationsRunner` no implementa puerto público (es un service infra), recibe `DatabaseConnection` y `Logger` por constructor. Cero "implements A, B" sospechosos. |
| 12 | DIP — dependencias inyectadas, sin `new` interno | PASS | `SqliteDatabase` recibe `Logger` vía `options`. `MigrationsRunner` recibe `Logger` por constructor (`private readonly logger`). `PinoLogger` factory `create()` construye el `pino()` interno (aceptable; es el adapter que envuelve la lib). `FastembedEmbedder` lazy-load `FlagEmbedding.init` dentro de `loadModel()` — aceptable y documentado como cold-start optimisation. `FakeIdGenerator` lleva sus dependencias (sequence, seed) por options. Ningún `new SomeRepo()` o `new SystemClock()` desde dentro de otra clase. |
| 13 | Errores tipados con `name`, `cause`, stack | PASS | `InfrastructureError` (abstract) extiende `Error`, asigna `this.name = new.target.name` (línea 50) → cada subclase reporta su propio nombre, y define `cause` non-enumerable preservando stack trace. `DatabaseError` y `EmbedderError` tienen constructor privado + factories estáticas con `code` literal (DatabaseErrorCode/EmbedderErrorCode) que mantiene el discriminador en el tipo. Stack se hereda del `super(message)`. |
| 14 | `SqliteDatabase.open` retorna `Promise<>` aunque es síncrono | APROBADO con observación (no bloqueante) | El JSDoc líneas 220-225 documenta explícitamente la decisión: "the signature is `Promise<...>` to leave room for a future libsql adapter that opens over a network socket." y aclara que el body es non-`async` para satisfacer `require-await` y devuelve `Promise.resolve(...)`. **Mi argumento**: es OCP válido (anticipa una variante asíncrona del puerto sin obligar a romper signaturas en use cases existentes). El costo es mínimo (un `Promise.resolve` por bootstrap, una vez por proceso). NO es YAGNI porque la decisión está respaldada por `docs/06-stack-tecnico.md` que ya menciona libsql como variante futura, y porque el `DatabaseConnection` port no impone sincronía. Aceptable. |
| 15 | `FastembedEmbedder` lazy loading + `dimension()` sin throw | PASS con matiz | El audit pidió "verificar que `getDimension()` arroja error tipado si modelo no inicializado". La implementación ELIMINA esa necesidad: pinea `pinnedDimension` en el constructor desde el catálogo estático `FASTEMBED_DIMENSIONS` (líneas 63-71), por lo que `dimension()` (línea 137) puede retornar el valor sin haber cargado el modelo. Es una decisión más fuerte que la solicitada — cumple el contrato del puerto (`Embedder.dimension()` "stable for the adapter's lifetime") incluso antes del primer `embed()`. El `EmbedderError.notInitialised` factory existe (embedder-error.ts:31) por si un futuro adapter sin catálogo lo necesita. Lazy-load del modelo con gating por `modelPromise` único (líneas 201-212) evita doble inicialización en concurrencia y resetea el promise a `null` en caso de error para permitir retry. Excelente. |
| 16 | JSDoc en clases públicas (propósito + ejemplo + errores) | PASS | Todas las clases tienen JSDoc completo: `SqliteDatabase` (151-206 con composition root example y lista de errores), `MigrationsRunner` (40-87 con example), `PinoLogger` (84-110 con example), `FastembedEmbedder` (76-118 con example y errores), `SystemClock` (4-21 con example), `FakeClock` (15-49 con example y time-travel API), `UuidV7IdGenerator` (6-28 con example), `FakeIdGenerator` (31-60 con dual example), `InfrastructureError` (1-44), `DatabaseError` (3-22), `EmbedderError` (9-18). El módulo `index.ts` también tiene JSDoc explicando qué se re-exporta y qué NO (incluyendo justificación de la Decisión Opción A sobre KDF en `modules/encryption/`). |

---

## Recuento de métodos públicos por clase

| Clase | Públicos (instancia + estáticos, excluye constructor) | Estado |
|---|---:|---|
| `SqliteStatement` (interna, exportada vía `prepare`) | 5 (run, get, all, iterate, source) | OK |
| `SqliteDatabase` | 5 (open[static], prepare, exec, transaction, close) | OK |
| `MigrationsRunner` | 1 (run) | OK |
| `PinoLogger` | 8 (create[static], trace, debug, info, warn, error, fatal, child) | Justo en el límite "soft" de 7. Aceptable: los 6 niveles de log son requisito del puerto `Logger`, no se pueden agrupar. ISP cumplido. |
| `FastembedEmbedder` | 3 (dimension, embed, embedBatch) | OK |
| `SystemClock` | 2 (now, nowMs) | OK |
| `FakeClock` | 4 (now, nowMs, advance, set) | OK |
| `UuidV7IdGenerator` | 2 (generate, generateString) | OK |
| `FakeIdGenerator` | 2 (generate, generateString) | OK |
| `InfrastructureError` (abstract) | 0 métodos + 1 abstract field (`code`) | OK |
| `DatabaseError` | 9 factories estáticas | Métodos estáticos = constructores nombrados (factory pattern); cada uno corresponde 1:1 a un `DatabaseErrorCode`. No es violación SRP — la responsabilidad única es "representar fallos de la familia database" y cada factory es solo un constructor con metadata fija. |
| `EmbedderError` | 4 factories estáticas | Idem DatabaseError. OK. |

Nota: el conteo de `PinoLogger` (8) supera el umbral *soft* de 7 que la guía menciona, pero es estructural del puerto `Logger` (6 niveles syslog + create + child). No hay forma de partir el adapter sin romper ISP del puerto. Aceptado.

---

## Observaciones (no bloqueantes)

1. **`SqliteDatabase.open` async-but-sync**: la decisión de retornar `Promise<>` está documentada y justificada (futuro libsql). Si en el roadmap definitivo se descarta libsql, conviene revisitar y simplificar a sync. Por ahora, válida bajo OCP.

2. **`as unknown as BetterSqlite3Database`** (sqlite-database.ts:237): el JSDoc del `interface BetterSqlite3Database` (66-78) declara explícitamente la subset que el adapter consume. Es la práctica estándar para envolver libs sin tipos completos sin recurrir a `as any`. ESLint type-aware aprueba.

3. **`FastembedEmbedder.dimension()` sin throw**: es más estricto que el audit solicitó. El catálogo estático evita la condición de carrera "preguntar dimension antes de cargar". Mantener.

4. **`FakeIdGenerator.formatCounter` overflow check** (línea 132): `0xff_ff_ff_ff_ff_ff` (12 hex digits) está dentro del rango `Number.MAX_SAFE_INTEGER`, OK para el uso de tests.

5. **`DEFAULT_REDACT_PATHS`** (pino-logger.ts:28-60): incluye keys flat + wildcards `*.<key>` + dos niveles `*.headers.authorization`. Defense-in-depth correcto. Una mejora futura sería ampliar a wildcards de tres niveles si surgen request envelopes más anidados, pero la cobertura actual es adecuada.

---

## Conclusión

La capa `shared/infrastructure/` aprueba SOLID y type-safety estrictos. Cero `any`, cero `ts-ignore`, tsc + ESLint en verde, todos los adapters respetan SRP/OCP/LSP/ISP/DIP, errores tipados con `code` discriminador, JSDoc completo. La decisión de signatura async para `SqliteDatabase.open` está justificada y documentada. **APROBADO** para avanzar a la siguiente fase.
