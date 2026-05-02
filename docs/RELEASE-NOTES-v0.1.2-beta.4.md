# Release Notes — v0.1.2-beta.4

> 2026-05-02. **B-MCP-7 closed.** The embedding worker now tolerates
> the fastembed cold-start without burning per-item retry budget, and
> a new `recall reset-queue` CLI command recovers workspaces poisoned
> by the pre-fix worker. Last beta on this cycle; the next release is
> `v0.1.2` stable promoting the `latest` dist-tag.

## TL;DR

The single defect surfaced in the post-publish smoke of `v0.1.2-beta.3`
([issue #24](https://github.com/NetziTech/recall/issues/24)) is fixed
and shipped behind `npm install -g @netzi/recall@beta`:

| Issue | Severity | Tag | PR | Outcome |
|---|---|---|---|---|
| [#24](https://github.com/NetziTech/recall/issues/24) | high | B-MCP-7 | [#27](https://github.com/NetziTech/recall/pull/27) | Typed error union (`EmbedderUnavailableError` vs `EmbedFailedError`) lets the worker discriminate transport-level outages from per-input rejections. Transport failures abort the batch with exponential back-off WITHOUT bumping per-item attempts; per-input failures keep their per-item retry counter. New `recall reset-queue` CLI command clears `attempts >= 5` rows so workspaces poisoned by the pre-fix worker (which burned through 5 retries in milliseconds during fastembed cold-start) can recover without DB surgery. |

## How to install

```bash
# beta channel (this release)
npm install -g @netzi/recall@beta

# latest stable (deprecated 0.1.1, kept as warning until v0.1.2 stable lands)
npm install -g @netzi/recall@latest
```

After `v0.1.2` stable ships, the `latest` dist-tag will move to
`0.1.2` and `0.1.1` will be hard-deprecated.

## How to recover from B-MCP-7 on an existing workspace

If your workspace was opened with `<= v0.1.2-beta.3` and you see
`embedding_queue` rows stuck at `attempts=5`:

```bash
# Stop any running recall-server first.
recall reset-queue --workspace /path/to/your/repo
# Output:
#   Cola de embeddings restablecida.
#     Filas restablecidas: 32
#     Umbral aplicado (attempts >=): 5
#     El worker re-intentara estas entradas en su proximo drain.
```

The next `recall-server` start will drain the queue normally — the
worker now tolerates the fastembed cold-start that previously burned
the retry budget.

`--threshold <n>` overrides the default of 5 (the worker's
`MAX_ATTEMPTS`).

## Highlights of the fix

### Domain — typed error union

Two new errors live in `modules/retrieval/domain/errors/`:

- **`EmbedderUnavailableError`** — transport-level: model not loaded
  yet (cold-start in flight), network down, ONNX cache corrupt. The
  whole embedder is unusable for every input until it recovers.
  Carries an optional `retryAfterMs` hint.
- **`EmbedFailedError`** — per-input rejection: the embedder rejected
  THIS specific text (dimension mismatch, malformed input, etc.).
  Other inputs may still succeed.

Both extend `RetrievalDomainError` so callers route them with a
single `instanceof` switch.

### Adapter — translate shared errors at the seam

`RawEmbedderAdapter` (the bridge between the cross-module
`shared/application/ports/embedder.port.ts` and the retrieval domain
`Embedder` port) translates the shared `EmbedderError` codes onto the
new domain types:

| Shared `EmbedderError.code` | Domain error |
|---|---|
| `embedder.initialisation-failed` | `EmbedderUnavailableError` |
| `embedder.not-initialised` | `EmbedderUnavailableError` |
| `embedder.embed-failed` | `EmbedFailedError` |
| `embedder.dimension-mismatch` | `EmbedFailedError` |
| any other cause (non-`EmbedderError`) | `EmbedFailedError` (conservative) |

Translating at the adapter respects the Hexagonal direction-of-
dependency rule — the retrieval domain never imports
`shared/infrastructure/errors/`.

### Use case — abort the batch on transport failure

`EmbedAndPersistUseCase.drainBatch` reads the typed error and:

- **`EmbedderUnavailableError`**: marks the batch as
  `embedderUnavailable: true`, captures the `retryAfterMs` hint,
  pushes the rest of the batch to `skipped[]`, and **does NOT call
  `recordFailure(...)`** on any item (per-item attempts stay at 0).
- **`EmbedFailedError`** (or unknown): bumps per-item attempts via
  `recordFailure(...)` exactly as before.

The use case result grew three new fields:
`embedderUnavailable`, `unavailableRetryAfterMs`, `skipped`.

### Worker — exponential back-off on transport failure

`AsyncEmbeddingWorker.runDrain` reads the new flag and applies
exponential back-off (1 s → 2 s → 4 s → 8 s → 16 s, capped at 60 s
by default; honours the per-call hint when present). The streak
resets on the first batch that completes without an unavailable
signal so a transient outage doesn't permanently lengthen the poll
interval.

The worker was also refactored via extract-method (8 small private
methods) to keep cognitive complexity low — both `runDrain` and
`drainBatch` are now flat orchestrators.

### CLI — `recall reset-queue [--threshold <n>]`

Recovery for users on `<= v0.1.2-beta.3`. Atomic per-workspace
SQL UPDATE clears `attempts` and `last_error` on every queue row
above the threshold. Idempotent: running on a healthy queue is a
no-op. The new use case lives at
`retrieval/application/use-cases/reset-embedding-queue.use-case.ts`.

## Tests

- New integration test
  `tests/integration/O-embedder-cold-start.test.ts` (2 cases):
    1. Asserts `attempts` stays at 0 throughout a simulated fastembed
       cold-start window (the regression a pre-fix worker would fail
       — all 3 rows would land at `attempts=5` in milliseconds).
    2. Asserts the `recall reset-queue` recovery path: simulates a
       perma-failed row (`UPDATE ... attempts=5`), runs the use
       case, asserts `attempts=0` and the worker drains it on the
       next iteration.
- 6 new unit tests on `EmbedAndPersistUseCase` (B-MCP-7 unavailable
  branches, mixed scenarios with permanent-failure rows, non-Error
  rejection coverage).
- 6 new unit tests on `AsyncEmbeddingWorker` (initial back-off,
  exponential ramp, max cap, per-call hint, streak reset on
  recovery, non-Error rejection).
- 6 new unit tests on `RawEmbedderAdapter` (typed error translation
  matrix: 4 EmbedderError codes + non-EmbedderError + embedBatch
  path).
- 3 new unit tests on `SqliteEmbeddingQueueRepository.resetPermanentFailures`
  (above-threshold reset with VALUE assertions, no-ops, workspace
  scoping).
- 4 new unit tests on `ResetEmbeddingQueueUseCase` (defaults, custom
  threshold, frozen result, zero-row case).
- 4 new unit tests on `ResetQueueCommandHandler` (forward inputs,
  custom threshold, zero-row message, command discriminator).
- 3 new unit tests on `CommanderCliParser` for `reset-queue`
  (no-flag, positive integer, invalid input).

**Total: 2553 tests passing in 213 files** (was 2519 in 208 at
beta.3).

## Why this escaped beta.3

The integration test `L-embedding-worker-drains.test.ts` from
beta.3 used a synchronous stub embedder (`StubRawEmbedder` that
returned immediately). It validated the **shape** of the worker
contract (drains queue → metadata grows) but NOT the cold-start
**values** (`attempts` stays at 0 during the loading window).

The Phase-9 "VALUES not SHAPE" methodology was applied correctly to
the contract; the missing piece was a test that simulates the
`FlagEmbedding.init()` 4.3 s window. The new
`O-embedder-cold-start.test.ts` codifies this — its
`StubRawEmbedder.nextErrors[]` queue lets the test enqueue several
`EmbedderError.initialisationFailed` rejections to simulate the
cold-start without actually downloading the 30 MB ONNX model.

The same `nextErrors[]` mechanism is reusable for any future
cold-start / transport-failure regression.

## Engineering metrics

- 5/5 EXIT=0 on every PR
  (`typecheck` + `lint` + `lint:tests` + `validate:modules` +
  `build` + `test`).
- **2553 tests passing in 213 files** (was 2519 in 208 at beta.3).
- SonarQube quality gate `MCP Memoria Strict` PASSED on the final
  PR (Reliability A, Security A, Maintainability A, 0 bugs /
  0 vulnerabilities / 0 blockers / 0 critical violations,
  coverage on new code 99.8%, overall 96.4%, sqale_debt_ratio
  0.0% on new code).
- The first push of PR #27 tripped the gate on 4 violations
  (1 critical S3776 cognitive complexity in `drainBatch`, 3 minor
  S7735 negated conditions). The fix push refactored
  `drainBatch` via extract-method (8 named helpers, complexity
  17 → ≤ 5) and flipped the negated conditions; the gate
  recovered cleanly with all 14 conditions passing.
- Cero `any`, cero `as any`, cero `// @ts-ignore`.

## Process highlights

- **Pre-commit hooks shipped to `.claude/settings.json`** (PR #26).
  Three `PreToolUse > Bash` hooks per-repo:
    1. `block-protected-commit.sh` — aborts `git commit` on
       `main`/`develop`.
    2. `block-protected-push.sh` — aborts `git push` from `main`/
       `develop` or whose destination is `main`/`develop`.
    3. `typecheck-on-commit.sh` — runs `npm run typecheck` when
       commits stage anything under `code/src/` (cero overhead on
       docs-only commits).
  These ataja the two flow violations recorded in HANDOFF §6.17
  D-1209 (commits to `main` by error) before they reach the GitHub
  branch protection.

## Outstanding caveats

- `encryption_status="locked"` is still the conservative default for
  workspaces in `encrypted` mode (B-MCP-2 caveat carried forward
  from beta.3).
- `size_bytes.vectors_db = 0` (always). The vec0 virtual table lives
  inside `recall.db`; there is no separate vectors file. Wire field
  preserved for back-compat with v0.1.0 clients.
- Two upstream `tar` highs via `fastembed` remain `wontfix` per
  ADR-004 (`docs/12 §1.5.4`). With B-MCP-7 closed, the worker
  exercises the fastembed download path in production for the
  first time — the path is still not user-input-reachable, only
  GCS-tarball-reachable, so the wontfix rationale stands.

## Path to v0.1.2 stable

If the post-publish smoke of `v0.1.2-beta.4` (against the dogfood
DB, with `recall reset-queue` first to clear the perma-failed rows
left by beta.3) shows the worker draining the queue and semantic
recall recovering with paraphrased queries, we promote `0.1.2` to
the `latest` dist-tag and hard-deprecate `0.1.1`. If new bugs
surface, they go into individual issues + PRs and ship as
`v0.1.2-beta.5+` until the cycle settles.

## Acknowledgements

- The bug was caught by the post-publish smoke session that
  exercised the (previously-fixed) embedding worker against the
  dogfood `recall.db` for the first time. The lesson reinforces
  Phase-9: ship a beta, dogfood it, fix what surfaces.
- Three of the four SonarQube violations on the first PR push
  (the negated conditions) were avoidable with prior knowledge of
  the rule. They are now codified in HANDOFF §6.18 lessons #4 and
  #5 so the next reviewer / contributor knows to flip ternaries
  and use extract-method early.
