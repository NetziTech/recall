# Release Notes — v0.1.2 (stable)

> 2026-05-03. **First stable release of `@netzi/recall`.** Promoted
> from `0.1.2-beta.6` to the `latest` dist-tag after a 7-beta cycle
> that closed 8 bugs surfaced by the project's own dogfood loop.
> `0.1.0` and `0.1.1` are hard-deprecated. **No code changes vs
> `0.1.2-beta.6`** — this release is the channel promotion + npm
> deprecation of the older `latest` versions.

## TL;DR

```bash
npm install -g @netzi/recall          # ← stable, recommended
# or
npm install -g @netzi/recall@latest   # explicit
```

The `@beta` channel is now **paused**: future fixes go to
`0.1.3-beta.*` if they need a cooling period, or directly to
`0.1.3` for trivial fixes.

| Item | Value |
|---|---|
| Channel | `latest` (was `beta` for the entire `0.1.2-beta.*` cycle) |
| Tag | `v0.1.2` |
| Tarball | ~6.6 MB, 16 archivos (sin cambios vs beta.6) |
| Tests | **2560 passing** in 212 files |
| Coverage SonarQube | overall 96.4%, ratings A/A/A |
| Issues at release | **0** open |

## Migration

| You're on | Recommended action |
|---|---|
| `@netzi/recall@0.1.0` (deprecated) | `npm install -g @netzi/recall@latest` (now resolves to 0.1.2) |
| `@netzi/recall@0.1.1` (deprecated) | Same — `latest` now points at 0.1.2 |
| `@netzi/recall@0.1.2-beta.*` | `npm install -g @netzi/recall@latest`. The beta channel is paused; staying on a beta is fine but you stop getting fixes |
| Fresh install | `npm install -g @netzi/recall` |

Workspaces created on any beta of the `0.1.2-beta.*` cycle are
**fully forward-compatible** with `0.1.2` — schema_version 8, same
config.json shape, same wire contracts.

## What this stable consolidates (the full beta cycle)

The `0.1.2-beta.*` cycle ran from 2026-04-28 (beta.0) to
2026-05-03 (beta.6). Every release surfaced exactly one bug from
real-world dogfood that the previous release exposed:

| Beta | Date | Bugs closed | Issue / PR |
|---|---|---|---|
| `0.1.2-beta.0` | 2026-04-28 | preventive cut after Phase-9 dogfood discovery | n/a |
| `0.1.2-beta.3` | 2026-05-01 | **B-MCP-2** (mem.health hardcoded) + **B-MCP-3** (worker not instantiated) + **B-MCP-4** (decision content silently dropped) + **B-MCP-5** (min_score) | [#17](https://github.com/NetziTech/recall/pull/17), [#18](https://github.com/NetziTech/recall/pull/18), [#19](https://github.com/NetziTech/recall/pull/19), [#20](https://github.com/NetziTech/recall/pull/20) |
| `0.1.2-beta.4` | 2026-05-02 | **B-MCP-7** (worker burns retries during fastembed cold-start) | [#27](https://github.com/NetziTech/recall/pull/27) |
| `0.1.2-beta.5` | 2026-05-02 | **B-MCP-8** (mem.recall returns hits=0 with candidates>0) | [#33](https://github.com/NetziTech/recall/pull/33) |
| `0.1.2-beta.6` | 2026-05-03 | **carryover**: `serverInfo.version` reported stale literal | [#37](https://github.com/NetziTech/recall/pull/37) |
| **`0.1.2` (this)** | 2026-05-03 | channel promotion + npm deprecation of 0.1.0/0.1.1 | n/a |

Each fix was caught by the dogfood loop (the project using its own
MCP server against its own `.recall/recall.db`), validated by a
post-publish smoke against either the existing dogfood DB or a
fresh-install workspace, then promoted only after the smoke
passed end-to-end.

## What's in `0.1.2` (vs `0.1.1`)

For users coming from the old `latest` (`0.1.1`), the cumulative
changes are:

### Bug fixes — `mem.health` returns real state (B-MCP-2)
The handshake used to return `total_entries=0`, `mode="shared"`,
and `embedding_queue_pending=0` regardless of the actual workspace
state. Now reads live values from the database via a dedicated
`WorkspaceStateReader` port + `SqliteWorkspaceStateReader` adapter.
`mode` is the configured value, `entries_by_kind` is populated from
real counts, and the embedder + active session info reflect reality.

### Bug fixes — embedding worker actually runs (B-MCP-3 + B-MCP-7)
The `AsyncEmbeddingWorker` was implemented and unit-tested but
**never instantiated in production wiring** — `embedding_queue`
filled up, no vectors were computed, and `mem.recall` fell through
to BM25-only forever. Beta.3 wired it; beta.4 then taught the
worker to tolerate fastembed's ~4.3 s cold-start without burning
the per-item retry counter (transport-level errors back off the
batch via exponential delay; per-item errors keep their counter).
A new `recall reset-queue` CLI command recovers workspaces that
got stuck in the pre-fix permanent-failure state.

### Bug fixes — decision content persistence (B-MCP-4)
`mem.remember` with `kind: "decision"` used to silently drop the
`content` field — the wire schema documented it but no DB column
backed it. Migration 008 adds `decisions.content TEXT NOT NULL`
with a backfill from `rationale`, the `decisions_fts` virtual
table is rebuilt with the new column, and `RecordDecisionUseCase`
+ `SqliteDecisionRepository` + import/export all carry the field
end-to-end. Round-trip (`remember` → `recall`) preserves it.

### Bug fixes — recall always returns hits when there are candidates (B-MCP-8)
The post-rank token-budget filter used to return `[]` whenever the
top-ranked entry alone exceeded `max_tokens`, even when smaller
candidates further down would have fit. The fix:
1. **Always include the top-ranked hit** (one slightly-oversized
   result is strictly more useful than no result).
2. **`continue` on overflow** instead of `break` (skip the big hit,
   keep looking — smaller candidates behind it still surface).
3. **Default `max_tokens` 4000 → 8000** for consistency with
   `mem.context`.

### Bug fixes — `serverInfo.version` reflects the binary
The handshake `initialize.serverInfo.version` was a hardcoded
literal that drifted across beta.4 and beta.5. Now read from
`package.json` at boot via `resolvePackageVersion()`. Validates
`name === "@netzi/recall"` so the resolver never returns e.g.
vitest's own `1.1.1` when running under the test runner. Returns
the `0.0.0-unknown` sentinel if no candidate parses cleanly so
the bootstrap never blocks on missing metadata.

### Feature additions — `mem.recall` `min_score` post-hoc filter (B-MCP-5)
The wire schema now accepts `min_score: number` (range 0..1).
Filter applied post-hoc in `RecallMemoryFacadeAdapter` so
`total_candidates` continues to reflect the pre-filter pool —
callers can detect "found 12 candidates, kept 3 after threshold"
in a single response.

### Feature additions — `recall reset-queue [--threshold <n>]`
Recovery CLI for users on `<= 0.1.2-beta.3` whose
`embedding_queue` got poisoned by the pre-B-MCP-7 worker. Atomic
per-workspace SQL UPDATE clears `attempts` and `last_error` on
every queue row at or above the threshold (default 5 = the
worker's `MAX_ATTEMPTS`). Idempotent: running on a healthy queue
is a no-op. Bundled with the `0.1.2` release.

### Other improvements
- Pre-existing tests tightened to **VALORES not SHAPE**: replaced
  `toBeLessThanOrEqual(N)` and `typeof === "string"` with
  exact-value assertions in 3 spots that had been silently
  masking the underlying bugs.
- Bootstrap helpers `collectFsCandidates(builder)` +
  `readPackageVersionField(candidate)` extracted for reuse —
  both `resolveDefaultMigrationsDir` and `resolvePackageVersion`
  share the same anchor-walk logic, mirroring the B-CLI-5
  pattern.

## Outstanding caveats (carried forward)

These are tracked for the v0.5+ roadmap; they don't block normal
use:

- `encryption_status="locked"` is the conservative default for
  workspaces in `encrypted` mode (a runtime-only flag is set on
  successful unlock; persisted state stays locked across opens).
- `size_bytes.vectors_db = 0` (always). The vec0 virtual table
  lives inside `recall.db`; there is no separate vectors file.
  Wire field preserved for back-compat with `0.1.0` clients.
- Two upstream `tar` highs via `fastembed` remain `wontfix` per
  ADR-004 (`docs/12 §1.5.4`). The fastembed download path is not
  user-input-reachable, only GCS-tarball-reachable, so the
  wontfix rationale stands. Reapertura prevista en v0.5 si
  fastembed publica con `tar@7`.

## Engineering metrics (cumulative for the cycle)

- **2560 tests** in 212 files (was 2421 at MVP, +139 across the
  beta cycle).
- **Coverage SonarQube** 96.4% overall, ratings A/A/A.
- **0 bugs** / **0 vulnerabilities** / **0 blockers** /
  **0 critical violations** on every release of the cycle.
- **Cero `any`**, cero `as any`, cero `// @ts-ignore` en ~61.3k
  LOC de `code/src/`.
- **8 issues closed** end-to-end via dogfood + smoke loop:
  B-MCP-1 (Phase-8 patch), B-MCP-2/3/4/5 (Phase-11), B-MCP-7
  (Phase-13), B-MCP-8 (Phase-15), serverInfo.version carryover
  (Phase-15 follow-up).
- **9 PRs in the cycle**: 4 fix PRs + 4 release PRs +
  1 docs-close PR (#33, #34, #35, #36, #37, #38, #39, plus #17-20
  earlier).

## Acknowledgements

- The dogfood loop. Every bug surfaced from real use against the
  project's own `.recall/recall.db`. Synthetic tests caught
  shape regressions; only dogfood caught value regressions.
- The "VALUES not SHAPE" rule (Phase-9 lesson). It doesn't catch
  bugs proactively but it stops them from escaping once they're
  on the table — three regressions in this cycle were silently
  passing `typeof === "string"` / `toBeLessThanOrEqual(N)` until
  the tightening landed.
- SonarQube quality gate as a second reviewer. Round 2 of PR #37
  caught an inline duplicate helper (S4144) that nobody noticed
  during the first push — refactoring that out cleaned the call
  sites measurably.

## Path to v0.5+

The next release line opens up the deferred features. Planned
items (in HANDOFF §6.20 → "Siguiente accion concreta" #3 → moved
into HANDOFF roadmap section):

1. **Multi-key envelope flow** — `export-key`, `rekey`, `add-key`
   tools (3 stubs `Pending*` deferred to v0.5).
2. **Encrypted cold start** target `<500ms` via OS keychain key
   cache (current SLO `<1500ms`).
3. **Performance hardening at >10K entries**: applyDecay batch,
   PruneLowConfidence transaction, Vec0SimilarityFinder lookup,
   db.prepare cache hot-path.
4. **Defensive hardening**: atomic gitignore write+rename,
   chmod 0o600 sobre `recall.db`, redact path en err.message,
   StdioJsonRpcServer buffer cap.
5. **Cerrar 2 highs upstream tar/fastembed** (ADR-004 reopen
   criteria).
6. **Wire-schema cleanup** — rename `size_bytes.memoria_db` →
   `size_bytes.recall_db` (deuda back-compat documentada).
