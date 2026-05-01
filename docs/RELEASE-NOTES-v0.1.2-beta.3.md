# Release Notes — v0.1.2-beta.3

> 2026-05-01. **All four Phase-9 dogfood defects closed.** Last beta
> on this cycle; the next release is `v0.1.2` stable promoting the
> `latest` dist-tag.

## TL;DR

Every defect surfaced in the Phase-9 dogfood (`v0.1.2-beta.0` cut)
is now fixed and shipped behind `npm install -g @netzi/recall@beta`.
Four PRs, four bugs, four `Closes #N` commits squashed onto
`develop`:

| Issue | Severity | Tag | PR | Outcome |
|---|---|---|---|---|
| [#2](https://github.com/NetziTech/recall/issues/2) | **critical** | B-MCP-3 | [#17](https://github.com/NetziTech/recall/pull/17) | `AsyncEmbeddingWorker` wired into the mcp-server bootstrap. Embedding queue drains in the background; semantic recall works end-to-end. |
| [#1](https://github.com/NetziTech/recall/issues/1) | high | B-MCP-2 | [#18](https://github.com/NetziTech/recall/pull/18) | `mem.health` reads real workspace state via a new `WorkspaceStateReader` outbound port + SQLite adapter; eight hardcoded fields replaced. |
| [#4](https://github.com/NetziTech/recall/issues/4) | low | B-MCP-5 | [#19](https://github.com/NetziTech/recall/pull/19) | `mem.recall` accepts `min_score: number (0..1)` post-hoc filter; `total_candidates` reflects the pre-filter pool. |
| [#3](https://github.com/NetziTech/recall/issues/3) | **critical** | B-MCP-4 | [#20](https://github.com/NetziTech/recall/pull/20) | New `decisions.content` column (migration 008), aggregate + repo + facade carry the field end-to-end; recall returns the actual content the client supplied, no longer silently swapped with rationale. |

Cascade defect **B-MCP-6** (insert-time dedup needed the embedder)
closes automatically with B-MCP-3.

## How to install

```bash
# beta channel (this release)
npm install -g @netzi/recall@beta

# latest stable (deprecated 0.1.1, kept as warning until v0.1.2 stable lands)
npm install -g @netzi/recall@latest
```

After `v0.1.2` stable ships, the `latest` dist-tag will move to
`0.1.2` and `0.1.1` will be hard-deprecated.

## Highlights per fix

### B-MCP-3 — embedding worker actually runs (PR #17)

`buildRetrievalWiring` now constructs `AsyncEmbeddingWorker` bound to
the workspace id and exposes it on the `RetrievalWiring`. The
`mcp-server-entrypoint.ts` calls `worker.start()` after the bootstrap
returns and `await worker.stop()` in the SIGINT/SIGTERM handler
BEFORE the database closes, so an in-flight drain never races the
shutdown. The integration test
`L-embedding-worker-drains.test.ts` validates VALUES — three
records enqueue 3 rows, the worker drains to 0, and
`embedding_metadata` grows by 3 with the correct dimension.

### B-MCP-2 — mem.health real state (PR #18)

New `WorkspaceStateReader` outbound port lives in
`mcp-server/application/ports/out/`; the SQLite adapter
(`composition/queries/sqlite-workspace-state-reader.ts`) joins live
state across `decisions/learnings/entities/tasks/turns/sessions/
curator_runs/embedding_queue/workspace_config` and `fs.statSync` the
DB file. The eight formerly-hardcoded wire fields now reflect
reality. The `M-mem-health-real-state.test.ts` integration test
seeds known state and asserts every field, plus the documented
limitation that `encryption_status="locked"` for encrypted
workspaces is the conservative default until a runtime unlock probe
ships.

### B-MCP-5 — mem.recall min_score (PR #19)

`RecallInputSchema` accepts `min_score: z.number().min(0).max(1)
.optional()`. `RecallMemoryFacadeAdapter` filters the ranked
results post-hoc; `total_candidates` continues to reflect the pre-
filter pool so callers can tell when their threshold is too
aggressive. Documented in `docs/02 §4.3`.

### B-MCP-4 — decisions content (PR #20, **Option B**)

The wire `content` field documented in `docs/02 §4.4` was silently
dropped because the `decisions` table had no `content` column. The
fix is **Option B from the comparative ADR** — preserve the
documented wire contract by adding the column rather than dropping
the field from the wire schema. Stability over velocity.

- Migration `008__decisions-content.sql` adds
  `content TEXT NOT NULL DEFAULT ''`, backfills existing rows with
  `content = rationale` (preserves searchability across legacy data),
  rebuilds `decisions_fts` to include the new column, and updates
  triggers.
- New `DecisionContent` VO (max 50,000 chars vs Rationale's 5,000 —
  content is the long-form body where rationale is the short why).
- `Decision` aggregate, `RecordDecision` port + use case,
  `SqliteDecisionRepository`, `JsonMemoryExporter/Importer`,
  `SqliteMemoryProjectionRepository` (recall side), and
  `RememberFacadeAdapter` all carry the field end-to-end.
- The handoff and JSON importer use `rationale` as a fallback for
  pre-fix snapshots.
- The integration test `N-decision-content-roundtrip.test.ts`
  validates the full round-trip: insert via `mem.remember` with
  rationale != content, assert SQL row has both intact, recall a
  token that appears ONLY in content, assert the wire response
  surfaces the actual content (not rationale, the pre-fix
  behaviour).

Audit confirmed `turns` and `tasks` route the wire `content` field
correctly into their dedicated columns (`summary`/`description`).
Only `decisions` had the silent-drop defect.

## Migration safety on existing workspaces

- Migration 008 runs once on first open after the upgrade. It is
  idempotent against the migrations runner's `_meta`-based version
  bookkeeping; re-running on an already-migrated workspace is a
  no-op.
- The backfill `UPDATE decisions SET content = rationale` preserves
  every existing row as searchable. Migration 007's column-scoped
  `UPDATE OF` optimisation is carried forward to the new triggers;
  curator decay updates do not pay a full FTS5 reindex per row.

## Engineering metrics

- 5/5 EXIT=0 on every PR (`typecheck` + `lint` + `lint:tests` +
  `validate:modules` + `build` + `test`).
- **2519 tests passing in 208 files** (was 2501 in 205 at beta.0).
- SonarQube quality gate `MCP Memoria Strict` PASSED on every PR
  (Reliability A, Security A, Maintainability A, 0 bugs / 0
  vulnerabilities / 0 blockers / 0 critical, sqale_debt_ratio
  0.1%, coverage 96.4%).
- Cero `any`, cero `as any`, cero `// @ts-ignore`.
- 4 PRs squash-merged via the GitFlow protected workflow on
  `develop`; this release branch (`release/0.1.2-beta.3`) cuts the
  PR to `main`.

## Outstanding caveats and known limitations

- `encryption_status="locked"` is the conservative default for
  workspaces in `encrypted` mode. The reader does not have access
  to the bootstrap closure that holds the unlocked key; surfacing
  the runtime unlock state is tracked for a follow-up beta or
  v0.1.3.
- `size_bytes.vectors_db = 0` (always). The vec0 virtual table lives
  inside `recall.db`; there is no separate vectors file. The wire
  field is preserved for back-compat with v0.1.0 clients that
  snapshotted the shape (`docs/02 §4.6` wire-schema debt).
- Two upstream `tar` highs via `fastembed` remain `wontfix` per
  ADR-004 (`docs/12 §1.5.4`). Vector real bajo (Qdrant GCS bucket,
  not HuggingFace as originally documented).

## Methodology codified post-Phase-9

Every regression test in this release follows the **VALUES not
SHAPE** rule. The pattern: (a) create a known database state,
(b) invoke the tool, (c) assert real values reflect the state.
SHAPE-only tests masked B-MCP-1, B-MCP-2, and B-MCP-3 in earlier
releases; the value-assertion suite catches the regression that
escaped before.

## Path to v0.1.2 stable

If the next dogfood pass against `v0.1.2-beta.3` surfaces no new
defects, we promote `0.1.2` to the `latest` dist-tag and hard-
deprecate `0.1.1`. If new bugs surface, they go into individual
issues + PRs and ship as `v0.1.2-beta.4+` until the cycle settles.

## Acknowledgements

- All four bugs were caught by the human dogfood session that
  populated `<repo>/.recall/recall.db` with 33 real entries — the
  smoke E2E suite alone would not have surfaced them. The lesson
  is durable: ship a beta, dogfood it, fix what surfaces.
