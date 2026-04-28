import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteFts5LexicalSearch } from "../../../../src/modules/retrieval/infrastructure/persistence/sqlite-fts5-lexical-search.ts";
import { QueryKind } from "../../../../src/modules/retrieval/domain/value-objects/query-kind.ts";
import { QueryText } from "../../../../src/modules/retrieval/domain/value-objects/query-text.ts";
import { RecallFilters } from "../../../../src/modules/retrieval/domain/value-objects/recall-filters.ts";
import { Tags } from "../../../../src/shared/domain/value-objects/tags.ts";
import { makeWorkspaceId } from "../../../helpers/factories.ts";
import { InMemoryDatabase } from "../../../_fixtures/in-memory-database.ts";

const SCHEMA_FTS = `
  -- Minimal in-memory FTS5 mirror of the four lexical kinds. We keep
  -- the FTS5 tables as stand-alone (no content='') since we only need
  -- BM25 ranking, not external-content sync triggers, for these unit
  -- tests.
  CREATE VIRTUAL TABLE decisions_fts USING fts5(id UNINDEXED, title, rationale);
  CREATE VIRTUAL TABLE learnings_fts USING fts5(id UNINDEXED, content, trigger);
  CREATE VIRTUAL TABLE entities_fts  USING fts5(id UNINDEXED, name, description);
  CREATE VIRTUAL TABLE turns_fts     USING fts5(id UNINDEXED, summary, intent, outcome);
`;

const seed = (db: InMemoryDatabase): void => {
  db.exec(SCHEMA_FTS);
  db.prepare(
    "INSERT INTO decisions_fts (id, title, rationale) VALUES (?, ?, ?)",
  ).run("dec-1", "Use Postgres", "We picked Postgres for JSONB and reliability");
  db.prepare(
    "INSERT INTO decisions_fts (id, title, rationale) VALUES (?, ?, ?)",
  ).run("dec-2", "Adopt TypeScript", "Static types reduce bugs at the boundary");

  db.prepare(
    "INSERT INTO learnings_fts (id, content, trigger) VALUES (?, ?, ?)",
  ).run("learn-1", "Postgres CASCADE deletes can lock", "schema migration");

  db.prepare(
    "INSERT INTO entities_fts (id, name, description) VALUES (?, ?, ?)",
  ).run("ent-1", "UserService", "Handles authentication via Postgres tokens");

  db.prepare(
    "INSERT INTO turns_fts (id, summary, intent, outcome) VALUES (?, ?, ?, ?)",
  ).run("turn-1", "Discussed Postgres migration", "plan migration", "approved");
};

const filters = (
  over: Partial<{ kinds: QueryKind[]; limit: number }> = {},
): RecallFilters =>
  RecallFilters.create({
    kinds: over.kinds ?? [],
    tags: Tags.empty(),
    mustHaveTags: Tags.empty(),
    mustNotHaveTags: Tags.empty(),
    minConfidence: null,
    since: null,
    until: null,
    limit: over.limit ?? 10,
  });

let db: InMemoryDatabase;
let adapter: SqliteFts5LexicalSearch;

beforeEach(() => {
  db = new InMemoryDatabase();
  seed(db);
  adapter = new SqliteFts5LexicalSearch(db);
});

afterEach(() => {
  db.close();
});

describe("SqliteFts5LexicalSearch", () => {
  it("returns hits across multiple kinds", async () => {
    const out = await adapter.search(
      QueryText.create("Postgres"),
      makeWorkspaceId(),
      filters(),
    );

    expect(out.length).toBeGreaterThan(0);
    const kinds = new Set(out.map((h) => h.kind));
    // The seed has Postgres references in decisions, learnings, entities, turns.
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  });

  it("scopes results to the requested kinds when filters.kinds is set", async () => {
    const out = await adapter.search(
      QueryText.create("Postgres"),
      makeWorkspaceId(),
      filters({ kinds: [QueryKind.decision()] }),
    );

    for (const hit of out) {
      expect(hit.kind).toBe("decision");
    }
  });

  it("returns an empty array when no kinds match the FTS5 bindings", async () => {
    // tasks have no FTS5 binding; if the only requested kind is task,
    // the adapter must return empty without touching the DB.
    const out = await adapter.search(
      QueryText.create("Postgres"),
      makeWorkspaceId(),
      filters({ kinds: [QueryKind.task()] }),
    );
    expect(out.length).toBe(0);
  });

  it("orders the hits by BM25 score (descending)", async () => {
    const out = await adapter.search(
      QueryText.create("Postgres"),
      makeWorkspaceId(),
      filters(),
    );
    for (let i = 1; i < out.length; i += 1) {
      const prev = out[i - 1]?.score.toNumber() ?? 0;
      const curr = out[i]?.score.toNumber() ?? 0;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("respects the limit (slice across kinds)", async () => {
    const out = await adapter.search(
      QueryText.create("Postgres"),
      makeWorkspaceId(),
      filters({ limit: 2 }),
    );
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("returns an empty array on a sanitised-to-empty query", async () => {
    // Query of exclusive non-allowed chars (e.g. "()" stripped → empty).
    const out = await adapter.search(
      QueryText.create("(((((("),
      makeWorkspaceId(),
      filters(),
    );
    expect(out).toEqual([]);
  });

  it("never matches when the query has no tokens in the corpus", async () => {
    const out = await adapter.search(
      QueryText.create("xyz123nomatch"),
      makeWorkspaceId(),
      filters(),
    );
    expect(out).toEqual([]);
  });

  it("returns BM25Score with non-negative values (negation of FTS5 raw)", async () => {
    const out = await adapter.search(
      QueryText.create("Postgres"),
      makeWorkspaceId(),
      filters(),
    );
    for (const hit of out) {
      expect(hit.score.toNumber()).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns a frozen array", async () => {
    const out = await adapter.search(
      QueryText.create("Postgres"),
      makeWorkspaceId(),
      filters(),
    );
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("emits hits with the correct id values", async () => {
    const out = await adapter.search(
      QueryText.create("UserService"),
      makeWorkspaceId(),
      filters(),
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.id).toBe("ent-1");
    expect(out[0]?.kind).toBe("entity");
  });
});
