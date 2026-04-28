# DDD Validator — Phase 2, Task 4 (DecayFactor recalibration, B-002 hotfix)

**Validator:** `ddd-validator`
**Phase:** `phase-2-shared-infra` (recalibration scoped to `curator` domain VO)
**Module:** `curator`
**Scope:**
- `code/src/modules/curator/domain/value-objects/decay-factor.ts` (audited)
- `code/src/modules/curator/domain/services/decay-calculator.ts` (regression check, no changes expected)
**Verdict:** **APROBADO**

---

## Resumen ejecutivo

Tarea 2.4 recalibra las constantes literales de
`DEFAULT_DECAY_FACTORS_PER_DAY` y `LEARNING_DECAY_FACTORS_PER_DAY` para
resolver B-002 (los valores per-period del spec se estaban usando como
si fueran per-day, produciendo drift severo verificado en
`phase-1-task-9-ddd-validator.md` Decisión #2).

La recalibración:

- **No altera el modelo** (sigue siendo VO inmutable con factories
  estáticas e invariante `(0, 1]`).
- **No altera la API pública** (`of`, `forKind`, `unity`, `isUnity`,
  `toNumber`, `equals`; `InvalidDecayFactorError` con mismo `code`
  `curator.invalid-decay-factor`). Idéntica al snapshot APROBADO de
  Fase 1 Tarea 9.
- **No altera el calculator** — `decay-calculator.ts` sigue aplicando
  `current * factor^daysSinceLastUsed` (línea 99), confirmando que la
  semántica per-day ahora es coherente con los literales.
- **TypeScript estricto pasa** (`npx tsc --noEmit -p code/tsconfig.json`
  → 0 errores).

Verificación matemática propia (abajo) confirma drift máximo
`< 3e-5` per-period, muy por debajo del límite `< 1e-3` exigido.

---

## Tabla de checks (1–11)

| # | Check | Resultado | Evidencia |
|---|---|:--:|---|
| 1 | Invariantes preservadas: todos los nuevos defaults caen en `(0, 1]` | OK | `decay-factor.ts:64,78,87,93,100,125,132,139` — todos los literales están en `[0.988459, 1.0]` |
| 2 | API pública intacta vs. Fase 1 (factories `of`/`forKind`/`unity`, métodos `isUnity`/`toNumber`/`equals`, `InvalidDecayFactorError.code === "curator.invalid-decay-factor"`) | OK | `decay-factor.ts:173,193,209,218,222,226`; `invalid-decay-factor-error.ts:22` |
| 3 | Inmutabilidad: `private constructor`, prop `readonly value`, sin setters, `Object.freeze` en ambas tablas | OK | `decay-factor.ts:168` (`private constructor(public readonly value: number)`); `:55` y `:118` (`Object.freeze(...)`); grep de `set [a-zA-Z]+\(` y `public [a-zA-Z]+:` (no readonly) → 0 hits |
| 4 | Igualdad por valor preservada (`equals(other): boolean`) | OK | `decay-factor.ts:226-228` |
| 5 | JSDoc por constante con origen exacto del valor | OK | Cada literal lleva un JSDoc indicando fórmula (`x^(1/period)`), source row del spec, valor exacto pre-redondeo y valor final a 6 decimales (líneas 56-63, 65-77, 79-86, 88-92, 94-100, 119-124, 126-131, 133-139). `learning` kind-level tiene JSDoc específico (líneas 65-77) explicando el fallback hacia `tip` cuando severity es `null` |
| 6 | Nombres respetan ubiquitous language (`DEFAULT_DECAY_FACTORS_PER_DAY`, `LEARNING_DECAY_FACTORS_PER_DAY`) | OK | `decay-factor.ts:53,116`. Cero términos genéricos (`Manager`, `Helper`, `Util`, `Data`, `Object`) introducidos |
| 7 | Sufijo `PER_DAY` explícito y la unidad documentada en la cabecera del catálogo | OK | Nombre de la constante incluye `_PER_DAY`; JSDoc del catálogo (líneas 5-52) explica explícitamente que los valores son **per-day**, da la fórmula de calibración (`factor_per_day = factor_per_period^(1/period_days)`) y cita el ejemplo `0.99^(1/90) → 0.999888` para `decision (active)`. La causa raíz de B-002 (confusión period vs day) queda blindada por el nombre + JSDoc |
| 8 | Coherencia numérica con spec `docs/05` §2 (drift `< 1e-3` per-period en ≥ 3 entradas) | OK | Tabla de verificación abajo: drift máximo `2.99e-5`, mínimo `0`, los 7 cases pasan |
| 9 | Rama "conservadora MVP" (`decision active`, `task open`) documentada | OK | `decay-factor.ts:37-47` lo documenta como "simplification 2" del catálogo. Adicionalmente el orchestrator lo registró en `.claude/workflow-state.json` línea 257 (B-002 brief) y línea 343 (notes de la tarea 2.4) |
| 10 | `decay-calculator.ts` aplica `score * factor^days_elapsed` (per-day), NO per-period | OK | `decay-calculator.ts:98-99`: `input.current.toNumber() * Math.pow(factor.toNumber(), input.daysSinceLastUsed)`. No hay división por period en ningún lugar del archivo (grep `period` → 0 hits operativos). El bug B-002 queda efectivamente resuelto |
| 11 | `tsc --noEmit -p code/tsconfig.json` verde | OK | Ejecutado contra `code/tsconfig.json`; salida: 0 errores |

---

## Verificación matemática propia (check #8)

Recálculo `per_day^period` para cada constante y comparación con el
target per-period del spec `docs/05-memoria-decay.md` §2.

| Caso | per-day declarado | `per_day^period` | target spec | drift abs | tolerancia |
|---|---|---|---|---|---|
| `decision (active, 90d)` | `0.999888` | `0.9899701` | `0.99` | `2.99e-5` | < 1e-3 → OK |
| `learning (tip, 30d)` | `0.998292` | `0.9500090` | `0.95` | `9.01e-6` | < 1e-3 → OK |
| `learning (warning, 60d)` | `0.999492` | `0.9699723` | `0.97` | `2.77e-5` | < 1e-3 → OK |
| `entity (30d)` | `0.998292` | `0.9500090` | `0.95` | `9.01e-6` | < 1e-3 → OK |
| `turn (14d)` | `0.988459` | `0.8500045` | `0.85` | `4.53e-6` | < 1e-3 → OK |
| `task (open)` | `1.0` | `1.0000000` | `1.0` | `0` | sentinel → OK |
| `learning (critical)` | `1.0` | `1.0000000` | `1.0` | `0` | sentinel → OK |

Drift máximo observado: `2.99e-5`, dos órdenes de magnitud por debajo
del límite `1e-3`. Los valores exactos (`0.99^(1/90) ≈
0.999888335836`, `0.95^(1/30) ≈ 0.998291684356`, `0.97^(1/60) ≈
0.999492475376`, `0.85^(1/14) ≈ 0.988458623647`) coinciden con los
declarados en JSDoc tras el redondeo a 6 decimales.

`decision (superseded)` y `task (done)` del spec quedan
intencionalmente fuera del catálogo MVP por la simplificación
"conservadora" documentada (decisión del orchestrator + JSDoc).
Tendrán que añadirse cuando el dominio de memory exponga
`decision.status` y `task.status` como discriminadores; hasta ese
punto el catálogo es estable.

---

## Comparación API pública vs Fase 1

| Símbolo | Fase 1 (snapshot APROBADO) | Fase 2 (recalibración) | Cambio |
|---|---|---|---|
| `DecayFactor.of(value)` | factory pública | igual | — |
| `DecayFactor.forKind(kind, severity)` | factory pública | igual (mismo lookup, distintos números devueltos) | — |
| `DecayFactor.unity()` | factory pública | igual | — |
| `DecayFactor.isUnity()` | método público | igual | — |
| `DecayFactor.toNumber()` | método público | igual | — |
| `DecayFactor.equals(other)` | método público | igual | — |
| `DecayFactor.value` | `public readonly` | igual | — |
| `private constructor` | sí | sí | — |
| `InvalidDecayFactorError` thrown desde `of` cuando valor `≤ 0 || > 1` o `!isFinite` | sí | igual | — |
| `DEFAULT_DECAY_FACTORS_PER_DAY` (interno) | drift respecto a spec | calibrado: drift `< 1e-4` per-period | **valores actualizados** |
| `LEARNING_DECAY_FACTORS_PER_DAY` (interno) | drift respecto a spec | calibrado: drift `< 1e-4` per-period | **valores actualizados** |

Cero adiciones, cero deprecaciones, cero firmas modificadas.

---

## Reglas DDD R1–R7 (re-check spot)

| Regla | Aplica al cambio | Resultado |
|---|---|---|
| R1 (entidades) | No (DecayFactor es VO) | n/a |
| R2 (VOs) | Sí | OK — `private constructor`, factory `of`, props `readonly`, `equals(other): boolean`, sin setters, validación en constructor lanza `DomainError` (`InvalidDecayFactorError extends CuratorDomainError extends DomainError`) |
| R3 (aggregates) | No | n/a |
| R4 (repos) | No | n/a |
| R5 (servicios dominio) | Spot-check sobre `DecayCalculator` | OK — sigue siendo `static`-only, puro, sin I/O, sin clock |
| R6 (eventos) | No | n/a |
| R7 (lenguaje dominio) | Sí | OK — `DEFAULT_DECAY_FACTORS_PER_DAY` y `LEARNING_DECAY_FACTORS_PER_DAY` siguen siendo nombres del dominio (decay, factor, learning, kind, per-day). Cero banderas rojas (`Item`/`Manager`/`Helper`/`Util`/`Data`/`Object` como nombres de clases o tablas) |

---

## Veredicto final

**APROBADO.** La recalibración:

- Resuelve B-002 sin tocar el modelo, la API pública ni el aggregate.
- Mantiene todas las invariantes DDD del VO (R2) y del servicio
  asociado (R5).
- Reproduce los valores per-period del spec con drift `< 3e-5`,
  cumpliendo el target `< 1e-3` con 1+ órdenes de margen.
- Documenta exhaustivamente la procedencia de cada literal y la
  simplificación "conservadora MVP" para `decision/task` sin status.
- Compila contra `code/tsconfig.json` en estricto sin errores.

Esto cierra la observación #1 ("drift numérico decay") de
`phase-1-task-9-ddd-validator.md`.
