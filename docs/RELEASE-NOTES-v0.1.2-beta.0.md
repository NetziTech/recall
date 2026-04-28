# Release Notes — v0.1.2-beta.0

> 2026-04-28. **Beta channel cut.** First release on the `beta`
> npm dist-tag.

## TL;DR

A live dogfood session against `@netzi/recall@0.1.1` immediately after
publishing it surfaced **four additional defects** that the MVP test
suite had masked. None of them are wire-protocol regressions — the
JSON-RPC layer, persistence, and FTS5 lexical recall continue to work
— but the central product promise (semantic hybrid search) is broken
and `mem.health` reports false data.

We are not pretending these are stable yet. **`v0.1.2-beta.0` ships
the same code as `v0.1.1` but reclassifies the channel as beta** so
expectations align with reality while the fixes land.

## How to install

```bash
# beta channel (this release)
npm install -g @netzi/recall@beta

# stable channel (still pinned at v0.1.1, with the open bugs)
npm install -g @netzi/recall@latest
```

`v0.1.1` continues to live in the `latest` dist-tag; existing users
are not forcibly migrated. New users who explicitly want the latest
fixes-in-progress must opt in via `@beta`.

## Why beta?

The MVP validation methodology validated **response shape**, not
**response values**. Three bugs (B-MCP-1 in v0.1.0, plus B-MCP-2 and
B-MCP-3 surfaced now) escaped because tests asserted JSON-RPC
returned a structurally-valid response without checking that the
returned data reflected the actual workspace state. Until the fixes
ship and value-validation E2E lands, the package is beta-quality by
its own author's admission.

## Open defects tracked for v0.1.2-beta.1+

Each tracked as a GitHub issue at
<https://github.com/NetziTech/recall/issues>:

| Issue | Severity | Tag | One-line summary |
|---|---|---|---|
| [#1](https://github.com/NetziTech/recall/issues/1) | high | B-MCP-2 | `mem.health` returns 8 hardcoded fields instead of querying real workspace state |
| [#2](https://github.com/NetziTech/recall/issues/2) | **critical** | B-MCP-3 | `AsyncEmbeddingWorker` is implemented and tested but never instantiated in production wiring; embedding queue grows unbounded; semantic recall always falls back to BM25 |
| [#3](https://github.com/NetziTech/recall/issues/3) | **critical** | B-MCP-4 | `mem.remember` for `kind: "decision"` silently drops the `content` wire field (no `content` column on `decisions` table) |
| [#4](https://github.com/NetziTech/recall/issues/4) | low | B-MCP-5 | `docs/02 §4.4` documents `min_score` for `mem.recall`, but the runtime Zod schema rejects it |

B-MCP-3 transitively breaks insert-time deduplication of decisions
and learnings (cosine similarity check has no embedder), so duplicate
inserts succeed quietly. This cascade closes when B-MCP-3 closes.

## What does work in v0.1.2-beta.0

The dogfood confirmed the following are healthy:

- **Wire protocol JSON-RPC**: `initialize` + `notifications/initialized`
  + `tools/call` round-trips return well-formed responses for all 6
  MVP tools.
- **Persistence**: `mem.remember` writes to SQLite (via
  `better-sqlite3-multiple-ciphers`), WAL mode is active, migrations
  ran end-to-end, and rows are readable via direct SQL.
- **Entity dedup**: matches by `(name, entity_kind)` work as
  documented (`upserted: false, embedding_status: "skipped"` on the
  second remember of an identical entity).
- **BM25 / FTS5 lexical recall**: `mem.recall` returns correct hits
  for queries that share terms with stored content (e.g.
  `"Memoria-en-proyecto"`).
- **B-MCP-1 fix from v0.1.1**: standard MCP clients (Claude Code,
  Cursor, Cline) that do not send `workspace_id` in `tools/call`
  arguments now resolve it from `.recall/config.json` correctly.
- **Bootstrap symlink resolution from `npm install -g`** (B-CLI-5
  fix from Phase-7) continues to work.

## What does NOT work in v0.1.2-beta.0

- **Semantic recall.** `mem.recall` always returns
  `fallback_reason: "embedder_unavailable"`. Paraphrased queries miss
  semantically-equivalent entries that BM25 cannot bridge (root
  cause: B-MCP-3).
- **Diagnostics.** `mem.health` cannot be trusted for
  `total_entries`, `entries_by_kind`, `mode`, `encryption_status`,
  `size_bytes`, `active_session`, `last_curator_run`, or
  `embedding_queue_pending` — eight hardcoded fields (B-MCP-2).
- **Decision content storage.** Sending `kind: "decision"` with a
  long `content` field will silently lose the content; the only
  surviving prose is `rationale` (B-MCP-4).
- **Insert dedup for decisions / learnings.** Cascade from B-MCP-3.
- **Curator self-healing** (consolidation by cosine, embedding drift
  detection). Cascade from B-MCP-3.

## Plan to exit beta

A patch sequence on the `beta` dist-tag will close the issues:

1. `v0.1.2-beta.1` — close [#2 B-MCP-3](https://github.com/NetziTech/recall/issues/2)
   (wire `AsyncEmbeddingWorker` into `mcp-server-entrypoint.ts` and
   `cli-entrypoint.ts` with start/stop in shutdown handlers); add
   value-validation E2E for `mem.recall` semantic path.
2. `v0.1.2-beta.2` — close [#1 B-MCP-2](https://github.com/NetziTech/recall/issues/1)
   (real workspace state in `CheckHealthFacadeAdapter`); add
   value-validation E2E for `mem.health`.
3. `v0.1.2-beta.3` — close [#3 B-MCP-4](https://github.com/NetziTech/recall/issues/3)
   via ADR (Option A or B) and [#4 B-MCP-5](https://github.com/NetziTech/recall/issues/4).
4. Promote `v0.1.2` from `beta` to `latest` once all four close and
   value-validation E2E coverage proves the regressions cannot
   re-enter.

## Methodology lesson (durable)

Recorded in the recall memory itself as a `learning` with
`severity: critical`:

> In MCP validation, always validate response **values**, not just
> response **shape**. For each tool, an E2E must (a) create known
> workspace state, (b) invoke the tool, (c) assert the response
> reflects that known state. Three bugs escaped MVP and v0.1.1
> validation because shape was checked but values were not.

Future PRs are expected to follow this rule.

## Acknowledgements

This release exists because the very first dogfood session against
`v0.1.1` — using `recall-server` from `@netzi/recall@0.1.1` installed
globally and queried via JSON-RPC stdio — surfaced the four issues
above within minutes of starting to populate the workspace's memory.
The validation discipline this loop demands (real client, real DB,
real FTS index, real embedder requirement, value assertions) is now
the bar for v0.1.2 stable.
