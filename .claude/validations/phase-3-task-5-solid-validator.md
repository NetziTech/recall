# solid-validator — Phase 3 / Task 3.5 (workspace + cli application + infrastructure)

- **Validator**: solid-validator
- **Scope**: `code/src/modules/workspace/{application,infrastructure}/`, `code/src/modules/cli/{application,infrastructure}/`
- **Verdict**: **APPROVED**

## A. Type-safety baseline (lineamiento 1.6)

| Check                                                                | Result   |
|----------------------------------------------------------------------|----------|
| `grep -rEn ": any\|as any\|<any>\|Array<any>\|Promise<any>"` (scope) | 0 hits   |
| `grep -rEn "@ts-ignore\|@ts-nocheck\|@ts-expect-error"` (scope)      | 0 hits   |
| `cd code && npx tsc --noEmit`                                        | EXIT=0   |
| `cd code && npm run lint` (`eslint src --max-warnings 0`)            | EXIT=0   |
| Explicit return types on every method/function in scope              | OK       |
| Discriminated union `CliInvocation` with compile-time exhaustiveness | OK (_Exhaustive type-level conditional + `_CLI_INVOCATION_CATALOG_IS_EXHAUSTIVE` constant guard against catalog drift) |

Boundary parsing: `NodeWorkspaceFilesystem.readConfig` and `writeConfig` parse / merge raw JSON via Zod (`PERSISTED_CONFIG_SCHEMA`); no `as Type` of unknown JSON. `SqliteDatabaseBootstrap.parseSchemaVersion` and `classifyErrorAsExitCode` narrow `unknown` defensively.

## B. SOLID

### SRP
- 6 workspace use cases, 1 responsibility each (initialize/detect/unlock/lock/changeMode/healthCheck). 20 CLI handler classes, each owns 1 catalog command. `CliEntrypoint` orchestrates parse→dispatch→exit; `CommanderCliParser` produces a `CliInvocation`; neither encroaches on use-case territory.
- `RunCliCommandUseCase` has a single responsibility: build the `Map<command, ErasedCommandHandler>` and dispatch. ~78 LOC. No god-class.

### OCP
- CLI dispatch is **data-driven via `Map`**, not `if/else (kind === ...)`. Adding a new command is purely additive: extend the `CliInvocation` union, write a handler, register it.
- `_Exhaustive` and `_CLI_INVOCATION_CATALOG_IS_EXHAUSTIVE` give a compile-time guarantee the union covers `CommandNameValue`. Drift fails to typecheck.
- `ChangeModeUseCase` branches on `becomingEncrypted` / `leavingEncrypted` (two paths, not 6); the aggregate's state machine carries the prohibition rule (`encrypted→shared` rejected at `Workspace.changeMode`), so the use case stays small.
- `HealthCheckUseCase` chains 6 probes; each probe is a sequential block with its own try/catch. Acceptable: probes are heterogeneous and the order matters (short-circuit on workspace.exists / parseable). Not a switch on a discriminator.

### LSP
- The four `*EncryptionFacade` ports model expected (business) failures via discriminated outcome unions (`UnlockEncryptionFacadeOutcome`, `LockEncryptionFacadeOutcome`) and reserve exceptions for unrecoverable infra failures. Subtypes thus cannot widen exception surface. Documented in JSDoc on each port.
- Use cases narrow outcomes via discriminator (`outcome.unlocked`, `outcome.locked`); no impl is forced to throw on expected failure.

### ISP
- TTY split into `Stdout` / `Stderr` / `Prompt` (1 / 1 / 3 methods). Non-interactive handlers depend only on what they use.
- `EmbedderProbe` is a tight wrapper around shared `Embedder` exposing only `probe()`. Confirms the JSDoc "shrink the surface" rationale.
- Largest port surface in scope: `WorkspaceFilesystem` (4 methods); `Prompt` (3); every other port has 1 method. None exceeds the 5-method heuristic.

### DIP
- 0 `new <Adapter>(...)` calls inside `application/use-cases/`. The only `new` in handlers is `new InvalidWorkspacePathArg(...)` (a domain error) and `new <DomainError>(...)`.
- Every use case constructor takes ports/adapters as parameters. Every handler takes `*Facade` ports + (optional) `Prompt` + `Logger`. Wiring is the composition root's job (Phase 4).
- `RunCliCommandUseCase` receives a `readonly ErasedCommandHandler[]` plus a `Logger`; no handler is instantiated inside.

## C. `.port.ts` convention (lineamiento 3.1)

- Workspace ports: 6 in / 7 out = 13. CLI ports: 2 in / 6 out = 8. **Total 21**, all under `application/ports/{in,out}/`, all suffixed `*.port.ts`. Zero non-`.port.ts` files in `ports/` (excluding `index.ts` barrels). Confirmed via `find … -type f ! -name "*.port.ts" ! -name "index.ts"` → empty.

## D. "Un puerto + handlers" decision (CLI)

The decision (single `RunCliCommand` driving port + 20 `CommandHandler<TCommand>` classes) is sound under SOLID:
- **SRP** preserved: one orchestrator + one class per command.
- **OCP** preserved: `Map`-based dispatch; no central switch.
- **DIP** preserved: handlers receive facade ports; the use case receives handlers; `eraseHandler` provides a typed adapter that narrows via `Extract<CliInvocation, { command: TCommand }>` with a runtime guard, no `as any`.
- **LSP** preserved: `ErasedCommandHandler.handle` matches `CommandHandler<TCommand>.handle` after Extract narrowing; the runtime guard in `eraseHandler` enforces the same precondition.

## E. Workspace use cases — specific checks

- **`LockWorkspaceUseCase`**: delegates teardown to `LockEncryptionFacade.lock` (which wipes on-disk + in-process key per its contract), THEN calls `workspace.lock(...)`. Real resource teardown via the facade, not just an in-memory state flip. OK.
- **`ChangeModeUseCase`**: respects D-103 conservative transitions. The `encrypted→shared` prohibition is enforced inside `Workspace.changeMode` (aggregate state machine). The use case orchestrates side effects (init/destroy facade), invokes the aggregate AFTER, then persists. Side-effect ordering matches the JSDoc contract. `assertReadyForUse` gates leaving `encrypted`. OK.
- **`InitializeWorkspaceUseCase`**: idempotent rehydrate path checks mode equality, reuses `Workspace.rejectReinitialization`. Encrypted-mode passphrase preconditions enforced via `InvalidInputError`. Clean ordering (mkdir → encryption slice → config.json → DB bootstrap → gitignore). OK.
- **`DetectWorkspaceUseCase`**: pure orchestration over `WorkspaceDetector` + `WorkspaceFilesystem`. OK.
- **`UnlockWorkspaceUseCase`**: distinguishes `key-validation-failed` (→ `WorkspaceLockedError`) from `not-encrypted` (→ warn + no-op). OK.
- **`HealthCheckUseCase`**: `gitignore.consistent` is `skipped` with a tracked TODO (TODO-WS-1 / v0.5). Acceptable since adding a `readGitignore` method to the port doubles its surface for one cosmetic check; the JSDoc documents the trade-off.

## Findings (zero critical)

No violations.

## Notes (informative)

- `RunCliCommandUseCase.classifyErrorAsExitCode` is a string-code lookup table; this is a deliberate cross-module error-code → exit-code mapping that lives at the CLI boundary. It is NOT a dispatch on a discriminator; it is **boundary translation**. Fine under OCP; new error codes are added by extending the table (the table itself is the extension point).
- `commander-cli-parser.ts` builds the `Command` object lazily inside `parse()` per call (constructed once per invocation). For a CLI binary this is fine; if it ever moves to a long-lived REPL the cost would surface. Out of scope for this task.

## Verdict

**APPROVED**. Zero `any`, zero `ts-*` directives, tsc + ESLint clean, SOLID principles respected with discriminated-union dispatch, `.port.ts` convention applied to all 21 new ports, the "un puerto + handlers" decision does not erode SRP/OCP/DIP. Phase 3 last task ratifies cleanly from the SOLID + type-safety perspective.
