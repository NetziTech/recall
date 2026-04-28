# Validación SOLID + Type-Safety — Fase 2, Tarea 2.1 (tooling del repo)

- **Validador**: `solid-validator`
- **Fecha**: 2026-04-27
- **Alcance**: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `scripts/validate-modules.ts`
- **Veredicto**: **APROBADO**

---

## Resumen ejecutivo

La materialización del tooling cumple los lineamientos `docs/12 §1.4` (SOLID) y `§1.6` (type-safety total) sin laxitud. Los 17 flags estrictos de TypeScript están todos presentes y `tsc --noEmit` pasa con EXIT=0 sobre el dominio Fase 1. ESLint flat config emplea `strictTypeChecked + stylisticTypeChecked` con type-aware linting y bloquea explícitamente `any`, `as any`, `// @ts-ignore` y `// @ts-nocheck`. El script `validate-modules.ts` está bien tipado, sin `any` y con responsabilidad única (validar imports cross-module según ADR-001).

Se observan dos puntos transitorios documentados (`passWithNoTests`, `allowImportingTsExtensions`) — ambos justificados en comentarios y por la decisión de bundlear con `tsup`, por lo que se aceptan.

---

## EXIT codes verificados

| Comando | EXIT | Resultado |
|---|---:|---|
| `npx tsc --noEmit` (Check 5) | **0** | Limpio sobre `src/**/*.ts` con los 17 flags |
| `npm run validate:modules` (Check 6) | **0** | 8 módulos OK; cross-imports autorizados (ADR-001): `curator→memory×3`, `retrieval→memory×22` |

---

## Tabla de checks 1–14

| # | Check | Resultado | Evidencia |
|---:|---|:---:|---|
| 1 | tsconfig incluye los 17 flags de §1.6 | OK | `tsconfig.json:19-36` — todos presentes (ver tabla detallada abajo) |
| 2 | tsconfig sin flags de laxitud | OK | `grep` no encuentra `skipDefaultLibCheck`, `noImplicitAny:false` ni `strict:false` |
| 3a | `no-explicit-any` = error | OK | `eslint.config.js:39` |
| 3b | `no-unsafe-assignment` = error | OK | `eslint.config.js:40` |
| 3c | `no-unsafe-call` = error | OK | `eslint.config.js:41` |
| 3d | `no-unsafe-member-access` = error | OK | `eslint.config.js:42` |
| 3e | `no-unsafe-return` = error | OK | `eslint.config.js:43` |
| 3f | `no-unsafe-argument` = error | OK | `eslint.config.js:44` |
| 3g | `explicit-function-return-type` = error | OK | `eslint.config.js:45-53` |
| 3h | `ban-ts-comment` (ts-ignore: true, ts-nocheck: true) | OK | `eslint.config.js:85-94` |
| 3i | Bloqueo de `as any` / `<any>` | OK | `eslint.config.js:97-107` (no-restricted-syntax sobre `TSAsExpression > TSAnyKeyword` y `TSTypeAssertion > TSAnyKeyword`) |
| 4 | ESLint type-aware (`parserOptions.project`) | OK | `eslint.config.js:32-35` (`project: "./tsconfig.json"`, `tsconfigRootDir`) |
| 5 | `tsc --noEmit` EXIT=0 | OK | EXIT=0 verificado en runtime |
| 6 | `validate:modules` EXIT=0 | OK | EXIT=0; reporte limpio con cross-imports autorizados visibles |
| 7 | SRP en `validate-modules.ts` | OK | Una sola responsabilidad: parsear imports + validarlos contra ADR-001 + detectar ciclos directos |
| 8 | ISP en `validate-modules.ts` | OK | 4 interfaces pequeñas y cohesivas (`ImportRecord`, `Violation`, `CycleViolation`, `AuthorisedException`), todas con `readonly` |
| 9 | Cero `any` / `as any` / `@ts-ignore` en `validate-modules.ts` | OK | `grep` no encuentra ocurrencias reales (solo menciones en JSDoc del propio script y del ESLint config). El `catch (err: unknown)` (línea 302) usa `unknown`, no `any` |
| 10 | Tipos de retorno explícitos en exports | OK | Todas las funciones tienen retorno explícito: `walkTsFiles: Promise<readonly string[]>`, `moduleOf: string \| null`, `extractSpecifiers: readonly string[]`, `resolveSpecifier: string \| null`, `isAuthorisedException: boolean`, `main: Promise<number>`, anidada `visit: Promise<void>` |
| 11 | Coverage thresholds enforced (no comentarios) | OK | `vitest.config.ts:37-60` — `thresholds:{ lines/branches/functions/statements:95, "src/**/domain/**":100, "src/**/application/**":100, "src/**/infrastructure/**":90 }` declarados como objeto `thresholds` enforced por v8 |
| 12 | `passWithNoTests:true` con comentario | OK | `vitest.config.ts:22-24` — comentario indica explícitamente "Fase 5 (Testing) will populate tests/; remove this if/when CI should reject test-less commits" |
| 13 | `noEmit:true` + `allowImportingTsExtensions:true` justificado | OK | `package.json:19` ya define `tsup` como bundler oficial (alineado a `docs/06 §10`); `tsconfig` solo type-checkea, no emite |
| 14 | 215 errores de lint del código Fase 1 | INFO | No bloqueante para Tarea 2.1 (alcance: tooling). Documentado abajo en `pending-cleanup` |

---

## Verificación de los 17 flags estrictos (`docs/12 §1.6`)

| # | Flag | Línea en `tsconfig.json` | Valor |
|---:|---|---:|:---:|
| 1 | `strict` | 19 | `true` |
| 2 | `noImplicitAny` | 20 | `true` |
| 3 | `strictNullChecks` | 21 | `true` |
| 4 | `strictFunctionTypes` | 22 | `true` |
| 5 | `strictBindCallApply` | 23 | `true` |
| 6 | `strictPropertyInitialization` | 24 | `true` |
| 7 | `noImplicitThis` | 25 | `true` |
| 8 | `alwaysStrict` | 26 | `true` |
| 9 | `useUnknownInCatchVariables` | 27 | `true` |
| 10 | `noUnusedLocals` | 29 | `true` |
| 11 | `noUnusedParameters` | 30 | `true` |
| 12 | `exactOptionalPropertyTypes` | 31 | `true` |
| 13 | `noImplicitReturns` | 32 | `true` |
| 14 | `noFallthroughCasesInSwitch` | 33 | `true` |
| 15 | `noUncheckedIndexedAccess` | 34 | `true` |
| 16 | `noImplicitOverride` | 35 | `true` |
| 17 | `noPropertyAccessFromIndexSignature` | 36 | `true` |

**17/17 presentes y en `true`.** Cero laxitud.

---

## SOLID en `scripts/validate-modules.ts`

### SRP — Single Responsibility
La unidad tiene una sola razón para cambiar: cómo se validan los imports cross-module. Las funciones helper (`walkTsFiles`, `moduleOf`, `extractSpecifiers`, `resolveSpecifier`, `isAuthorisedException`) son privadas al script y todas sirven a esa única responsabilidad. `main()` (líneas 169-296) hace cinco pasos secuenciales pero todos pertenecen al mismo caso de uso "auditar imports y reportar".

### OCP — Open/Closed
Las excepciones autorizadas viven en una constante `ADR_001_AUTHORISED_EXCEPTIONS` (línea 84) tipada como `readonly AuthorisedException[]`. Añadir un nuevo cross-import autorizado se hace agregando una entrada al array — no requiere modificar `isAuthorisedException()`. OCP respetado.

### LSP — N/A
No hay jerarquía de tipos.

### ISP — Interface Segregation
4 interfaces, todas con ≤6 propiedades y todas `readonly`:
- `ImportRecord` (3 props)
- `Violation` (6 props)
- `CycleViolation` (2 props)
- `AuthorisedException` (2 props)

Cada una tiene un único cliente. ISP respetado.

### DIP — N/A
Script utilitario sin inyección de puertos. Acceso a `fs`/`path`/`process` directo es aceptable porque es un script de build y no business logic. No es un use case.

### Type-safety
- `: any` → 0 ocurrencias.
- `as any` → 0 ocurrencias.
- `// @ts-ignore` / `// @ts-nocheck` → 0 ocurrencias (las únicas menciones del string son en JSDoc explicativo).
- `unknown` usado correctamente en `catch (err: unknown)` (línea 302).
- `match[1]` chequeado contra `undefined` antes de usarse (línea 132-133), respetando `noUncheckedIndexedAccess`.
- Destructuring de `edge.split("=>")` chequeado contra `undefined` (líneas 239-240), respetando `noUncheckedIndexedAccess`.
- Retornos explícitos en todas las funciones.

---

## Detalle de coverage thresholds (`vitest.config.ts`)

Los thresholds están declarados como objeto `thresholds` dentro de `coverage` (líneas 37-60), no como comentarios. v8 los enforceará en `vitest run --coverage`.

| Glob | Lines | Branches | Functions | Statements |
|---|---:|---:|---:|---:|
| (global) | 95 | 95 | 95 | 95 |
| `src/**/domain/**` | 100 | 100 | 100 | 100 |
| `src/**/application/**` | 100 | 100 | 100 | 100 |
| `src/**/infrastructure/**` | 90 | 90 | 90 | 90 |

`src/composition/**` y `src/**/index.ts` están **excluidos** de la medición (líneas 31-36) por ser wiring/re-exports, lo cual es coherente con `docs/12 §4`.

---

## Casos especiales evaluados (sin rechazo)

### 12. `passWithNoTests: true`
`vitest.config.ts:22-25`:
```ts
// While Fase 1-2 have no tests yet, allow `vitest run` to exit 0.
// Fase 5 (Testing) will populate `tests/`; remove this if/when CI
// should reject test-less commits.
passWithNoTests: true,
```
Comentario explícito con la condición de retiro (Fase 5). **Aceptado.**

### 13. `noEmit: true` + `allowImportingTsExtensions: true`
- `tsconfig.json:16-17` define ambos.
- `package.json:19` configura `tsup` como bundler (`tsup src/composition/server.ts src/composition/cli.ts --format esm --target node20 --bundle --clean --out-dir dist`).
- Coherente con `docs/06 §10` (TypeScript solo type-checkea, tsup hace bundle).

**Aceptado.**

### 14. 215 errores de lint en código Fase 1
Reportados por el implementador como deuda detectada cuando se corre `npm run lint` sobre el código existente. **No bloquean Tarea 2.1** porque el alcance de esta tarea es construir el tooling, no limpiar el código previo. Documentados abajo como `pending-cleanup`.

---

## Pending cleanup (no bloqueante para 2.1)

```json
{
  "kind": "pending-cleanup",
  "owner": "siguiente tarea de cleanup o tarea de cierre Fase 2",
  "scope": "código Fase 1 bajo src/",
  "detail": "215 errores de lint detectados al correr `npm run lint` sobre el código Fase 1 con la nueva config estricta. La config en sí está correcta; el código previo necesita pasar el nuevo barómetro.",
  "suggested_action": "Crear tarea 2.1bis o asignar a code-cleanup-engineer para limpiar antes del cierre de Fase 2."
}
```

---

## Veredicto final

```json
{
  "validator": "solid-validator",
  "task": "phase-2-task-1-tooling",
  "verdict": "APROBADO",
  "violations": [],
  "warnings": [
    {
      "rule": "pending-cleanup",
      "scope": "src/**",
      "detail": "215 errores de lint en código Fase 1 contra la nueva config estricta. No bloquea Tarea 2.1 (alcance: config). Crear tarea de cleanup."
    }
  ],
  "tsc_exit": 0,
  "validate_modules_exit": 0
}
```

La configuración del tooling es **correcta, estricta y sin laxitud**. La Tarea 2.1 queda **APROBADA** desde la perspectiva SOLID + type-safety.
