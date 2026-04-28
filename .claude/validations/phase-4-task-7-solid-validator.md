# Phase 4 / Task 4.7 — solid-validator report

**Validator**: solid-validator
**Scope**: Re-wiring del Composition Root (Tarea 4.7). New facade adapters in
`code/src/composition/{facades,event-bus,wiring}` that wire module use cases
to the cross-module driving/driven ports defined in Tarea 4.6.
**Date**: 2026-04-27
**Verdict**: **APPROVED**

---

## Summary

| Check                                            | Result    |
|--------------------------------------------------|-----------|
| `tsc --noEmit` exit code                         | `0`       |
| `npm run lint` exit code                         | `0`       |
| `: any` / `as any` / `<any>` in `src/composition`| **0**     |
| `: any` / `as any` / `<any>` in `src/` (real)    | **0** (only inside JSDoc text) |
| `// @ts-ignore` / `// @ts-nocheck`               | **0**     |
| `// @ts-expect-error`                            | **0**     |
| Explicit return types on facade methods          | yes       |
| `tsconfig.json` strictness flags                 | all on    |
| ESLint `no-explicit-any`, `no-unsafe-*`, etc.    | error     |

`tsconfig.json` enables every flag the lineamiento 1.6 demands
(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noPropertyAccessFromIndexSignature`,
`useUnknownInCatchVariables`, etc.).

`eslint.config.js` enforces:
- `@typescript-eslint/no-explicit-any: error`
- `@typescript-eslint/no-unsafe-{assignment,call,member-access,return,argument}: error`
- `@typescript-eslint/explicit-function-return-type: error`
- `@typescript-eslint/explicit-module-boundary-types: error`
- `@typescript-eslint/no-floating-promises: error`
- `@typescript-eslint/ban-ts-comment` (only `@ts-expect-error` with description allowed)
- `no-restricted-syntax` blocking `as any` / `<any>` syntactically

---

## A. SOLID in facade adapters

### SRP
Each `*FacadeAdapter` wraps **one** use case (or, for `Remember`/`TrackTask`/
`HealthCheckFacade`, dispatches on a discriminated union to the matching
use case). No adapter mixes responsibilities. `mcp-server-facades.ts` is
882 lines but each class is small (60-150 lines) and the helpers live in
a clearly delimited "Helpers" block.

### OCP
- `RememberFacadeAdapter.remember` switches on `input.kind` ∈
  `decision | learning | entity | turn | task` with an exhaustive
  `default: { const exhaustive: never = input.kind; ... }` guard
  (`mcp-server-facades.ts:502-510`). Adding a new wire kind is additive
  and is rejected at compile time until a branch is added.
- `TrackTaskFacadeAdapter.task` does the same with the `action` union
  and a `never` exhaustive on the inner `dispatchTaskTransition`
  (`mcp-server-facades.ts:619-627`, `:830-838`).
- `WIRE_TO_DOMAIN_LAYER_NAME` / `DOMAIN_TO_WIRE_LAYER_NAME` are
  bidirectional `Readonly<Record<wire, domain>>` / `Readonly<Record<
  domain, wire>>` tables (`mcp-server-facades.ts:211-233`); adding a
  new layer name requires updating both ends and the compiler enforces
  exhaustiveness.

### LSP
The 12 facades that swapped from `Pending*Facade` stubs to real
adapters preserve the port's pre/post-conditions: success returns the
documented DTO; recoverable failures surface as `Result` folds (lock /
unlock encryption) or as the documented typed error
(`KeyValidationFailedError`, `EncryptionNotInitializedError`,
`McpFacadeNotImplementedError`, `CliFacadeNotImplementedError`).
No adapter introduces a "throw new Error('not supported')" surprise
that would break a sustitution.

### ISP
Each driven port exposes exactly **one** operation
(`InitializeWorkspaceFacade.initialize`, `RecallMemoryFacade.recall`,
`RememberFacade.remember`, `TrackTaskFacade.task`,
`CheckHealthFacade.health`, `DestroyEncryptionFacade.destroy`, ...)
The `EventPublisher` port has two methods (`publish`,
`publishAll`) but both are pure publish-side primitives; the
subscribe side lives only on `DomainEventBus` in the composition
root, never leaking into the modules.

### DIP
- Every facade adapter receives its use case(s) and helpers via
  constructor; none instantiates a use case or repository with `new`
  internally.
- `container.ts` is the **only** place that calls `new` on adapter
  classes. The container's instantiation order matches the documented
  step list (Steps 1-14) and respects the dependency arrows.
- `RememberFacadeAdapter`'s constructor takes 5 ports
  (`recordDecision`, `recordLearning`, `recordEntity`, `recordTurn`,
  `trackTask`) — not a violation: each is a different in-port and the
  adapter routes between them. ISP would have been violated if a
  single port carried all five operations.

`grep` confirmed **zero** `new Sqlite\w+Repository(` inside any
`modules/*/application/use-cases/*.ts`. Wiring is exclusively in
`composition/wiring/*.ts`.

---

## B. Type-safety

- `grep -rn ": any\|as any\|<any>" code/src/composition` → **0 hits**.
- `grep -rn "ts-ignore\|ts-expect-error\|ts-nocheck" code/src/composition`
  → **0 hits**.
- `grep -rn ": any\|as any\|<any>" code/src/` → 4 hits, **all inside
  prose JSDoc** (`...any other thrown exception...`,
  `...catch any further...`); none is a type annotation, cast or
  generic. Verified on each file.
- `cd code && npx tsc --noEmit` → **EXIT=0**.
- `cd code && npm run lint` → **EXIT=0** (and the lint command is
  `eslint src --max-warnings 0`).
- Every adapter method declares an explicit `Promise<X>` or `X`
  return type; private helpers do the same.

---

## C. EventBusPublisher

- Implements `EventPublisher` from `shared/application/ports/event-publisher.port.ts`.
- Accepts `DomainEvent` (the canonical shared type from
  `shared/domain/types/domain-event.ts`), never `any` / `unknown`.
- Both methods return `Promise<void>` and just forward to the bus.
- Constructor takes `DomainEventBus` (the interface), not the
  concrete `InMemoryEventBus`. DIP respected.
- The publisher does not subscribe; subscribe lives only on
  `DomainEventBus` (ISP respected).

---

## D. DestroyEncryptionFacade signature change

- The driven port at
  `modules/workspace/application/ports/out/destroy-encryption-facade.port.ts`
  carries `passphrase: string` (typed, non-optional).
- `ChangeModeUseCase` enforces `input.passphrase !== null && length > 0`
  before invoking the facade and forwards the typed string at line
  `change-mode.use-case.ts:111`. No `any`, no cast.
- `DestroyEncryptionFacadeAdapter` wraps the string in
  `Passphrase.from(...)` at the boundary and unwraps the
  `Result<void, KeyValidationFailedError | EncryptionNotInitializedError>`
  the use case returns; recoverable failures throw the typed error so
  the workspace use case aborts before flipping the aggregate's mode.

---

## E. ContextLayerKind mapping

- `WIRE_TO_DOMAIN_LAYER_NAME: Readonly<Record<LayerNameWire, ContextLayerKindValue>>`
  and the inverse `DOMAIN_TO_WIRE_LAYER_NAME` are both
  `Readonly<Record<...>>` literals frozen with `Object.freeze`.
- `LayerNameWire` and `ContextLayerKindValue` are both string-literal
  unions — the compiler enforces exhaustiveness on both sides.
- No `any` / `unknown` anywhere in the mapping or in
  `translateLayerOverrides`.

---

## F. CLI facade adapters

- 18 wired adapters (`Cli*FacadeAdapter`) plus 5 typed pending stubs
  (`Pending*Facade`).
- Each adapter takes the relevant use case (and `DetectWorkspace`
  when the wire DTO carries a `rootPath` instead of a workspace id)
  by constructor.
- `CliInstallHookFacadeAdapter`, `CliSanitizeFacadeAdapter`,
  `CliAuditFacadeAdapter`, `CliExportFacadeAdapter`,
  `CliImportFacadeAdapter`, `CliWipeFacadeAdapter`,
  `CliStatsFacadeAdapter`, `CliCuratorRunFacadeAdapter`,
  `CliCuratorLogFacadeAdapter` correctly fold the use case's
  `Result<...>` channels into typed wire outcomes; severity / mode
  translation is documented in JSDoc.

---

## G. Persistent stubs

The 5 persistent stubs (`PendingExportKeyFacade`, `PendingRekeyFacade`,
`PendingAddKeyFacade`, `PendingUninstallHookFacade`,
`PendingServerFacade`) all reject with `CliFacadeNotImplementedError`,
which carries:
- A typed `code: "composition.cli-facade-pending"` (`readonly`,
  string literal type).
- A `name: "CliFacadeNotImplementedError"`.
- A constructor that takes `(facade, reason)` and produces a
  deterministic message. The CLI's `RunCliCommandUseCase` can map
  this onto a stable exit code.

The mcp-server side has the analogue `McpFacadeNotImplementedError`
with `code: "composition.mcp-facade-pending"` (also `readonly`).

Each stub's reason is documented in JSDoc with a pointer to the
v0.5+ work item that will land the real flow (multi-key / uninstall /
sub-process orchestration).

---

## Critical findings

**None.**

## Verdict

**APPROVED.** SOLID lineamiento 1.4 and type-safety 1.6 are both clean
across `code/src/composition/{facades,event-bus,wiring}` and the
upstream changes (`ChangeModeUseCase` passphrase signature,
`DestroyEncryptionFacade` port, `EventPublisher` shared port).
