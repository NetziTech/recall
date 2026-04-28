# SOLID + Type-Safety Validation — Phase 2, Task 4: DecayFactor recalibration

**Validator:** solid-validator
**Date:** 2026-04-27
**Scope:** `code/src/modules/curator/domain/value-objects/decay-factor.ts` (single file; recalibration of literal constants — bug B-002)
**Verdict:** APROBADO

---

## 0. Contexto

Tarea 2.4 recalibra las constantes literales del catálogo de decay
(`DEFAULT_DECAY_FACTORS_PER_DAY`, `LEARNING_DECAY_FACTORS_PER_DAY`)
para que cumplan la fórmula `factor_per_day = factor_per_period ^ (1 /
period_days)` documentada en `docs/05-memoria-decay.md` §2 y resolver
B-002 (los valores anteriores eran factores per-period interpretados
incorrectamente como per-day por `DecayCalculator`).

La forma estructural del VO ya fue auditada y APROBADA en Fase 1 (ver
`phase-1-task-9-solid-validator.md`). Esta auditoría re-valida que el
cambio NO introdujo regresiones de type-safety / SOLID.

---

## 1. Resultados de los 9 checks obligatorios

| # | Check | Resultado | Detalle |
|---|---|---|---|
| 1 | Cero `any` (explícito o implícito) | **PASS** | `grep -nE "\bany\b"` sobre el archivo: 0 matches en código y 0 matches en JSDoc. tsc estricto con `noImplicitAny: true` pasa, así que tampoco hay `any` implícito. |
| 2 | Cero `as any` | **PASS** | `grep -nE "as any"`: 0 matches. |
| 3 | Cero `// @ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | **PASS** | `grep -nE "@ts-(ignore\|expect-error\|nocheck)"`: 0 matches. |
| 4 | Cero imports externos (domain puro) | **PASS** | 3 imports, todos internos al codebase: (a) `LearningSeverity` desde `modules/memory/domain/value-objects/learning-severity.ts` — autorizado por orquestador en `tasks.curator-domain.depends_on: ["shared-domain", "memory-domain"]`; (b) `InvalidDecayFactorError` intra-módulo `../errors/`; (c) `MemoryEntryKind` intra-módulo `./`. Cero imports `node:*`, npm packages, `process`, `fs`, etc. |
| 5 | Tipos de retorno explícitos en funciones públicas | **PASS** | Todos los métodos públicos declaran retorno: `of(value: number): DecayFactor` (174), `forKind(kind, severity): DecayFactor` (193-196), `unity(): DecayFactor` (209), `isUnity(): boolean` (218), `toNumber(): number` (222), `equals(other: DecayFactor): boolean` (226). El constructor privado no requiere retorno explícito (TS lo infiere a `DecayFactor`). |
| 6 | `tsc --noEmit` con 17 flags estrictos EXIT=0 | **PASS** | `cd /Users/h2devx/proyects/netzi-tech/mcp/memoria/code && npx tsc --noEmit` → **EXIT=0**. El `tsconfig.json` materializado en Tarea 2.1 incluye los 17 flags exigidos por §1.6 (verificado abajo, §1.6.1). |
| 7 | SRP: el archivo sigue siendo el VO `DecayFactor` y nada más | **PASS** | Sigue exportando UNA sola clase `DecayFactor` (línea 167) más 2 catalogs `const` privados al módulo. Cero lógica de application, cero I/O, cero side effects. La superficie pública (5 métodos estáticos + 4 métodos de instancia, idéntica a la aprobada en Fase 1) no creció ni añadió responsabilidades. |
| 8 | OCP: no se introdujeron `if/switch` adicionales sobre `kind` | **PASS** | El archivo contiene **3 `if`** (idéntico al estado aprobado en Fase 1): dos en `of(...)` (validación de `Number.isFinite` y rango `(0, 1]`, líneas 174 y 177) y uno en `forKind(...)` (`if (kind.isLearning() && severity !== null)`, línea 197). Cero `switch`. La ramificación única en `forKind` es selección de catálogo (no dispatch de comportamiento) y ya fue justificada en §4.2 de la auditoría de Fase 1. La recalibración cambió **literales numéricos**, no flujo de control. |
| 9 | Sin números mágicos sin documentar | **PASS** | Cada uno de los 7 literales numéricos tiene JSDoc inmediato arriba con la derivación exacta (`X^(1/Y)`), la cita a `docs/05-memoria-decay.md` §2 y la trazabilidad al row del spec. Detalle abajo (§1.9.1). |

---

## 1.6.1 Verificación de los 17 flags estrictos en `code/tsconfig.json`

`/Users/h2devx/proyects/netzi-tech/mcp/memoria/code/tsconfig.json`
declara los 17 flags exigidos por §1.6 (lines 19-37):

| Flag | Valor | Línea |
|---|---|---|
| `strict` | `true` | 19 |
| `noImplicitAny` | `true` | 20 |
| `strictNullChecks` | `true` | 21 |
| `strictFunctionTypes` | `true` | 22 |
| `strictBindCallApply` | `true` | 23 |
| `strictPropertyInitialization` | `true` | 24 |
| `noImplicitThis` | `true` | 25 |
| `alwaysStrict` | `true` | 26 |
| `noUnusedLocals` | `true` | 29 |
| `noUnusedParameters` | `true` | 30 |
| `exactOptionalPropertyTypes` | `true` | 31 |
| `noImplicitReturns` | `true` | 32 |
| `noFallthroughCasesInSwitch` | `true` | 33 |
| `noUncheckedIndexedAccess` | `true` | 34 |
| `noImplicitOverride` | `true` | 35 |
| `noPropertyAccessFromIndexSignature` | `true` | 36 |
| `useUnknownInCatchVariables` | `true` | 27 |

Adicionales no exigidos pero deseables: `forceConsistentCasingInFileNames`,
`isolatedModules`, `verbatimModuleSyntax`, `skipLibCheck`,
`allowImportingTsExtensions`. Cero flags faltantes.

Comando ejecutado:
```bash
cd /Users/h2devx/proyects/netzi-tech/mcp/memoria/code && npx tsc --noEmit
# EXIT=0
```

`tsc --noEmit` corre sobre el rootDir `./src` con `include: ["src/**/*.ts"]`,
así que cubre `decay-factor.ts` y todos sus dependents/dependees del
codebase. Cero errores, cero warnings.

---

## 1.9.1 Trazabilidad de cada literal numérico

Verifiqué la fórmula `factor_per_day^period_days ≈ factor_per_period`
del spec para cada literal del archivo:

| Literal | Línea | Derivación documentada | Cálculo verificado | Drift al período |
|---|---:|---|---|---|
| `0.999888` (decision) | 64 | `0.99^(1/90)` para `decision (active, period=90d)` | `0.99^(1/90) = 0.999888335836534... → round 0.999888` ✓ | `\|0.999888^90 − 0.99\| ≈ 2.99e-5` (< 1e-3) ✓ |
| `0.998292` (learning kind-fallback) | 78 | `0.95^(1/30)` para `learning (tip, period=30d)` | `0.95^(1/30) = 0.998291684356... → round 0.998292` ✓ | `\|0.998292^30 − 0.95\| ≈ 9.01e-6` ✓ |
| `0.998292` (entity) | 87 | `0.95^(1/30)` para `entity (period=30d)` (numéricamente idéntico al de learning-tip; el spec usa el mismo factor + período para ambos kinds, documentado en JSDoc lines 84-86) | `0.95^(1/30) = 0.998291684356... → round 0.998292` ✓ | `\|0.998292^30 − 0.95\| ≈ 9.01e-6` ✓ |
| `1.0` (task) | 93 | Sentinel "no decay" del spec (`task (open)`, `factor=1.0, period=∞`) — JSDoc lines 88-92 lo cita explícitamente | trivial: `1.0^N = 1.0` ✓ | exacto ✓ |
| `0.988459` (turn) | 100 | `0.85^(1/14)` para `turn (period=14d)` | `0.85^(1/14) = 0.988458623647... → round 0.988459` ✓ | `\|0.988459^14 − 0.85\| ≈ 4.53e-6` ✓ |
| `0.998292` (learning-tip override) | 125 | `0.95^(1/30)` para `learning (severity=tip, period=30d)` | `0.95^(1/30) = 0.998291684356... → round 0.998292` ✓ | `\|0.998292^30 − 0.95\| ≈ 9.01e-6` ✓ |
| `0.999492` (learning-warning) | 132 | `0.97^(1/60)` para `learning (severity=warning, period=60d)` | `0.97^(1/60) = 0.999492475376... → round 0.999492` ✓ | `\|0.999492^60 − 0.97\| ≈ 2.77e-5` ✓ |
| `1.0` (learning-critical) | 139 | Sentinel "no decay" del spec (`learning (critical)`, `factor=1.0, period=∞`) — JSDoc lines 134-138 lo cita explícitamente | trivial ✓ | exacto ✓ |

**Conclusión §1.9.1:** los 5 valores derivados coinciden EXACTAMENTE
con los rounds-a-6-decimales reclamados en el JSDoc, y los 2 sentinels
(`1.0`) están etiquetados como tales con cita al row "no decay" del
spec. El drift máximo a período (2.99e-5 para decision) está bien
debajo del umbral 1e-3 que el JSDoc del catálogo (líneas 32-35)
declara como tolerancia. El JSDoc del catálogo además explica la
formula de calibración (líneas 21-29), el rationale del per-day
normalisation (líneas 11-19) y la simplificación MVP del status
collapse (líneas 37-47). **Cero números mágicos sin documentar.**

Cero literales auxiliares en código que no estén en los catálogos:
los únicos otros números en el archivo son `0`, `1`, `1` en el
validator de `DecayFactor.of` (líneas 177-178) — guardas del rango
`(0, 1]` ya documentadas exhaustivamente en `InvalidDecayFactorError`
y en el JSDoc de `DecayFactor` (líneas 154-160). No son magic numbers
sino los bounds inherentes al concepto "decay multiplier".

---

## 2. Auditoría grep complementaria

| Patrón | Matches en `decay-factor.ts` |
|---|---|
| `: any` (anotación de tipo) | **0** |
| `\bany\b` (cualquier ocurrencia) | **0** (ni siquiera en JSDoc) |
| `as any` | **0** |
| `<any>` | **0** |
| `Promise<any>` | **0** |
| `Array<any>` | **0** |
| `as unknown` | **0** |
| `// @ts-ignore` | **0** |
| `// @ts-nocheck` | **0** |
| `// @ts-expect-error` | **0** |
| `eslint-disable` | **0** |
| `Date.now` / `new Date()` | **0** |
| `Math.random` / `crypto.*` | **0** |
| `process.*` / `console.*` (en código) | **0** |
| `node:` imports | **0** |
| `switch` | **0** |
| `if` (statements) | **3** (idéntico al baseline aprobado en Fase 1) |
| `throw new` | **2** (ambos `InvalidDecayFactorError`, líneas 175 y 178; coherente con baseline) |

---

## 3. Diferencial vs. Fase 1

Comparado con la versión APROBADA en `phase-1-task-9-solid-validator.md`,
el archivo cambió en:

1. **Literales del catálogo `DEFAULT_DECAY_FACTORS_PER_DAY`** (líneas
   64, 78, 87, 100): ahora son los rounds correctos a 6 decimales de
   `factor_per_period^(1/period_days)`. El sentinel `task: 1.0` (línea
   93) no cambió.
2. **Literales del catálogo `LEARNING_DECAY_FACTORS_PER_DAY`** (líneas
   125, 132): ahora son los rounds correctos para tip y warning. El
   sentinel `critical: 1.0` (línea 139) no cambió.
3. **JSDoc del catálogo principal** (líneas 5-52): el comentario
   bajado documenta exhaustivamente la fórmula de calibración, el
   rationale per-day, la simplificación de `decision.status` y
   `task.status`, y la cota de drift `< 1e-3`. Antes el JSDoc no
   explicaba ni la fórmula ni la unidad-de-tiempo del factor (causa
   raíz de B-002).
4. **JSDoc por-literal** (líneas 56-100, 119-139): cada constante ahora
   tiene un comentario propio con su derivación exacta, su valor
   computado pre-rounding y su cita al row del spec.

Cambios estructurales (clase, métodos, signaturas, imports, control
flow): **CERO.** El shape sigue siendo el aprobado en Fase 1; sólo
cambian valores numéricos y prosa documentándolos.

Esto justifica un audit incremental focalizado en los 9 checks de la
tarea, sin re-auditar SOLID en su totalidad (ya APROBADO).

---

## 4. Veredicto

**APROBADO.**

El cambio es **acotado, type-safe y respeta los 9 checks**:

- **Type-safety total (§1.6):** cero `any`, cero `as any`, cero
  `@ts-ignore/expect-error/nocheck`, tsc --noEmit con los 17 flags
  estrictos EXIT=0. Todos los métodos públicos retornan tipos
  explícitos.
- **SRP (§1.4):** el archivo sigue siendo exclusivamente el VO
  `DecayFactor` + sus 2 catalogs privados. Cero lógica añadida que
  cambie su única razón de cambio ("evolución del catálogo de decay
  por kind/severity").
- **OCP (§1.4):** la recalibración cambió literales numéricos, NO
  flujo de control. Cero `switch` introducido. Conteo de `if` idéntico
  al baseline aprobado (3, todos pre-existentes y justificados).
- **Modularidad (§1.5):** los 3 imports siguen siendo el subset
  autorizado por el orquestador (intra-módulo + `memory/domain` +
  intra-domain).
- **Trazabilidad de literales:** cada uno de los 7 valores numéricos
  del catálogo lleva JSDoc adyacente con su derivación exacta
  (`X^(1/Y)`), su cita al row de `docs/05-memoria-decay.md` §2 y su
  valor computado pre-rounding. La verificación matemática externa
  (Node) confirma que los 5 valores derivados coinciden EXACTAMENTE
  con el round-a-6-decimales reclamado, y que el drift al período
  está debajo de la tolerancia 1e-3 declarada en el JSDoc del
  catálogo.

---

## 5. Resumen ejecutivo

| Check | Veredicto |
|---|---|
| 1. Cero `any` (explícito o implícito) | PASS |
| 2. Cero `as any` | PASS |
| 3. Cero `@ts-ignore/expect-error/nocheck` | PASS |
| 4. Cero imports externos (domain puro) | PASS |
| 5. Tipos de retorno explícitos | PASS |
| 6. `tsc --noEmit` con 17 flags estrictos | PASS (EXIT=0) |
| 7. SRP: archivo sigue siendo el VO `DecayFactor` y nada más | PASS |
| 8. OCP: cero `if/switch` adicionales sobre `kind` vs Fase 1 | PASS |
| 9. Cada literal numérico tiene JSDoc con derivación `X^(1/Y)` | PASS |

**EXIT code de tsc: 0.**

**Veredicto final: APROBADO.**
