# SOLID + Type-Safety Re-validación — Fase 2 Tarea 2.5: `embedding-vector.ts` (post-refactor estructural)

**Validator:** solid-validator
**Date:** 2026-04-27
**Scope:** `code/src/modules/retrieval/domain/value-objects/embedding-vector.ts`
**Baseline:** `phase-1-task-8-solid-validator.md` (Fase 1 Tarea 8 — APROBADO)
**Veredicto:** **APROBADO**

---

## Contexto

En Fase 1 Tarea 8 el archivo `embedding-vector.ts` fue **APROBADO** por
este validador con type-safety total (cero `any`, defensive copy,
invariantes custodiadas).

Durante Fase 2 Tarea 2.5 (lint cleanup) `infrastructure-engineer`
reportó 2 errores `no-unsafe-assignment` causados por el ensanchamiento
de `Array.isArray(x)` a `x is any[]` (lib.es5 typings) cuando el input
es `readonly number[]`. El refactor estructural partió el guard
unificado en dos ramas independientes, una por representación
concreta:

```ts
// Antes (un solo bloque):
if (!(components instanceof Float32Array) && !Array.isArray(components)) {
  throw ...;
}
const length = components.length;
for (let i = 0; i < length; i += 1) {
  const raw = components[i];   // <-- aquí el lint detectaba `any` por
                               //     el predicado de `Array.isArray`
  ...
}

// Ahora (dos guards + cast estrecho a `readonly number[]`):
if (components instanceof Float32Array) {
  // rama tipada como Float32Array; índice → number
  ...
}
if (!Array.isArray(components)) {
  throw new InvalidInputError("...");
}
const arr = components as readonly number[];
// rama tipada como readonly number[]; índice → number | undefined
...
```

---

## Tabla de checks 1-7

| # | Check | Resultado | Evidencia |
|---|-------|:--------:|---|
| 1 | Cero `any` / `as any` / `// @ts-ignore` / `// @ts-nocheck` / `// @ts-expect-error` / `eslint-disable` | **PASS** | `grep -nE ": any\|as any\|<any>\|Array<any>\|Promise<any>\|@ts-ignore\|@ts-nocheck\|@ts-expect-error\|eslint-disable" embedding-vector.ts` → exit=1 (cero matches). El único `any` textual está en otros archivos del módulo (revisado en baseline) — en este archivo concreto: cero. |
| 2 | `tsc --noEmit` exit 0 | **PASS** | `cd code && npm run typecheck` → `tsc --noEmit` → **EXIT_TYPECHECK=0**. Cero errores en TODO el proyecto. |
| 3 | ESLint exit 0 sobre el archivo | **PASS** | `cd code && npx eslint src/modules/retrieval/domain/value-objects/embedding-vector.ts` → **EXIT_ESLINT=0**. Sin warnings. La config `eslint.config.js` aplica `strictTypeChecked` + `stylisticTypeChecked` + reglas custom (`no-explicit-any: error`, `no-unsafe-{assignment,call,member-access,return,argument}: error`, `explicit-function-return-type: error`, `consistent-type-imports`, `ban-ts-comment`, `no-non-null-assertion`, `no-unnecessary-type-assertion`, `no-unnecessary-condition`, `restrict-template-expressions`, `strict-boolean-expressions`). El cast `as readonly number[]` NO es flagged como `no-unnecessary-type-assertion`, lo que confirma que es **load-bearing** (necesario para evitar el ensanchamiento `any[]` heredado del predicado de `Array.isArray`). |
| 4 | API pública intacta vs baseline | **PASS** | Comparación con baseline §"Aspectos específicos del scope (Tarea 8)": <br/>• Constructor `private` ✓ (línea 45). <br/>• Factory `EmbeddingVector.create(components: Float32Array \| readonly number[]): EmbeddingVector` ✓ (líneas 57-114). <br/>• `dim(): number` ✓ (líneas 120-122). <br/>• `cosineDistance(other: EmbeddingVector): number` ✓ (líneas 134-156). <br/>• `cosineSimilarityTo(other: EmbeddingVector): CosineScore` ✓ (líneas 163-165). <br/>• `withVector<T>(callback: (buffer: Float32Array) => T): T` ✓ (líneas 180-182). <br/>• `toFloat32Array(): Float32Array` ✓ (líneas 190-194). <br/>• `equals(other: EmbeddingVector): boolean` ✓ (líneas 196-203). <br/>**Cero firmas alteradas. Cero parámetros agregados. Cero retornos cambiados. Cero métodos eliminados/renombrados/agregados.** Errores lanzados idénticos: `InvalidInputError` con mismo `field` y mismo mensaje en ambas ramas, `EmbeddingDimensionMismatchError` igual. |
| 5 | El `as readonly number[]` es seguro y la indexación posterior valida `=== undefined` | **PASS** | El cast en línea 94 ocurre **DESPUÉS** del guard `if (!Array.isArray(components)) throw ...` (líneas 88-93). Por type-narrowing, en el punto del cast TypeScript ya conoce que `components` NO es `Float32Array` (rama anterior consumida) Y ES un array (Array.isArray pasó). Sin el cast, TypeScript ensancha el tipo a `any[]` por el predicado `x is any[]` de lib.es5; el cast lo **estrecha** de vuelta al tipo paramétrico original `readonly number[]` (re-aplicando la información que ya estaba en la signature del parámetro). Es type-narrowing manual idéntico en patrón al `as IdValue<TBrand>` que ya validamos en Tarea 1. <br/><br/>Bajo `noUncheckedIndexedAccess`, `arr[i]` se infiere como `number \| undefined`, y el código valida explícitamente: `if (raw === undefined \|\| !Number.isFinite(raw)) throw ...` (líneas 105-110). Idéntico al patrón usado en la rama Float32Array (líneas 78-83). El asignment `buffer[i] = raw` solo se ejecuta cuando `raw` ha sido refinado a `number` finito. |
| 6 | Cero cambios semánticos | **PASS** | Validaciones replicadas idénticas en ambas ramas: <br/>• `length === 0` → `InvalidInputError("embedding vector must contain at least one component", { field: "embedding" })` — líneas 69-74 (Float32Array) y 96-101 (array). <br/>• Iteración: `for (let i = 0; i < length; i += 1)` — idéntico bucle. <br/>• Validación per-componente: `if (raw === undefined \|\| !Number.isFinite(raw))` con `InvalidInputError("embedding vector component at index ${i} must be a finite number", { field: "embedding[${i}]" })` — líneas 78-83 (Float32Array) y 105-110 (array), mismo mensaje y mismo field path. <br/>• Defensive copy: `const buffer = new Float32Array(length); buffer[i] = raw;` — idéntico en ambas ramas. <br/>• Retorno: `return new EmbeddingVector(buffer)` — idéntico en ambas ramas. <br/>• Caso input inválido (no Float32Array y no array): `InvalidInputError("embedding vector must be a Float32Array or a number[]", { field: "embedding" })` — líneas 89-92, mensaje **equivalente** al del baseline ("debe ser Float32Array o number[]"). <br/><br/>El refactor es puramente estructural; **cero cambios de comportamiento observable** desde el contrato público. Tests existentes (cuando se materialicen en Fase 5/QA) seguirán pasando sin modificación: rechazo de `Float32Array(0)`, array vacío, `[NaN]`, `[Infinity]`, aceptación de inputs válidos, copia defensiva, etc. |
| 7 | JSDoc del archivo y de la factory presentes y describen el comportamiento | **PASS** | • **JSDoc del archivo (líneas 5-41)** — íntegro vs baseline: explica el "Why `Float32Array`" (precisión, copy avoidance), "Immutability" (defensive copy en `create`, contrato read-only de `withVector`), "Invariants" (`dim() > 0`, componentes finitas, mismatch dim → `EmbeddingDimensionMismatchError`), "Equality" (componente-wise exacta vs `cosineDistance` para fuzzy). <br/>• **JSDoc de la factory `create` (líneas 49-56)** — íntegro: "Builds an EmbeddingVector from a numeric source. Always copies the input into a fresh Float32Array..." + indicación de los 2 inputs aceptados (Float32Array típico de sqlite-vec, readonly number[] típico de JSON). <br/>• **Comentario adicional in-código (líneas 60-66)** — **NUEVO y correcto**: documenta explícitamente la razón del split per-rama, citando el problema lib.es5 (`Array.isArray` widens `readonly number[]` a `any[]`) y el beneficio (linter ve `number \| undefined` en array branch y `number` en typed-array branch). Excelente trazabilidad técnica para futuros mantenedores. <br/>• Resto de JSDoc (`dim`, `cosineDistance`, `cosineSimilarityTo`, `withVector`, `toFloat32Array`, `equals`) — sin cambios respecto al baseline. |

---

## Diff conceptual antes/después (resumido)

**Antes (Tarea 8 — baseline):** un único guard binario `if (!(x instanceof Float32Array) && !Array.isArray(x))` que rechazaba inputs no-soportados, seguido de un único loop de validación por componente que indexaba `components[i]` (cuyo tipo TS terminaba siendo `any` por el ensanchamiento de `Array.isArray`).

**Después (Tarea 2.5 — refactor):** dos guards mutuamente exclusivos:

1. `if (components instanceof Float32Array)` — rama estrictamente tipada (`components: Float32Array`, `components[i]: number`); valida length>0, itera, valida cada componente vs `undefined`/`!Number.isFinite`, copia, retorna.
2. `if (!Array.isArray(components)) throw ...` — guard negativo que rechaza el caso "ni Float32Array ni array".
3. `const arr = components as readonly number[]` — re-estrechamiento manual al tipo paramétrico original (anula el ensanchamiento de lib.es5 a `any[]`); itera idéntico, valida idéntico, copia idéntico, retorna idéntico.

**Costo:** ~30 líneas duplicadas (length check + loop + validación + copy) entre ambas ramas. **Beneficio:** cero `no-unsafe-*` warnings, type-narrowing explícito y documentado, intent comunicado en JSDoc adicional.

**Trade-off justificado:** la duplicación es trivial (idéntica estructura, fácil de mantener en sync) y la alternativa hubiera sido (a) dejar el `any` widening con `eslint-disable-next-line` — viola §1.6, o (b) introducir un helper privado tipado genéricamente — sobre-engineering para 30 líneas.

---

## EXIT codes

| Comando | EXIT |
|---|:--:|
| `cd code && npm run typecheck` (`tsc --noEmit`) | **0** |
| `cd code && npx eslint src/modules/retrieval/domain/value-objects/embedding-vector.ts` | **0** |
| `grep -nE forbidden patterns sobre el archivo` | **1** (cero matches — esperado) |

---

## Conclusión

El refactor estructural de `embedding-vector.ts` es **APROBADO sin
reservas**. Resuelve los 2 errores reales de `no-unsafe-assignment`
causados por el predicado `x is any[]` de `Array.isArray` en lib.es5,
preservando:

- **API pública 100% intacta** (8 métodos públicos: 1 factory + 6
  instance methods + 1 constructor privado).
- **Comportamiento semántico idéntico** (mismas validaciones, mismos
  errores, mismos mensajes, mismos field paths).
- **Type-safety total (§1.6)** — cero `any`, cero `as any`, cero
  `// @ts-*`, cero `eslint-disable`. El único cast (`as readonly
  number[]`) es load-bearing, documentado y técnicamente
  irreemplazable sin ceder type-safety.
- **SOLID (§1.4)** — SRP intacto (single responsibility:
  "Float32 vector con cosine y defensive copy"); OCP intacto
  (la duplicación de la rama por representación concreta NO
  introduce dispatch dinámico, sólo type-narrowing); LSP/ISP/DIP
  no afectados.
- **JSDoc** del archivo y de la factory **íntegros**; comentario
  adicional explicando el split per-rama mejora la trazabilidad
  técnica.

**Cero cambios requeridos.** El archivo sigue cumpliendo §1.4 (SOLID),
§1.6 (type-safety total) y §1.5 (modularidad — sin imports nuevos
respecto al baseline) como en Tarea 8.

---

## Próximo paso recomendado

Continuar con la auditoría de los siguientes archivos del lint cleanup
de Tarea 2.5. Si todos los refactors siguen este mismo patrón
(duplicación per-rama justificada por type-narrowing manual sobre
predicados de lib.es5), todos serán APROBABLES. Cualquier desviación
hacia `eslint-disable`, `as unknown`, `as any` o `@ts-expect-error`
sin justificación adyacente debe rechazarse de inmediato.
