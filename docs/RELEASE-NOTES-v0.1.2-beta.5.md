# Release Notes — v0.1.2-beta.5

> 2026-05-02. **B-MCP-8 closed.** `mem.recall` no longer returns
> `hits=0` when `total_candidates>0` — the post-rank token-budget
> filter used to drop every hit if the top-ranked entry alone exceeded
> `max_tokens`. Now the top hit is always returned, mid-loop oversized
> hits are skipped (not break), and the default `max_tokens` is aligned
> with `mem.context` (8000, was 4000). One bug in, one bug out — the
> beta cycle continues toward `v0.1.2` stable.

## TL;DR

The single defect surfaced in the post-publish smoke of `v0.1.2-beta.4`
([issue #31](https://github.com/NetziTech/recall/issues/31)) is fixed
and shipped behind `npm install -g @netzi/recall@beta`:

| Issue | Severity | Tag | PR | Outcome |
|---|---|---|---|---|
| [#31](https://github.com/NetziTech/recall/issues/31) | medium | B-MCP-8 | [#33](https://github.com/NetziTech/recall/pull/33) | `RecallMemoryUseCase.rankAndSlice` now (1) always includes the top-ranked hit even if it solo exceeds `max_tokens`, (2) uses `continue` (not `break`) on overflow so smaller hits behind a mid-ranking oversized one still surface, and (3) the wire facade default `max_tokens` is bumped from 4000 → 8000 to match `mem.context`. |

## How to install

```bash
# beta channel (this release)
npm install -g @netzi/recall@beta

# latest stable (deprecated 0.1.1, kept as warning until v0.1.2 stable lands)
npm install -g @netzi/recall@latest
```

After `v0.1.2` stable ships, the `latest` dist-tag will move to
`0.1.2` and `0.1.1` will be hard-deprecated.

## What was broken in beta.4

The post-publish smoke of `v0.1.2-beta.4` against the project's own
dogfood DB confirmed the embedding worker drained the queue
end-to-end (B-MCP-7 fix ✅). But `mem.recall` returned `hits=0` for
queries that DID find candidates:

| Query | `total_candidates` | `hits.length` |
|---|---|---|
| `"GitFlow"` (top_k=5) | 2 | **0** |
| `"embedding worker async"` (top_k=5) | 1 | **0** |

The dogfood DB had matching entries — but the rendered hits never
surfaced. The fix in this release closes that gap.

## Root cause

Three independent factors aligned:

1. **`learning` and `turn` rows store full content un-truncated.**
   `decisions` and `entities` are capped at 600 chars by
   `truncatePreview()` in `sqlite-memory-projection-repository.ts`;
   `learnings` and `turns` are not.
2. **The hybrid scorer ranks long-form learnings highly.** Once the
   B-MCP-7 fix populated the `embedding_metadata` table end-to-end,
   the scorer (BM25 + cosine + recency + usage + priority boost)
   started ranking long learnings at the top — they were the
   semantically-richest matches.
3. **The token-budget loop did `break` on first overflow.** With
   the default `max_tokens=4000` and a top-ranked learning weighing
   in at >4000 tokens, the very first iteration saw
   `runningTokens (0) + tokens (>4000) > 4000 → break`, leaving
   `out=[]`.

The result: `hits.length=0` even though the candidate pool had
real matches.

This regression was effectively dormant before B-MCP-7 (the worker
never populated the queue, so vector hits were always empty and
recall fell back to BM25-only — which prioritized short titles that
fit the budget).

## Highlights of the fix

### Use case — `RecallMemoryUseCase.rankAndSlice`

```ts
// Token budget application (B-MCP-8 fix):
//
// 1. The top-ranked hit is ALWAYS included even if it solo exceeds
//    `maxTokens`. Returning zero hits when there are candidates
//    surprises callers ("recall said total_candidates=2 but hits=0")
//    and degrades the semantic-recall promise; a slightly oversized
//    single result is strictly more useful than no result.
// 2. Subsequent hits use `continue` (not `break`) so a mid-loop
//    oversized hit doesn't suppress smaller hits later in the
//    ranking. Candidates are ordered by relevance, not size, so a
//    big hit at rank 3 should not hide a fitting hit at rank 4.
const out: RankedEntry[] = [];
let runningTokens = 0;
const max = input.maxTokens.maxTokens;
for (const candidate of limited) {
  const tokens = this.tokenCounter
    .count(this.renderTokenInput(candidate.entry))
    .toNumber();
  if (out.length === 0) {
    out.push(candidate.entry);
    runningTokens += tokens;
    continue;
  }
  if (runningTokens + tokens > max) continue;
  runningTokens += tokens;
  out.push(candidate.entry);
}
```

Two semantic guarantees:

- `total_candidates >= 1` ⟹ `hits.length >= 1`.
- A mid-loop oversized hit doesn't kill the rest of the ranking;
  smaller hits behind it surface as long as cumulative tokens fit.

### Wire facade — default `max_tokens`

```ts
// RecallMemoryFacadeAdapter
private static readonly DEFAULT_MAX_TOKENS = 8000;  // was 4000
```

Aligned with `GetContextFacadeAdapter.DEFAULT_MAX_TOKENS = 8000`.
A recall request typically returns full ranked entries with
previews; tighter than the bundle made no sense and forced the
use case to drop hits the user expected. The wire `max_tokens`
parameter still overrides this default.

## Tests (VALUES not SHAPE — Phase-9 rule)

The pre-existing unit test ("trims the tail when cumulative token
cost would exceed maxTokens") used
`expect(getEntries().length).toBeLessThanOrEqual(1)` — that loose
assertion silently passed even at length=0, exactly the bug. It's
now `toBe(1)` plus an exact id assertion.

- Tightened "trims the tail" + "respects the filters.limit slice"
  to assert exact lengths.
- New unit test: top hit is always returned when it solo exceeds
  budget.
- New unit test: a mid-ranking oversized hit is skipped and smaller
  hits behind it still surface (continue-vs-break semantics).
- New integration test: reproduces the dogfood scenario by
  recording a 1.8 KiB learning and asserting
  `mem.recall("GitFlow", max_tokens: 50)` returns
  `hits.length >= 1`.
- New integration test: the new 8000-token default lets multiple
  hits surface for a literal "hexagonal" query against the seeded
  corpus.

**Total: 2557 tests passing in 211 files** (was 2553 in 213 at
beta.4 — the file count drop is incidental, the integration suite
co-located 4 new tests in 2 existing files).

## Why this escaped beta.4

The pre-existing unit test asserted `toBeLessThanOrEqual(1)`, not
`toBe(1)` — a `length=0` result satisfied the assertion. The
integration suite covered `mem.recall`'s shape (returns the right
fields) and BM25 flow (literal matches surface) but never seeded a
candidate large enough to trigger the budget overflow.

The Phase-9 "VALUES not SHAPE" methodology was applied correctly
to the contract; the missing piece was a candidate large enough to
exercise the budget edge. The new
`D-mem-recall.test.ts` integration tests + the
`recall-memory.use-case.test.ts` unit tests now codify both
scenarios with VALUE assertions.

## Engineering metrics

- 5+1/5+1 EXIT=0 on the PR
  (`typecheck` + `lint` + `lint:tests` + `validate:modules` +
  `build` + `test`).
- **2557 tests passing in 211 files** (+4 vs 2553 at beta.4).
- SonarQube quality gate `MCP Memoria Strict` PASSED on PR #33
  in the first push (Reliability A, Security A, Maintainability A,
  0 bugs / 0 vulnerabilities / 0 blockers / 0 critical violations,
  coverage on **new code 100%**, overall 96.4%, sqale_debt_ratio
  0.0% on new code).
- Cero `any`, cero `as any`, cero `// @ts-ignore`.

## Outstanding caveats

- `encryption_status="locked"` is still the conservative default for
  workspaces in `encrypted` mode (B-MCP-2 caveat carried forward
  from beta.3).
- `size_bytes.vectors_db = 0` (always). The vec0 virtual table lives
  inside `recall.db`; there is no separate vectors file. Wire field
  preserved for back-compat with v0.1.0 clients.
- The `serverInfo.version` reported by the JSON-RPC handshake may
  lag the package version (cosmetic, does not affect functionality).
  This is tracked as a pending investigation in HANDOFF §0.
- Two upstream `tar` highs via `fastembed` remain `wontfix` per
  ADR-004 (`docs/12 §1.5.4`). The fastembed download path is not
  user-input-reachable, only GCS-tarball-reachable, so the wontfix
  rationale stands.

## Path to v0.1.2 stable

If the post-publish smoke of `v0.1.2-beta.5` (against the dogfood
DB, validating that `mem.recall` with paraphrased queries against
the existing 64-entry corpus returns hits without falling back to
BM25-only) confirms the fix end-to-end, we promote `0.1.2` to the
`latest` dist-tag and hard-deprecate `0.1.1`. If new bugs surface,
they go into individual issues + PRs and ship as `v0.1.2-beta.6+`
until the cycle settles.

## Acknowledgements

- The bug was caught by the post-publish smoke of beta.4 against
  the dogfood DB — the same loop that caught B-MCP-1 (v0.1.0),
  B-MCP-2/3/4 (v0.1.1), and B-MCP-7 (beta.3). The dogfood DB
  remains a critical QA asset; conserving it and re-running smoke
  against it on every release is non-negotiable.
- The "VALUES not SHAPE" methodology from Phase-9 caught the bug
  cleanly once the new tests were tightened. The existing
  `toBeLessThanOrEqual(1)` assertion served as a textbook example
  of how loose asserts mask regressions.
