# SOLID + Type-Safety Validator — Phase 1 / Task 4 (`secrets/domain/`)

- **Validator:** `solid-validator`
- **Scope:** `code/src/modules/secrets/domain/` (24 files) + transitively `code/src/shared/domain/**/*.ts`
- **Lineamientos auditados:** §1.4 (SOLID) y §1.6 (cero `any` / type-safety)
- **Veredicto:** **APPROVED**

---

## 1. Type-safety — `tsc --noEmit` con flags estrictas

**Comando ejecutado** (tsc 5.6.3, instalado en `/tmp/ts-validate-secrets`):

```
tsc --noEmit \
    --strict --exactOptionalPropertyTypes \
    --noUncheckedIndexedAccess --noPropertyAccessFromIndexSignature \
    --noFallthroughCasesInSwitch --noImplicitOverride \
    --noUnusedLocals --noUnusedParameters \
    --target ES2022 --module ESNext --moduleResolution bundler \
    --allowImportingTsExtensions \
    code/src/shared/domain/**/*.ts code/src/modules/secrets/domain/**/*.ts
```

> Nota: la primera ejecución sin `--allowImportingTsExtensions` falló con
> 32 errores `TS5097` (puramente mecánicos por la convención del repo de
> importar con sufijo `.ts`). Re-ejecutado con el flag agregado:

**Resultado:** `EXIT=0` — cero diagnostics.

Los flags exigidos por §1.6 que NO están en la línea (porque son
defaults de `--strict` o no aplican al subset compilado) están todos
implícitamente activos: `noImplicitAny`, `strictNullChecks`,
`strictFunctionTypes`, `strictBindCallApply`,
`strictPropertyInitialization`, `noImplicitThis`, `alwaysStrict`,
`noImplicitReturns` se derivan de `--strict`.

## 2. Cero `any`, `as any`, `@ts-ignore`, `@ts-nocheck`

```
grep -rEn ": any|as any|<any>|Array<any>|Promise<any>|@ts-ignore|@ts-nocheck" code/src/modules/secrets/domain/
```

Cero matches reales. Las únicas apariciones de la palabra "any" son en
**texto en prosa de comentarios** (`"... refuse any path the domain
cannot prove is safe..."`, `"... leaking any of the bytes."`, etc.).

Único cast tipado en el módulo:
- `audit-event-id.ts:43` — `normalised as IdValue<AuditEventIdBrand>`
  Es la **aplicación canónica del phantom-brand**, idéntica al patrón ya
  usado por `WorkspaceId.from` (`shared/domain/value-objects/workspace-id.ts:31`).
  Requerido para fijar la marca en un tipo nominal vacío en runtime; no
  es un cast inseguro porque `normalised` ya pasó `Id.normalize` (UUID v7
  validado). **Aceptado.**

## 3. SRP — Single Responsibility

Heurísticas (LOC ≤ 200, métodos públicos no relacionados ≤ 7) aplicadas
archivo por archivo:

| Archivo | LOC | Pub. methods | Razón única de cambio | OK |
|---|---:|---:|---|:---:|
| `aggregates/secret-audit-entry.ts` | 161 | 8 (5 getters + 2 factories + `pullEvents`) | Persistir y emitir 1 fila de audit-log | sí |
| `value-objects/audit-event-id.ts` | 45 | 1 | Identidad UUID v7 del audit entry | sí |
| `value-objects/detector-name.ts` | 74 | 1 | Identificador del detector | sí |
| `value-objects/entropy-threshold.ts` | 142 | 6 | Política de "alta entropía" | sí |
| `value-objects/path-sanitizer-rule.ts` | 282 | 4 + helpers privados | Política única de sanitización de rutas | sí (*) |
| `value-objects/sanitized-path.ts` | 110 | 4 | Resultado canónico de un path saneado | sí |
| `value-objects/sanitized-text.ts` | 111 | 5 | Resultado de un escaneo de texto | sí |
| `value-objects/secret-action.ts` | 107 | factory namespace (5) | Acción aplicada al hallazgo | sí |
| `value-objects/secret-finding.ts` | 85 | 2 | Composición de un hallazgo | sí |
| `value-objects/secret-kind.ts` | 159 | 9 (6 factories + 3 query) | Taxonomía de tipos de secreto | sí |
| `value-objects/secret-match.ts` | 125 | 2 | Posición de un match en texto | sí |
| `value-objects/secret-pattern.ts` | 187 | 3 | Detector regex + matching | sí |
| `value-objects/secret-source.ts` | 165 | factory namespace (5) | Origen del texto escaneado | sí |
| servicios (3 interfaces) | 32–52 | 1–2 cada uno | Una capacidad por puerto | sí |
| repositorios (1 interface) | 63 | 3 | Persistencia del aggregate | sí |
| eventos (4) | ~45 c/u | 0 (data classes) | Hecho de negocio puntual | sí |
| errores (4) | 48–120 | 0–1 (factory `isKind` en 1) | 1 modo de falla por clase | sí |

(*) `path-sanitizer-rule.ts` (282 LOC) está sobre el umbral nominal de
200; la inspección manual confirma que el contenido es **una sola
responsabilidad** (la política de saneamiento) y los ~80 LOC extra son
documentación JSDoc detallada y casos de plataforma (`/Users`, `/home`,
`C:\Users`) explícitos por seguridad. Lo dejaría tal cual; si el equipo
quiere reducir el archivo, la única división razonable sería extraer
`looksAbsolute`/`containsTraversalSegment` a un helper, lo que añade
ruido sin beneficio. **OK con nota.**

## 4. OCP — Open/Closed (DU + switch exhaustivo `default: never`)

Ubicaciones de switches sobre las DUs `SecretSource`, `SecretAction` y
`PathSanitizerErrorKind`:

- `value-objects/secret-source.ts:149-163` — `SecretSources.equals(...)`
  switch sobre `left.kind`. **Tiene `default: { const exhaustive: never
  = left; return exhaustive; }`** → cumple `default: never`. Sí.
- `errors/path-sanitizer-error.ts:102-118` — `buildMessage(kind, ...)`
  switch sobre `kind`. **Tiene `default: { const exhaustive: never =
  kind; ... }`** → cumple. Sí.
- `value-objects/secret-action.ts:73-85` — `SecretActions.fromKind(raw)`
  switch sobre **`raw: string`** (no sobre la DU). El `default` lanza
  `InvalidInputError`. Esto es correcto porque el discriminador es
  externo (input crudo); aplicar `never` no aporta — el `string` no es
  closed. La validación se completa con `isKind` type-guard sobre el
  `as const` array `SECRET_ACTION_KINDS`. **OK.**

No se detecta ningún `if (kind === "X") else if (kind === "Y") ...`
disperso en clases centrales. Cada nueva variante requiere extender:
1) la tupla `as const`, 2) la unión literal, 3) el factory namespace.
La extensión por adición es la regla.

## 5. LSP — Liskov

`SecretsDomainError` es abstracta y declara `code: string` y
`jsonRpcCode: number | null` como contratos.

Subclases:
- `InvalidPatternError` — `code = "secrets.invalid-pattern"`, `jsonRpcCode = null`. Cumple.
- `PathSanitizerError` — `code = "secrets.path-sanitizer"`, `jsonRpcCode = null`. Cumple.
- `SecretDetectionFailedError` — `code = "secrets.detection-failed"`, `jsonRpcCode = null`. Cumple.

Ninguna subclase lanza un tipo de error no documentado por el padre, ni
fortalece pre-condiciones, ni debilita post-condiciones. Una variable
`SecretsDomainError` puede contener cualquiera de las tres
indistintamente y todos los call-sites del adapter (`instanceof
SecretsDomainError` + lectura de `code`/`jsonRpcCode`) seguirán
funcionando. Repository (`SecretAuditRepository`) documenta `findById`
como `Promise<SecretAuditEntry | null>` (no excepciones para no-encontrado),
contrato consistente con `WorkspaceRepository`. Sí.

## 6. ISP — Interface Segregation

Puertos del bounded context, conteo de métodos:

| Puerto | Métodos | Cohesión |
|---|---:|---|
| `EntropyCalculator` | 1 (`calculate`) | Función pura |
| `PatternRegistry` | 2 (`getPatterns`, `getPattern`) | Catálogo read-only |
| `SecretsScanner` | 2 (`scan`, `scanPath`) | Capa-1 + Capa-2 — ambos métodos pertenecen al concepto "scanner defensivo"; segregar `PathScanner` separado introduciría coordinación adicional sin beneficio |
| `SecretAuditRepository` | 3 (`findById`, `save`, `findByWorkspace`) | Persistencia del aggregate |

Todas ≤ 5 métodos. Ninguna implementación se vería forzada a `throw new
Error("not supported")`. Sí.

## 7. DIP — Dependency Inversion

- `SecretAuditEntry` (aggregate) — recibe **VOs ya construidas** vía
  `record({...})`/`rehydrate({...})`. NO instancia `Date.now()`,
  registry, scanner, ni clock. El único `new` interno es para construir
  el evento `SecretAuditEntryRecorded` y el propio aggregate (factory),
  ambos del mismo bounded context — eso es construcción de DTOs, no
  inyección de adapter.
- Los 3 servicios (`EntropyCalculator`, `PatternRegistry`,
  `SecretsScanner`) son **interfaces puras** sin implementación. La
  composición e instanciación viven en `composition/` (fuera de scope).
- `PathSanitizerRule` (VO) `apply(...)` es 100% string-manipulation; no
  toca filesystem, no usa `lstat`, no instancia adapters. Comentario
  explícito en l.141-143.
- `SecretPattern.matches(text)` ejecuta el regex local; no inyecta
  nada externo.

```
grep -rE "new (Sqlite|Pino|Fastembed|Argon|System|Uuid|Pattern)" code/src/modules/secrets/domain/
# => sin matches
```

Cumple.

## 8. Modularidad estricta (§1.5)

```
grep -rE "from \"" code/src/modules/secrets/domain/ | \
  grep -E "modules/(workspace|memory|retrieval|curator|encryption|mcp-server|cli)"
# => sin matches
```

Todos los imports son **internos al módulo** (`../value-objects/...`,
`../errors/...`, `../events/...`, `../aggregates/...`) o desde
`shared/domain/...` (`Id`, `Timestamp`, `WorkspaceId`, `Confidence`,
`NonEmptyString`, `DomainError`, `InvalidInputError`, `Result`,
`DomainEvent`). Cero cross-module imports. Comentario explícito en
`path-sanitizer-rule.ts:248-252` documenta la duplicación intencional
de `looksAbsolute` para no importar `WorkspacePath`. Cumple.

## 9. Ciclo aggregate↔event (verificación específica)

Imports declarados:

- `aggregates/secret-audit-entry.ts` → importa
  `events/secret-audit-entry-recorded.ts` (instancia el evento en
  `record(...)`) y los VOs `AuditEventId`, `SecretAction`,
  `SecretFinding`.
- `events/secret-audit-entry-recorded.ts` → importa **únicamente**
  `shared/.../DomainEvent`, `Timestamp`, `WorkspaceId` y los VOs
  `AuditEventId`, `SecretAction`, `SecretFinding`. **NO importa el
  aggregate.**

→ Grafo: `aggregate → event → VOs ← aggregate`. **Acíclico.**

`SecretAction` extraído a su propio VO (`value-objects/secret-action.ts`)
es importado tanto por el aggregate como por el evento sin crear ciclo.
Conforme a lo solicitado.

---

## Hallazgos secundarios (informativos, no bloqueantes)

Ninguno que justifique rechazo. Tres notas para futuras tareas:

1. `path-sanitizer-rule.ts` rebasa el umbral heurístico de 200 LOC (282).
   Justificado por documentación + casos POSIX/Linux/Windows. Si el
   módulo crece (e.g. `--policy strict` adicional), considerar separar
   "política" de "rewriter de plataforma" — pero hoy es prematuro.
2. `SecretActions.fromKind` no usa `default: never` en su switch
   (correcto, porque switchea sobre `string` crudo, no sobre la DU). El
   guardrail equivalente está en `isKind` + el array `as const`. Las
   adiciones futuras a `SECRET_ACTION_KINDS` requerirán actualizar tres
   sitios mecánicamente; sería visible y cubierto por tests.
3. La duplicación de `looksAbsolute`/`containsTraversalSegment` entre
   `PathSanitizerRule` y `SanitizedPath` es deliberada y comentada
   (`path-sanitizer-rule.ts:246-252`). Cuando un tercer módulo necesite
   la lógica, promoverla a `shared/domain/` (regla §1.5).

---

## Veredicto final

```json
{
  "validator": "solid-validator",
  "scope": "code/src/modules/secrets/domain/",
  "files_reviewed": 24,
  "verdict": "APPROVED",
  "checks": {
    "tsc_strict_exit_0": true,
    "zero_any": true,
    "zero_ts_ignore_or_nocheck": true,
    "SRP": "OK",
    "OCP": "OK (DU + default:never en SecretSource y PathSanitizerErrorKind)",
    "LSP": "OK (3 subclases SecretsDomainError sustituibles)",
    "ISP": "OK (puertos 1-3 metodos)",
    "DIP": "OK (aggregate/VO sin new de adapters; servicios son interfaces puras)",
    "modularity": "OK (cero cross-module imports)",
    "aggregate_event_cycle": "NONE (event no importa aggregate)"
  },
  "violations": [],
  "notes": [
    "audit-event-id.ts:43 contiene `as IdValue<AuditEventIdBrand>` — patron canonico de aplicacion de phantom-brand identico a WorkspaceId.from; aceptado.",
    "path-sanitizer-rule.ts (282 LOC) supera el umbral nominal de 200; justificado por casos de plataforma + JSDoc; SRP intacta."
  ]
}
```
