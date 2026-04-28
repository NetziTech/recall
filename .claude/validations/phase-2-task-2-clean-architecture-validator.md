# Validación Clean Architecture / Hexagonal — Tarea 2.2 (shared/infrastructure)

- **Validador:** clean-architecture-validator
- **Fase:** phase-2-task-2 (shared/infrastructure adapters)
- **Fecha:** 2026-04-27
- **Veredicto:** **APROBADO**

---

## 1. Resumen ejecutivo

Auditados 12 archivos `.ts` + 1 `.sql` en `code/src/shared/infrastructure/`
y `code/migrations/`. La entrega cumple los lineamientos §1.1, §1.3 y §1.5
del documento de arquitectura. Cero violaciones de dirección de
dependencias, cero cross-imports a `modules/*`, todos los adapters
implementan explícitamente sus puertos, los nombres concretos respetan la
convención hexagonal, y `validate:modules` + `tsc --noEmit` salen ambos
con código 0.

Las cinco decisiones tomadas por el `infrastructure-engineer` se
**RATIFICAN** en su totalidad: están consistentes con (a) la decisión
previa aprobada en Tarea 2.1 sobre el puerto KDF, (b) el reporte de
Tarea 2.3 sobre `TransactionManager`, y (c) los lineamientos §1.5 sobre
modularidad.

---

## 2. Tabla de checks (1-14)

| # | Check | Resultado | Detalle |
|---|---|---|---|
| 1 | Imports de `shared/infrastructure/` solo desde `shared/domain/`, `shared/application/ports/`, libs externas, `node:*` | PASA | `grep -rn "from ['\"]" src/shared/infrastructure/ \| grep "modules/"` → 0 resultados. Todas las libs externas son las whitelisted (`better-sqlite3-multiple-ciphers`, `sqlite-vec`, `pino`, `fastembed`, `uuid`, `node:fs`, `node:path`). |
| 2 | Cada adapter declara `implements PortName` explícitamente | PASA | 8 adapters concretos detectados con `implements`: `SqliteDatabase implements DatabaseConnection`, `SqliteStatement implements PreparedStatement`, `MigrationsRunner` (no implementa puerto, es runner — válido), `PinoLogger implements Logger`, `FastembedEmbedder implements Embedder`, `SystemClock implements Clock`, `FakeClock implements Clock`, `UuidV7IdGenerator implements IdGenerator`, `FakeIdGenerator implements IdGenerator`. |
| 3 | Interfaz local `EncryptionKeyBytes` minimalista | PASA | `sqlite-database.ts:34-36`: `export interface EncryptionKeyBytes { readonly bytes: Uint8Array; }`. Solo el campo `bytes`. NO filtra `constant-time-equals`, `secure-zero` ni ningún otro detalle de `encryption/domain/value-objects/derived-key.ts`. JSDoc (`:13-33`) documenta explícitamente la razón del aislamiento. |
| 4 | Convención de nombres hexagonal | PASA | `Sqlite*`, `Pino*`, `Fastembed*`, `UuidV7*`, `System*`, `Fake*` aplicados de forma consistente. Sin nombres genéricos tipo `DefaultLogger` o `MyDatabase`. |
| 5 | Sin re-export de tipos de libs externas en el barrel | PASA con observación | `index.ts` no re-exporta valores de las libs (sin `export ... from "better-sqlite3"`, etc.). **Observación**: re-exporta `FastembedModelName` que es un `Exclude<EmbeddingModel, EmbeddingModel.CUSTOM>` y por tanto transitivamente acopla consumidores al enum `EmbeddingModel` de fastembed. No constituye violación dura (no es `export ... from "fastembed"`), pero conviene **considerar** convertirlo a string-literal union (`"BGESmallENV15" \| "BGEBaseENV15" \| ...`) en una iteración posterior para que la abstracción del SDK sea total. No bloquea la aprobación. |
| 6 | Sin cross-imports en `shared/infrastructure/` (validate-modules.ts) | PASA | `npm run validate:modules` → `Result: PASS — no module violations.` |
| 7 | Barrel `index.ts` exporta solo clases concretas + tipos públicos propios | PASA | Re-exporta `SqliteDatabase`, `MigrationsRunner`, `PinoLogger`, `FastembedEmbedder`, `SystemClock`, `FakeClock`, `UuidV7IdGenerator`, `FakeIdGenerator`, `InfrastructureError`, `DatabaseError`, `EmbedderError` (clases) y los tipos `*Options`, `*Result`, `*ErrorCode`, `EncryptionKeyBytes`, `DEFAULT_REDACT_PATHS`. No expone `BetterSqlite3Database`, `BetterSqlite3Statement`, `FlagEmbedding`, ni `PinoBaseLogger` (todos privados al archivo del adapter). |
| 8 | Decisión 1 — Argon2idKdf diferido a `modules/encryption/infrastructure/` | RATIFICADA | Ver sección 3. |
| 9 | Decisión 2 — `EncryptionKeyBytes` interfaz local | RATIFICADA | Ver sección 3. |
| 10 | Decisión 3 — Sin `transaction-manager.ts` separado | RATIFICADA | Ver sección 3. |
| 11 | Decisión 4 — Test doubles co-localizados con adapters reales | RATIFICADA | Ver sección 3. |
| 12 | Decisión 5 — Pragmas SQLCipher inline (`applyEncryptionKey` privado) | RATIFICADA | Ver sección 3. |
| 13 | `npm run typecheck` (tsc --noEmit) | PASA | EXIT=0, sin output. |
| 14 | `npm run validate:modules` | PASA | EXIT=0. Output: `cli, curator (memory×3), encryption, mcp-server, memory, retrieval (memory×22), secrets, workspace` todos `[OK]`. `shared/infrastructure/` sin cross-imports detectados. |

---

## 3. Decisiones a ratificar (8-12)

### Decisión 1 — `Argon2idKdf` diferido a `modules/encryption/infrastructure/` (Opción A)

**Veredicto:** RATIFICADA.

**Argumento:**

1. **Verificación de prerequisitos.** Los VOs `Passphrase`, `KdfParams`,
   `DerivedKey` existen efectivamente en
   `code/src/modules/encryption/domain/value-objects/` (12 VOs auditados,
   más el aggregate `encryption-config.ts` y el servicio
   `services/key-derivation.ts`). Todos están en el módulo `encryption`,
   ninguno en `shared/domain/`.
2. **Análisis hexagonal.** Un adapter `Argon2idKdf` que cumpla el
   contrato del KDF service de `encryption/domain/services/key-derivation.ts`
   necesita aceptar `Passphrase`/`KdfParams` y devolver `DerivedKey`.
   Colocarlo en `shared/infrastructure/` lo obligaría a importar de
   `modules/encryption/domain/`, **invirtiendo** la dirección de
   dependencias permitida por §1.5 Regla 2 (shared NO puede depender de
   modules; ADR-001 carve-out es solo para `retrieval`/`curator` →
   `memory`).
3. **Coherencia con Tarea 2.1.** El barrel
   `shared/application/ports/index.ts:31-40` ya documenta la decisión
   simétrica: el puerto `kdf` no vive en `shared/application/ports/` por
   la misma razón. Mover el adapter a shared sin mover su puerto a shared
   sería incoherente.
4. **Alternativas evaluadas.**
   - *Mover Passphrase/KdfParams/DerivedKey a `shared/domain/`*: `kdf-params`,
     `passphrase`, `derived-key` son **vocabulario exclusivo del bounded
     context de `encryption`**. Ningún otro módulo los manipula. Promoverlos
     a `shared/domain/` violaría el principio DDD de no inflar el lenguaje
     ubicuo común con conceptos de un solo contexto.
   - *Definir un puerto KDF "raw" `(Uint8Array, params) → Uint8Array`*:
     pierde toda la garantía type-level que aporta `DerivedKey` (clase con
     `constantTimeEquals`, `secureZero`). Anti-patrón: el adapter
     "genérico" no aportaría valor frente a importar `@noble/hashes`
     directamente desde `encryption/infrastructure/`.

   La Opción A elegida es la única consistente con §1.5 + ADR-001 +
   YAGNI.

5. **Discrepancia con docs/12 §2 (lista de adapters comunes).** El
   documento lista `Argon2idKDF` entre los adapters de
   `shared/infrastructure/`. Esto refleja la **intención inicial**
   pre-modelado del bounded context de encryption. Una vez Tarea 1.4
   modeló los VOs en `encryption/domain/`, la lista del doc quedó
   desactualizada. El ajuste de plan (Opción A) es una **corrección
   coherente del modelo**, no una desviación arbitraria. Recomiendo que
   el architect-coordinador actualice el doc en una iteración menor para
   reflejar la ubicación final.

### Decisión 2 — `EncryptionKeyBytes` interfaz local en `sqlite-database.ts`

**Veredicto:** RATIFICADA.

**Argumento:**

Las cuatro alternativas posibles, evaluadas:

| Alternativa | Veredicto | Razón |
|---|---|---|
| Importar `DerivedKey` directo desde `encryption/domain` | RECHAZADA | Invierte dirección §1.5 Regla 2 (shared → modules). |
| Aceptar `Uint8Array` crudo en la firma | RECHAZADA | Pierde el "shape contract" — un caller podría pasar un buffer no preparado por la KDF. La envoltura `{ bytes }` documenta semánticamente "esto es una clave derivada, no un buffer cualquiera". |
| Aceptar `Buffer` de Node | RECHAZADA | Acopla a la API de Node `Buffer` (`Uint8Array` es estándar Web/Node). |
| Interfaz local `{ readonly bytes: Uint8Array }` | **ELEGIDA** | Define un puerto entrante minimalista que `DerivedKey.bytes` puede satisfacer estructuralmente sin importar la clase concreta. Cumple ISP, DIP y §1.5 simultáneamente. |

La interfaz no filtra detalles de seguridad (constant-time-equals,
secure-zero) — esos métodos viven en `DerivedKey` y son responsabilidad
del módulo encryption garantizar que se usen antes y después de pasar
los bytes al adapter SQLite. El JSDoc del adapter documenta los
invariantes que el caller debe preservar (`docs/sqlite-database.ts:27-33`).

### Decisión 3 — Sin `transaction-manager.ts` separado

**Veredicto:** RATIFICADA.

**Argumento:**

1. **Coherencia con Tarea 2.3.** El reporte
   `phase-2-task-3-clean-architecture-validator.md` ya ratificó esta
   misma decisión en el lado del puerto: `DatabaseConnection.transaction(fn)`
   cubre todas las necesidades de Fase 1, y un puerto/clase separado
   sería un anti-patrón puerto-fachada.
2. **YAGNI confirmado.** `grep -rln "transaction"` en `src/modules/`
   devuelve solo notas JSDoc; ningún use case actual requiere savepoints
   anidados, retry-on-conflict, ni distributed transactions.
3. **El método `transaction(fn)` cumple SRP.** SqliteDatabase tiene una
   sola razón para cambiar (cómo hablamos con SQLite); separar la
   transaccionalidad en otra clase no aporta nuevos contratos.

Reabrir cuando aparezca al menos uno de: savepoints anidados, retry
automático en SQLITE_BUSY, transacciones distribuidas, o cuando una
implementación libsql/turso requiera una API diferente.

### Decisión 4 — `FakeClock` y `FakeIdGenerator` en `shared/infrastructure/`

**Veredicto:** RATIFICADA.

**Argumento:**

Las tres opciones canonicas:

| Opción | Análisis |
|---|---|
| (a) `tests/fixtures/` | Los `tests/fixtures/` están reservados (docs/12 §4) para **factorías de agregados válidos** (data builders), no para adapters que implementan puertos. Mezclar test doubles de adapters con builders de agregados es categóricamente confuso. |
| (b) Co-localizado con el adapter real | **ELEGIDA**. Es el patrón canónico de Hexagonal: real e in-memory/fake conviven bajo `infrastructure/` porque ambos satisfacen el mismo puerto. La doc de `docs/12 §2` literalmente dice: "Repositorios concretos y test doubles viven en `infrastructure/persistence/`". El argumento se generaliza a clock e id-generator. |
| (c) `shared/testing/` | Crearía un cuarto sub-tier no documentado en §1.5 ni §2. Más complejidad sin beneficio. |

**Riesgo de wiring accidental** (que un Fake llegue a producción):

- El `validate-modules.ts` actual NO bloquea esto, pero la cadena
  composition-root está controlada: `composition/*.ts` es el único
  punto que instancia adapters en producción, y los nombres `Fake*`
  son inmediatamente visibles en code review.
- El barrel `index.ts:6-10` documenta explícitamente que los Fake* se
  exportan **solo** para el test composition root y referencia los
  controles complementarios (vitest coverage thresholds).
- Recomendación menor (no bloqueante para 2.2): añadir en una iteración
  posterior una regla en `validate-modules.ts` que bloquee imports de
  identificadores con prefijo `Fake*` desde `composition/*.ts`. Esto
  formaliza el invariante.

### Decisión 5 — Pragmas SQLCipher inline (no `sqlcipher-driver.ts` separado)

**Veredicto:** RATIFICADA.

**Argumento:**

1. **Las pragmas viven en un método estático privado**
   (`SqliteDatabase.applyEncryptionKey`, líneas 350-364) con su propia
   responsabilidad y JSDoc. La extracción ya está hecha *dentro de la
   clase*, no es código inline disperso.
2. **No hay segunda implementación que justifique una strategy.**
   Cipher = sqlcipher con KDF SQLCipher v4 default es la única
   configuración soportada. Una clase `SqlcipherDriver` separada sería
   un wrapper sobre dos llamadas `pragma()` — anti-patrón "wrapper
   class".
3. **SRP intacto.** SqliteDatabase tiene una razón para cambiar: cómo
   hablamos con SQLite (incluyendo cómo desbloqueamos SQLCipher).
   Cambiar el formato de la pragma es el mismo eje de cambio que
   actualizar la versión de WAL o la sintaxis de `cache_size`.
4. **Reabrir** cuando aparezca un segundo cipher (e.g. SEE,
   wxSQLite3 con AES-256-GCM-SIV) o cuando la KDF rotation requiera
   pre/post-key pragmas distintos.

---

## 4. Hallazgos menores (no bloqueantes)

Ningún hallazgo bloqueante. Recomendaciones para iteraciones futuras:

1. **`FastembedModelName` re-exportado en barrel.** Considerar
   convertirlo a string-literal union propia para encapsular
   completamente el SDK fastembed. Hoy un consumer del barrel necesita
   importar `EmbeddingModel` desde `fastembed` para construir un valor
   que satisfaga el tipo. No bloqueante porque no se exporta el VALOR
   `EmbeddingModel`, solo el tipo.
2. **`validate-modules.ts` sin regla anti-Fake en composition.** Sugerir
   añadir bloqueo de imports `Fake*` desde `composition/*.ts` para
   formalizar el invariante de "test doubles no llegan a producción"
   ya documentado en JSDoc del barrel.
3. **Doc `12-lineamientos-arquitectura.md` §2** lista `Argon2idKDF` en
   `shared/infrastructure/`. Actualizar para reflejar la ubicación
   final en `modules/encryption/infrastructure/` y referenciar este
   reporte como ratificación de la decisión.

---

## 5. Verificación funcional ejecutada

```text
$ cd code && npm run typecheck
> mcp-memoria@0.1.0-alpha.0 typecheck
> tsc --noEmit
(EXIT=0, sin output)

$ cd code && npm run validate:modules
> mcp-memoria@0.1.0-alpha.0 validate:modules
> tsx scripts/validate-modules.ts

Module import audit
===================
  [OK] cli
  [OK] curator (authorised cross-imports: memory×3)
  [OK] encryption
  [OK] mcp-server
  [OK] memory
  [OK] retrieval (authorised cross-imports: memory×22)
  [OK] secrets
  [OK] workspace

Result: PASS — no module violations.
(EXIT=0)
```

---

## 6. Veredicto final

**APROBADO**

La entrega de Tarea 2.2 es coherente con:
- §1.1 Capas y dirección de dependencias.
- §1.3 Hexagonal (puertos + adapters, nomenclatura, encapsulación de SDKs).
- §1.5 Modularidad estricta + ADR-001.
- Las decisiones simétricas ya aprobadas en Tareas 2.1 y 2.3.

Las cinco decisiones tomadas se ratifican con argumentación. Los tres
hallazgos menores son **recomendaciones para iteraciones futuras**, no
bloqueos.

El equipo puede avanzar a integración (composition root) y testing
(Tarea 2.4 / Fase 3).
