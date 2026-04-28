# clean-architecture-validator — phase-2-task-3 (shared/application/ports)

- Validador: `clean-architecture-validator`
- Fase: `phase-2-task-3` (Tarea 2.3 — `shared/application/ports/`)
- Fecha: 2026-04-27
- Veredicto: **APROBADO**

## Alcance

Primera ejecución del validador en el repo. Audita exclusivamente
`code/src/shared/application/ports/` (6 archivos creados por
`infrastructure-engineer`). Las violaciones de Fase 1 quedan fuera de
alcance porque la triada `domain + application + infrastructure` aún no
existe en cada módulo (Fase 3 abre la auditoría completa). Se ratifican
las cinco decisiones explícitamente sometidas a esta revisión.

## Tabla de checks

| # | Check | Resultado | Evidencia |
|---|-------|-----------|-----------|
| 1 | Puertos solo importan de `shared/domain/`. Cero imports de `shared/infrastructure/`, `modules/*`, ni librerías externas. | OK | `grep -rE "from ['\"][^.]" shared/application/ports/` → vacío. Solo dos imports en todo el directorio: `clock.port.ts:1 → ../../domain/value-objects/timestamp.ts` y `id-generator.port.ts:1 → ../../domain/value-objects/id.ts`. Ninguno menciona `pino`, `better-sqlite3-multiple-ciphers`, `fastembed`, `uuid`, ni rutas `modules/*`. |
| 2 | `shared/application/index.ts` (barril) re-exporta solo desde `shared/application/ports/`. Cero leakage. | OK | El barril vive en `shared/application/ports/index.ts` (no hay `shared/application/index.ts`, lo cual es aceptable porque la única superficie pública de `shared/application/` por ahora son los puertos). Las cinco re-exportaciones (`./database-connection.port.ts`, `./logger.port.ts`, `./clock.port.ts`, `./id-generator.port.ts`, `./embedder.port.ts`) son todas locales al directorio. |
| 3 | Puertos son interfaces puras, sin clases concretas, sin lógica ejecutable. | OK | `grep -En "class \|function \|const \|let \|var \|new "` sobre los seis archivos → vacío. Todos los archivos contienen únicamente JSDoc + `export interface` / `export type`. `RunResult` y `RawEmbedding` son tipos `interface` con propiedades `readonly`; `LogPayload` es `type` puro; los demás son `interface`. |
| 4 | Nombres de puertos no mencionan tecnologías concretas. | OK | `DatabaseConnection`, `PreparedStatement`, `RunResult`, `Logger`, `LogPayload`, `Clock`, `IdGenerator`, `Embedder`, `RawEmbedding`. Ninguno contiene `Sqlite`, `Pino`, `Fastembed`, `Voyage`, `Uuid`, etc. |
| 5 | Las firmas no exponen tipos de librerías externas. | OK | Las firmas usan tipos nativos (`string`, `number`, `bigint`, `unknown`, `Promise<...>`, `IterableIterator<unknown>`, `Float32Array` — built-in de JS, no de una lib), VOs locales (`Timestamp`, `Id<TBrand>`), y los tipos definidos en el propio puerto (`PreparedStatement`, `RunResult`, `RawEmbedding`, `LogPayload`). Cero `Pino.Logger`, cero `Database` de better-sqlite3, cero importaciones de tipos de `@types/*`. |
| 6 | `shared/application/` no importa de `modules/*/`. | OK | `grep -rEn "modules/" shared/` → solo aparece dentro de comentarios JSDoc explicativos en `embedder.port.ts:17` e `index.ts:33,36,38`. Ningún `import` ataca `modules/*`. |
| 7 | Decisión 1 (TransactionManager omitido). | RATIFICADA | Ver detalle abajo. |
| 8 | Decisión 2 (Kdf diferido a `modules/encryption/application/ports/`). | RATIFICADA | Ver detalle abajo. |
| 9 | Decisión 3 (Embedder neutralizado: `Float32Array` + `dimension`). | RATIFICADA | Ver detalle abajo. |
| 10 | Decisión 4 (sufijo `.port.ts`). | RATIFICADA con observación menor | Ver detalle abajo. |
| 11 | Decisión 5 (`unknown` en lugar de genéricos en `PreparedStatement`). | RATIFICADA | Ver detalle abajo. |
| 12 | `npm run typecheck` EXIT=0. | OK | Salida limpia, sin errores. |
| 13 | `npm run validate:modules` EXIT=0. | OK | `Result: PASS — no module violations.` (cli, curator, encryption, mcp-server, memory, retrieval, secrets, workspace todos OK; cross-imports autorizados de retrieval×22 y curator×3 hacia memory permanecen dentro de ADR-001 §1.5.1). |

## Detalle de las decisiones

### Decisión 1 — TransactionManager omitido — RATIFICADA

`DatabaseConnection.transaction(fn)` cubre todas las necesidades de
Fase 1. Justificaciones cruzadas:

- **Búsqueda exhaustiva en módulos:** `grep -rln "transaction"` sobre
  `src/modules/` devuelve una sola coincidencia, en
  `cli/domain/repositories/command-history-repository.ts:24`, y es una
  nota JSDoc ("la implementación debe ser transaccional"); no requiere
  savepoints ni anidamiento.
- **Búsqueda de abstracciones cross-cutting:** `grep -rn
  "TransactionManager\|UnitOfWork"` sobre todo `src/` → vacío. Nadie
  modela una unidad de trabajo separada.
- **Servicios de dominio revisados** (18 servicios en
  `modules/*/domain/services/`): ninguno expresa anidamiento
  transaccional ni retry-on-conflict.
- **Coherencia con ISP:** un puerto adicional que solo reenvíe a
  `DatabaseConnection.transaction` añadiría superficie sin contrato
  nuevo (anti-patrón puerto-fachada). YAGNI confirmado.

**Reabrir** la decisión cuando aparezcan: savepoints anidados, retry
automático, o transacciones distribuidas. Nada en Fase 1–2 lo justifica.

### Decisión 2 — Kdf diferido a `modules/encryption/application/ports/` — RATIFICADA

Verificación de hechos:

- `modules/encryption/domain/value-objects/` contiene `passphrase.ts`,
  `kdf-params.ts`, `derived-key.ts`, `kdf-algorithm.ts`, `kdf-spec.ts`,
  `salt-bytes.ts`, `master-key.ts`, etc. (12 VOs). NINGUNO está en
  `shared/domain/value-objects/` (`grep` listado: `confidence.ts`,
  `id.ts`, `non-empty-string.ts`, `tags.ts`, `timestamp.ts`,
  `tokens.ts`, `workspace-id.ts`).
- Si el Kdf viviera en `shared/application/ports/` necesitaría importar
  los VOs de encryption desde `shared/`, invirtiendo la dirección de
  dependencias permitida por §1.5 Regla 2 (módulos importan de
  `shared/`, no al revés).
- La alternativa "mover los VOs a shared" sería peor: rompe el bounded
  context de `encryption` (KDF, master key, sal son puro vocabulario de
  ese contexto, no son transversales — solo `encryption` los manipula).
- La nota en `shared/application/ports/index.ts:31-40` documenta el
  diferimiento y referencia el deliverable de Fase 3.

Decisión **arquitectónicamente correcta**. La regla aplicada es
DDD-bounded-context + Clean-Dependency-Inversion, no YAGNI.

### Decisión 3 — Embedder neutralizado a `Float32Array` + `dimension` — RATIFICADA

Verificación:

- `modules/retrieval/domain/value-objects/embedding-vector.ts` existe y
  es propiedad del módulo retrieval (cross-imports `retrieval → memory`
  están autorizados por ADR-001, pero `shared → retrieval` NO lo está y
  romperia la dirección de dependencias).
- Hay un puerto paralelo `modules/retrieval/domain/services/embedder.ts`
  que sí devuelve `EmbeddingVector` y es el que consumen los casos de
  uso de retrieval.
- El JSDoc del puerto compartido (`embedder.port.ts:14-31`) explica el
  patrón de "dos nombres, un adaptador" y referencia §2 de
  `docs/12-lineamientos-arquitectura.md`.
- `Float32Array` es un built-in de ECMAScript, NO de una lib externa.
  No introduce dependencia de `fastembed` ni de `voyage`.
- `RawEmbedding` empaqueta `vector + dimension` para cerrar la
  ambigüedad de "longitud del buffer ≠ dimensión real" (importante
  cuando el adaptador usa cuantización o truncado).

La abstracción mantiene `shared/application/` desacoplado de
`retrieval/domain/` en ambos sentidos. La dimension neutralisation está
**correctamente resuelta**.

### Decisión 4 — Sufijo `.port.ts` — RATIFICADA con observación menor

Análisis:

- `docs/12 §3.1` enumera sufijos para archivos pero NO incluye un
  sufijo explícito para puertos (lista: `<name>.repository.ts` para
  interfaces, `<name>-repository.ts` para adaptadores,
  `<name>.use-case.ts`, `<name>.dto.ts`, `<name>.spec.ts`, etc.).
- `docs/12 §3.2` dice: "Sufijo `Port` para puertos cuando ambiguo
  (`EmbedderPort`)" — y se refiere a identificadores TypeScript, no a
  archivos. La ambigüedad se da entre `Embedder` (puerto) y un
  `Embedder` (adaptador) con el mismo nombre; aquí los nombres internos
  de las interfaces (`Embedder`, `Logger`, `Clock`, ...) NO usan
  `Port`, lo cual es coherente.
- La estructura de referencia en `docs/12 §2` (líneas 333-339) muestra
  los archivos como `database.ts`, `logger.ts`, `embedder.ts`, etc.
  (sin sufijo). La implementación entregada usa
  `database-connection.port.ts`, `logger.port.ts`, etc.

**Observación.** El sufijo `.port.ts` es una desviación del ejemplo
ilustrativo de §2, pero NO viola §3.1 (que no normativiza este caso).
Se ratifica porque:

1. El sufijo es **más explícito** que el ejemplo del doc
   (`logger.ts` vs `logger.port.ts`); reduce el riesgo de colisión con
   `logger.ts` que pudiera aparecer en `infrastructure/logger/` para
   barriles internos.
2. La convención está **declarada en el JSDoc del barril**
   (`shared/application/ports/index.ts:5-30`), no es implícita.
3. Es **internamente consistente** dentro del directorio (5/5 archivos
   la siguen).
4. Los archivos están en una carpeta llamada `ports/`, así que el
   sufijo es redundante con la ruta — pero esa redundancia es
   informativa para herramientas (grep, IDE jump-to-symbol).

**Acción requerida si se quiere alineación estricta:** decidir en el
ADR de Fase 2 (o crear uno nuevo) si:

- (A) Se ratifica `.port.ts` como convención del proyecto y se
  actualiza `docs/12 §2` y `§3.1` para reflejarlo. Los puertos internos
  de cada módulo (Fase 3+) deberán seguir la misma convención
  (`<name>.port.ts` en `application/ports/in/` y `out/`).
- (B) Se renombra a `database.ts`, `logger.ts`, etc. para alinear con
  el ejemplo del doc.

Para esta validación se acepta la decisión vigente (A) — la convención
es interna, declarada y consistente — pero se **recomienda** abrir
issue/ADR para que Fase 3 (puertos por módulo) y Fase 5 (architect
review) adopten la misma regla por escrito.

### Decisión 5 — `unknown` en lugar de genéricos en `PreparedStatement` — RATIFICADA

Coherente con `docs/12 §1.6`:

> "Cualquier valor desconocido entra como `unknown` y se valida con
> Zod antes de usarse."

Razones técnicas adicionales (correctamente documentadas en
`database-connection.port.ts:88-96`):

- SQLite no tipa columnas a nivel del driver; un genérico
  `get<T>(): T` colapsa en un cast (`as T`) en alguna parte y
  desactiva la validación.
- `unknown` fuerza al consumidor a parsear con Zod (o equivalente)
  antes de tocar el campo. Esto se alinea con la regla "cero `any`" y
  con OWASP A03 (Injection / Validation).
- La firma elegida (`unknown` para `get`, `readonly unknown[]` para
  `all`, `IterableIterator<unknown>` para `iterate`) es defensiva por
  defecto; es imposible "olvidarse" de validar sin que TS lo grite.

Decisión **alineada con el doc** y con buenas prácticas de runtime
validation.

## Resumen ejecutivo

- 13/13 checks OK.
- 5/5 decisiones ratificadas (Decisión 4 con observación menor sobre
  la conveniencia de formalizar la convención `.port.ts` en el doc).
- Cero violaciones de Clean Architecture.
- Cero violaciones de Hexagonal (ports & adapters).
- Cero violaciones de modularidad (§1.5).
- Domain layer pureza preservada en `shared/`.
- `npm run typecheck` y `npm run validate:modules` ambos en verde.

`shared/application/ports/` queda APROBADO para que la Fase 2 continúe
con las tareas 2.4 (`shared/infrastructure/`) y siguientes.

## Recomendaciones (no bloqueantes)

1. **Formalizar `.port.ts`**: actualizar `docs/12 §3.1` agregando el
   sufijo `<name>.port.ts` para puertos en
   `application/ports/{in,out}/` y en `shared/application/ports/`. La
   estructura de referencia de §2 también debería reflejarlo. Esto
   evita debates en revisores futuros y unifica el patrón cuando los
   módulos creen sus puertos en Fase 3.
2. **Cuando Fase 3 cree el puerto Kdf** en
   `modules/encryption/application/ports/`, replicar la misma
   convención (sufijo, estructura JSDoc, mención explícita del adapter
   esperado en `infrastructure/`).
3. **El barril `shared/application/ports/index.ts` es type-only**
   (`export type {...}`); validar en Fase 2.4 que los adaptadores
   concretos implementen `implements Logger` (etc.) para que el cambio
   de un nombre de puerto rompa la compilación de inmediato. (Esto se
   verifica naturalmente con `tsc`.)
