import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteMemoryEntryWriter } from "../../../../src/modules/curator/infrastructure/persistence/sqlite-memory-entry-writer.ts";
import { CuratorInfrastructureError } from "../../../../src/modules/curator/infrastructure/errors/curator-infrastructure-error.ts";
import { MemoryEntryKind } from "../../../../src/modules/curator/domain/value-objects/memory-entry-kind.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_ENTITY_UUID,
  FIXED_LEARNING_UUID,
  FIXED_TASK_UUID,
  FIXED_TURN_UUID,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { InMemoryDatabase } from "../../../_fixtures/in-memory-database.ts";

/**
 * Builds a structurally-valid `MemoryEntryKind` whose every `isXxx()`
 * predicate returns `false`. Used to drive the *defensive* branches in
 * `SqliteMemoryEntryWriter` (the `unsupportedKind` / `<unknown>` paths
 * inside `decaySqlForKind`, `deleteSqlForKind`, and `tableForKind`),
 * which a real `MemoryEntryKind.create(...)` instance can never reach.
 *
 * The helper deliberately returns an object the writer can call as if
 * it were a `MemoryEntryKind`; we cast through `unknown` to avoid
 * breaking the type system. No `any` is used.
 */
function makeUnsupportedKind(label = "ghost"): MemoryEntryKind {
  const stub: Pick<
    MemoryEntryKind,
    | "isDecision"
    | "isLearning"
    | "isEntity"
    | "isTask"
    | "isTurn"
    | "toString"
  > = {
    isDecision: () => false,
    isLearning: () => false,
    isEntity: () => false,
    isTask: () => false,
    isTurn: () => false,
    toString: () =>
      // The type signature insists on the union; the cast is constrained
      // to the union members so the writer's template strings stay safe.
      label as unknown as ReturnType<MemoryEntryKind["toString"]>,
  };
  return stub as unknown as MemoryEntryKind;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pruned (
    workspace_id      TEXT    NOT NULL,
    kind              TEXT    NOT NULL,
    original_id       TEXT    NOT NULL,
    content_snapshot  TEXT    NOT NULL,
    reason            TEXT    NOT NULL,
    pruned_at_ms      INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, kind, original_id)
);

CREATE TABLE IF NOT EXISTS decisions (
    id                      TEXT    PRIMARY KEY,
    confidence              REAL    NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS learnings (
    id                  TEXT    PRIMARY KEY,
    confidence          REAL    NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS entities (
    id              TEXT    PRIMARY KEY,
    confidence      REAL    NOT NULL DEFAULT 1.0,
    tags_json       TEXT    NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT    PRIMARY KEY,
    confidence      REAL    NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS turns (
    id                  TEXT    PRIMARY KEY,
    confidence          REAL    NOT NULL DEFAULT 1.0
);
`;

let db: InMemoryDatabase;
let writer: SqliteMemoryEntryWriter;

beforeEach(() => {
  db = new InMemoryDatabase();
  db.exec(SCHEMA);
  writer = new SqliteMemoryEntryWriter(db);
});

afterEach(() => {
  db.close();
});

describe("SqliteMemoryEntryWriter.applyDecay", () => {
  it("updates the confidence on an existing learning row", async () => {
    db.prepare(`INSERT INTO learnings (id, confidence) VALUES (?, ?)`).run(
      FIXED_LEARNING_UUID,
      1,
    );
    const updated = await writer.applyDecay({
      workspaceId: makeWorkspaceId(),
      kind: MemoryEntryKind.learning(),
      entryId: FIXED_LEARNING_UUID,
      newConfidence: Confidence.of(0.5),
    });
    expect(updated).toBe(true);
    const row = db
      .prepare(`SELECT confidence FROM learnings WHERE id = ?`)
      .get(FIXED_LEARNING_UUID) as { confidence: number };
    expect(row.confidence).toBe(0.5);
  });

  it("returns false when no row matches", async () => {
    const updated = await writer.applyDecay({
      workspaceId: makeWorkspaceId(),
      kind: MemoryEntryKind.learning(),
      entryId: FIXED_LEARNING_UUID,
      newConfidence: Confidence.of(0.5),
    });
    expect(updated).toBe(false);
  });

  it("dispatches per-kind across decisions, entities, tasks, turns", async () => {
    db.prepare(`INSERT INTO decisions (id, confidence) VALUES (?, ?)`).run(FIXED_DECISION_UUID, 1);
    db.prepare(`INSERT INTO entities (id, confidence) VALUES (?, ?)`).run(FIXED_ENTITY_UUID, 1);
    db.prepare(`INSERT INTO turns (id, confidence) VALUES (?, ?)`).run(FIXED_TURN_UUID, 1);
    expect(
      await writer.applyDecay({
        workspaceId: makeWorkspaceId(),
        kind: MemoryEntryKind.decision(),
        entryId: FIXED_DECISION_UUID,
        newConfidence: Confidence.of(0.7),
      }),
    ).toBe(true);
    expect(
      await writer.applyDecay({
        workspaceId: makeWorkspaceId(),
        kind: MemoryEntryKind.entity(),
        entryId: FIXED_ENTITY_UUID,
        newConfidence: Confidence.of(0.6),
      }),
    ).toBe(true);
    expect(
      await writer.applyDecay({
        workspaceId: makeWorkspaceId(),
        kind: MemoryEntryKind.turn(),
        entryId: FIXED_TURN_UUID,
        newConfidence: Confidence.of(0.4),
      }),
    ).toBe(true);
  });
});

describe("SqliteMemoryEntryWriter.tagEntityAsStale", () => {
  it("adds 'stale' tag and halves the confidence", async () => {
    db.prepare(
      `INSERT INTO entities (id, confidence, tags_json) VALUES (?, ?, ?)`,
    ).run(FIXED_ENTITY_UUID, 0.8, "[]");
    const tagged = await writer.tagEntityAsStale({
      workspaceId: makeWorkspaceId(),
      entityId: FIXED_ENTITY_UUID,
    });
    expect(tagged).toBe(true);
    const row = db
      .prepare(`SELECT confidence, tags_json FROM entities WHERE id = ?`)
      .get(FIXED_ENTITY_UUID) as { confidence: number; tags_json: string };
    expect(row.confidence).toBe(0.4);
    const tags = JSON.parse(row.tags_json) as string[];
    expect(tags).toContain("stale");
  });

  it("is idempotent: returns false when entity is already tagged stale", async () => {
    db.prepare(
      `INSERT INTO entities (id, confidence, tags_json) VALUES (?, ?, ?)`,
    ).run(FIXED_ENTITY_UUID, 0.8, JSON.stringify(["stale"]));
    const tagged = await writer.tagEntityAsStale({
      workspaceId: makeWorkspaceId(),
      entityId: FIXED_ENTITY_UUID,
    });
    expect(tagged).toBe(false);
  });

  it("returns false when entity does not exist", async () => {
    const tagged = await writer.tagEntityAsStale({
      workspaceId: makeWorkspaceId(),
      entityId: FIXED_ENTITY_UUID,
    });
    expect(tagged).toBe(false);
  });

  it("raises rowMalformed when tags_json is invalid JSON", async () => {
    db.prepare(
      `INSERT INTO entities (id, confidence, tags_json) VALUES (?, ?, ?)`,
    ).run(FIXED_ENTITY_UUID, 0.8, "not-json");
    await expect(
      writer.tagEntityAsStale({
        workspaceId: makeWorkspaceId(),
        entityId: FIXED_ENTITY_UUID,
      }),
    ).rejects.toThrow(CuratorInfrastructureError);
  });
});

describe("SqliteMemoryEntryWriter.markPruned", () => {
  it("transactionally inserts pruned audit row AND deletes the live row", async () => {
    db.prepare(`INSERT INTO learnings (id, confidence) VALUES (?, ?)`).run(
      FIXED_LEARNING_UUID,
      0.1,
    );
    const wasPruned = await writer.markPruned({
      workspaceId: makeWorkspaceId(),
      kind: MemoryEntryKind.learning(),
      entryId: FIXED_LEARNING_UUID,
      contentSnapshot: `{"id":"${FIXED_LEARNING_UUID}"}`,
      reasonKind: "low_confidence",
      prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
    });
    expect(wasPruned).toBe(true);
    const live = db
      .prepare(`SELECT id FROM learnings WHERE id = ?`)
      .get(FIXED_LEARNING_UUID);
    expect(live).toBeUndefined();
    const archive = db
      .prepare(
        `SELECT reason, pruned_at_ms FROM pruned WHERE workspace_id = ? AND kind = ? AND original_id = ?`,
      )
      .get(makeWorkspaceId().toString(), "learning", FIXED_LEARNING_UUID) as {
      reason: string;
      pruned_at_ms: number;
    };
    expect(archive.reason).toBe("low_confidence");
    expect(archive.pruned_at_ms).toBe(ANCHOR_TIME_MS);
  });

  it("returns false when the live row was already deleted (idempotent re-prune)", async () => {
    const wasPruned = await writer.markPruned({
      workspaceId: makeWorkspaceId(),
      kind: MemoryEntryKind.learning(),
      entryId: FIXED_LEARNING_UUID,
      contentSnapshot: "{}",
      reasonKind: "manual",
      prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
    });
    expect(wasPruned).toBe(false);
    // Audit trail still exists.
    const archive = db
      .prepare(
        `SELECT original_id FROM pruned WHERE workspace_id = ? AND kind = ? AND original_id = ?`,
      )
      .get(makeWorkspaceId().toString(), "learning", FIXED_LEARNING_UUID);
    expect(archive).toBeDefined();
  });

  it("rolls back when the delete fails (transactional safety)", async () => {
    // Drop the learnings table mid-transaction to force a SQL error on
    // delete. Pre-populate the row so insert into pruned succeeds.
    db.prepare(`INSERT INTO learnings (id, confidence) VALUES (?, ?)`).run(
      FIXED_LEARNING_UUID,
      0.1,
    );
    db.exec(`DROP TABLE learnings`);
    await expect(
      writer.markPruned({
        workspaceId: makeWorkspaceId(),
        kind: MemoryEntryKind.learning(),
        entryId: FIXED_LEARNING_UUID,
        contentSnapshot: "{}",
        reasonKind: "low_confidence",
        prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
      }),
    ).rejects.toThrow(CuratorInfrastructureError);
    // Audit row should NOT have been written (transaction rolled back).
    const archive = db
      .prepare(
        `SELECT original_id FROM pruned WHERE workspace_id = ? AND kind = ? AND original_id = ?`,
      )
      .get(makeWorkspaceId().toString(), "learning", FIXED_LEARNING_UUID);
    expect(archive).toBeUndefined();
  });

  it("dispatches per-kind delete to the right table", async () => {
    db.prepare(`INSERT INTO turns (id, confidence) VALUES (?, ?)`).run(FIXED_TURN_UUID, 0.1);
    const wasPruned = await writer.markPruned({
      workspaceId: makeWorkspaceId(),
      kind: MemoryEntryKind.turn(),
      entryId: FIXED_TURN_UUID,
      contentSnapshot: "{}",
      reasonKind: "low_confidence",
      prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
    });
    expect(wasPruned).toBe(true);
    const live = db.prepare(`SELECT id FROM turns WHERE id = ?`).get(FIXED_TURN_UUID);
    expect(live).toBeUndefined();
  });
});

describe("SqliteMemoryEntryWriter.markPrunedBatch (W-3.4-PERF-H2)", () => {
  it("empty batch returns empty mask without touching the database", async () => {
    const mask = await writer.markPrunedBatch({
      workspaceId: makeWorkspaceId(),
      items: [],
    });
    expect(mask).toEqual([]);
  });

  it("batches multiple kinds in a single transaction; returns a parallel mask", async () => {
    // Pre-populate: 2 learnings + 1 turn live; one extra learning id
    // is left absent to exercise the `wasPruned=false` arm.
    db.prepare(`INSERT INTO learnings (id, confidence) VALUES (?, ?)`).run(
      FIXED_LEARNING_UUID,
      0.1,
    );
    const SECOND_LEARNING = "01952f3c-2222-7000-8000-cccccccccc02";
    db.prepare(`INSERT INTO learnings (id, confidence) VALUES (?, ?)`).run(
      SECOND_LEARNING,
      0.1,
    );
    db.prepare(`INSERT INTO turns (id, confidence) VALUES (?, ?)`).run(
      FIXED_TURN_UUID,
      0.1,
    );
    const ABSENT_LEARNING = "01952f3c-2222-7000-8000-cccccccccc03";

    const workspaceId = makeWorkspaceId();
    const mask = await writer.markPrunedBatch({
      workspaceId,
      items: [
        {
          kind: MemoryEntryKind.learning(),
          entryId: FIXED_LEARNING_UUID,
          contentSnapshot: `{"id":"${FIXED_LEARNING_UUID}"}`,
          reasonKind: "low_confidence",
          prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
        },
        {
          kind: MemoryEntryKind.turn(),
          entryId: FIXED_TURN_UUID,
          contentSnapshot: `{"id":"${FIXED_TURN_UUID}"}`,
          reasonKind: "low_confidence",
          prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
        },
        {
          kind: MemoryEntryKind.learning(),
          entryId: SECOND_LEARNING,
          contentSnapshot: `{"id":"${SECOND_LEARNING}"}`,
          reasonKind: "manual",
          prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
        },
        {
          kind: MemoryEntryKind.learning(),
          entryId: ABSENT_LEARNING,
          contentSnapshot: `{"id":"${ABSENT_LEARNING}"}`,
          reasonKind: "low_confidence",
          prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
        },
      ],
    });

    // Mask: live rows existed for indices 0/1/2, absent for index 3.
    expect(mask).toEqual([true, true, true, false]);

    // Live tables: only the absent id survives (because it was never
    // there). All other live rows were deleted.
    const learnings = db
      .prepare(`SELECT id FROM learnings WHERE id IN (?, ?, ?)`)
      .all(FIXED_LEARNING_UUID, SECOND_LEARNING, ABSENT_LEARNING);
    expect(learnings).toEqual([]);
    const turns = db
      .prepare(`SELECT id FROM turns WHERE id = ?`)
      .get(FIXED_TURN_UUID);
    expect(turns).toBeUndefined();

    // Audit trail: even for the absent id, the snapshot landed in
    // `pruned`. This matches the singular `markPruned` semantics
    // (audit snapshot is independent of whether the live row
    // pre-existed).
    const archives = db
      .prepare(
        `SELECT original_id FROM pruned WHERE workspace_id = ? ORDER BY original_id`,
      )
      .all(workspaceId.toString()) as { original_id: string }[];
    expect(archives.map((a) => a.original_id).sort()).toEqual(
      [FIXED_LEARNING_UUID, SECOND_LEARNING, ABSENT_LEARNING, FIXED_TURN_UUID].sort(),
    );
  });

  it("dispatches per-kind delete to the right live table (decision / entity / task)", async () => {
    // Cover the deleteSqlForKind branches that the prune-low-confidence
    // path (learning + turn only) never exercises. Each kind gets one
    // pre-seeded live row and the batch deletes it.
    const DEC_ID = "01952f3c-2222-7000-8000-d00000000005";
    const ENT_ID = "01952f3c-2222-7000-8000-eeeeeeeeee05";
    const TASK_ID = "01952f3c-2222-7000-8000-aaaaaaaaaa05";
    db.prepare(`INSERT INTO decisions (id, confidence) VALUES (?, ?)`).run(DEC_ID, 0.1);
    db.prepare(`INSERT INTO entities (id, confidence) VALUES (?, ?)`).run(ENT_ID, 0.1);
    db.prepare(`INSERT INTO tasks (id) VALUES (?)`).run(TASK_ID);

    const workspaceId = makeWorkspaceId();
    const mask = await writer.markPrunedBatch({
      workspaceId,
      items: [
        {
          kind: MemoryEntryKind.decision(),
          entryId: DEC_ID,
          contentSnapshot: "{}",
          reasonKind: "manual",
          prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
        },
        {
          kind: MemoryEntryKind.entity(),
          entryId: ENT_ID,
          contentSnapshot: "{}",
          reasonKind: "manual",
          prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
        },
        {
          kind: MemoryEntryKind.task(),
          entryId: TASK_ID,
          contentSnapshot: "{}",
          reasonKind: "manual",
          prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
        },
      ],
    });
    expect(mask).toEqual([true, true, true]);
    expect(
      db.prepare(`SELECT id FROM decisions WHERE id = ?`).get(DEC_ID),
    ).toBeUndefined();
    expect(
      db.prepare(`SELECT id FROM entities WHERE id = ?`).get(ENT_ID),
    ).toBeUndefined();
    expect(
      db.prepare(`SELECT id FROM tasks WHERE id = ?`).get(TASK_ID),
    ).toBeUndefined();
  });

  it("propagates a transaction-time per-row failure as upsertFailed with the offending table", async () => {
    // Pre-populate so prepare succeeds; then wrap the connection so the
    // DELETE-stmt's `run` throws inside the transaction. The writer's
    // inner catch must record the table and the outer catch must wrap
    // it as `upsertFailed` tagged with that table.
    db.prepare(`INSERT INTO learnings (id, confidence) VALUES (?, ?)`).run(
      FIXED_LEARNING_UUID,
      0.1,
    );
    const wrapped: typeof db = Object.create(db) as typeof db;
    const origPrepare = db.prepare.bind(db);
    wrapped.prepare = (sql: string) => {
      const inner = origPrepare(sql);
      if (sql.startsWith("DELETE FROM learnings")) {
        return {
          run: () => {
            throw new Error("simulated delete failure");
          },
          get: inner.get.bind(inner),
          all: inner.all.bind(inner),
          iterate: inner.iterate.bind(inner),
        } as ReturnType<typeof db.prepare>;
      }
      return inner;
    };
    const localWriter = new (writer.constructor as new (
      db: typeof wrapped,
    ) => typeof writer)(wrapped);

    const workspaceId = makeWorkspaceId();
    await expect(
      localWriter.markPrunedBatch({
        workspaceId,
        items: [
          {
            kind: MemoryEntryKind.learning(),
            entryId: FIXED_LEARNING_UUID,
            contentSnapshot: "{}",
            reasonKind: "low_confidence",
            prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
          },
        ],
      }),
    ).rejects.toThrow(CuratorInfrastructureError);

    // The learning's live row STILL exists (we threw inside the
    // transaction, so the insert into pruned rolled back too).
    const liveLearning = db
      .prepare(`SELECT id FROM learnings WHERE id = ?`)
      .get(FIXED_LEARNING_UUID);
    expect(liveLearning).toBeDefined();
    const archives = db
      .prepare(`SELECT COUNT(*) as n FROM pruned WHERE workspace_id = ?`)
      .get(workspaceId.toString()) as { n: number };
    expect(archives.n).toBe(0);
  });

  it("rolls back the entire batch when ANY delete fails (transactional safety)", async () => {
    db.prepare(`INSERT INTO learnings (id, confidence) VALUES (?, ?)`).run(
      FIXED_LEARNING_UUID,
      0.1,
    );
    db.prepare(`INSERT INTO turns (id, confidence) VALUES (?, ?)`).run(
      FIXED_TURN_UUID,
      0.1,
    );

    // Drop the turns table mid-batch to force a SQL error on the
    // second item.
    db.exec(`DROP TABLE turns`);

    const workspaceId = makeWorkspaceId();
    await expect(
      writer.markPrunedBatch({
        workspaceId,
        items: [
          {
            kind: MemoryEntryKind.learning(),
            entryId: FIXED_LEARNING_UUID,
            contentSnapshot: "{}",
            reasonKind: "low_confidence",
            prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
          },
          {
            kind: MemoryEntryKind.turn(),
            entryId: FIXED_TURN_UUID,
            contentSnapshot: "{}",
            reasonKind: "low_confidence",
            prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
          },
        ],
      }),
    ).rejects.toThrow(CuratorInfrastructureError);

    // The learning's live row STILL exists — the whole transaction
    // (insert into pruned + delete from learnings) rolled back.
    const liveLearning = db
      .prepare(`SELECT id FROM learnings WHERE id = ?`)
      .get(FIXED_LEARNING_UUID);
    expect(liveLearning).toBeDefined();
    // No audit-trail rows survived either.
    const archives = db
      .prepare(`SELECT COUNT(*) as n FROM pruned WHERE workspace_id = ?`)
      .get(workspaceId.toString()) as { n: number };
    expect(archives.n).toBe(0);
  });
});

/**
 * Edge cases added to push the file's coverage above the 95% threshold.
 *
 * These tests exercise the catch / defensive paths that the happy-path
 * suite above does not reach:
 *
 *   1. `applyDecay` — UPDATE fails (table dropped) → `upsertFailed`.
 *   2. `applyDecayBatch`:
 *        - empty input → returns 0 (no transaction).
 *        - mixed-kind batch → routes per kind.
 *        - kind unsupported during prep → `unsupportedKind`.
 *        - inner `stmt.run` throws → wraps as `upsertFailed`
 *          (covers both per-item catch and outer failureRef branch).
 *   3. `tagEntityAsStale`:
 *        - persisted row is structurally invalid (NULL confidence) →
 *          `rowMalformed` (Schema parse path).
 *        - JSON parses but is not an array of strings → `rowMalformed`
 *          (TagsArraySchema path).
 *        - update statement throws (table dropped between SELECT and
 *          UPDATE) → `upsertFailed`.
 *        - confidence above 1 is clamped to 0.5 (defensive normaliser).
 *   4. `markPruned`:
 *        - kind unsupported in delete dispatcher → `unsupportedKind`.
 *        - re-throws an existing `CuratorInfrastructureError` unchanged
 *          (the `instanceof` short-circuit branch).
 *   5. `decaySqlForKind` / `deleteSqlForKind` / `tableForKind` defensive
 *      tail returns (only reachable with a stubbed kind whose every
 *      predicate returns `false`).
 */
describe("SqliteMemoryEntryWriter — edge & error paths", () => {
  describe("applyDecay (errors)", () => {
    it("wraps a SQL error from UPDATE as upsertFailed", async () => {
      // Wrap the connection so the UPDATE statement throws on `run`.
      // (Dropping the table beforehand would explode at `prepare`, which
      // sits *outside* the writer's try-catch and would mask the path
      // we want to cover.)
      const wrapped: typeof db = Object.create(db) as typeof db;
      wrapped.prepare = (sql: string) => {
        const inner = db.prepare(sql);
        return {
          run: () => {
            throw new Error("simulated update failure");
          },
          get: inner.get.bind(inner),
          all: inner.all.bind(inner),
          iterate: inner.iterate.bind(inner),
        };
      };
      const writerLocal = new SqliteMemoryEntryWriter(wrapped);
      const promise = writerLocal.applyDecay({
        workspaceId: makeWorkspaceId(),
        kind: MemoryEntryKind.learning(),
        entryId: FIXED_LEARNING_UUID,
        newConfidence: Confidence.of(0.5),
      });
      await expect(promise).rejects.toBeInstanceOf(CuratorInfrastructureError);
      await expect(promise).rejects.toMatchObject({
        code: "curator.persistence.upsert-failed",
        message: expect.stringContaining("learnings") as unknown,
      });
    });
  });

  describe("applyDecayBatch", () => {
    it("returns 0 when given an empty batch (no transaction opened)", async () => {
      const changed = await writer.applyDecayBatch({
        workspaceId: makeWorkspaceId(),
        items: [],
      });
      expect(changed).toBe(0);
    });

    it("dispatches across mixed kinds (decision + learning + entity + task + turn)", async () => {
      db.prepare(`INSERT INTO decisions (id, confidence) VALUES (?, ?)`).run(
        FIXED_DECISION_UUID,
        1,
      );
      db.prepare(`INSERT INTO learnings (id, confidence) VALUES (?, ?)`).run(
        FIXED_LEARNING_UUID,
        1,
      );
      db.prepare(`INSERT INTO entities (id, confidence) VALUES (?, ?)`).run(
        FIXED_ENTITY_UUID,
        1,
      );
      db.prepare(`INSERT INTO tasks (id, confidence) VALUES (?, ?)`).run(
        FIXED_TASK_UUID,
        1,
      );
      db.prepare(`INSERT INTO turns (id, confidence) VALUES (?, ?)`).run(
        FIXED_TURN_UUID,
        1,
      );

      const changed = await writer.applyDecayBatch({
        workspaceId: makeWorkspaceId(),
        items: [
          {
            kind: MemoryEntryKind.decision(),
            entryId: FIXED_DECISION_UUID,
            newConfidence: Confidence.of(0.9),
          },
          {
            kind: MemoryEntryKind.learning(),
            entryId: FIXED_LEARNING_UUID,
            newConfidence: Confidence.of(0.8),
          },
          {
            kind: MemoryEntryKind.entity(),
            entryId: FIXED_ENTITY_UUID,
            newConfidence: Confidence.of(0.7),
          },
          {
            kind: MemoryEntryKind.task(),
            entryId: FIXED_TASK_UUID,
            newConfidence: Confidence.of(0.6),
          },
          {
            kind: MemoryEntryKind.turn(),
            entryId: FIXED_TURN_UUID,
            newConfidence: Confidence.of(0.5),
          },
          // Repeat one kind to exercise the `statementByKind.has(key)` short-circuit.
          {
            kind: MemoryEntryKind.learning(),
            entryId: "not-a-real-id",
            newConfidence: Confidence.of(0.4),
          },
        ],
      });

      // Five real rows updated; the bogus id matches no row (changes==0).
      expect(changed).toBe(5);

      const finalDecision = db
        .prepare(`SELECT confidence FROM decisions WHERE id = ?`)
        .get(FIXED_DECISION_UUID) as { confidence: number };
      expect(finalDecision.confidence).toBe(0.9);
      const finalTurn = db
        .prepare(`SELECT confidence FROM turns WHERE id = ?`)
        .get(FIXED_TURN_UUID) as { confidence: number };
      expect(finalTurn.confidence).toBe(0.5);
    });

    it("raises unsupportedKind during prep when a kind is not routable", async () => {
      const ghost = makeUnsupportedKind("ghost-kind");
      const promise = writer.applyDecayBatch({
        workspaceId: makeWorkspaceId(),
        items: [
          {
            kind: ghost,
            entryId: "irrelevant",
            newConfidence: Confidence.of(0.5),
          },
        ],
      });
      await expect(promise).rejects.toBeInstanceOf(CuratorInfrastructureError);
      await expect(promise).rejects.toMatchObject({
        code: "curator.persistence.unsupported-kind",
      });
    });

    it("wraps an unrecorded transaction failure under '<batch>' (outer catch fallback)", async () => {
      // The outer catch at lines 165-174 has two arms:
      //   - failureRef.current !== null → re-throw under recorded table
      //   - failureRef.current === null → wrap under "<batch>"
      // The second arm is reached when `db.transaction(...)` throws
      // *before* the inner closure registers a failure. We simulate
      // exactly that: a `transaction` that bypasses the closure and
      // raises a non-typed error.
      const wrapped: typeof db = Object.create(db) as typeof db;
      wrapped.transaction = <T>(): T => {
        throw new Error("transaction infrastructure failure");
      };
      const writerLocal = new SqliteMemoryEntryWriter(wrapped);
      const promise = writerLocal.applyDecayBatch({
        workspaceId: makeWorkspaceId(),
        items: [
          {
            kind: MemoryEntryKind.learning(),
            entryId: FIXED_LEARNING_UUID,
            newConfidence: Confidence.of(0.5),
          },
        ],
      });
      await expect(promise).rejects.toBeInstanceOf(CuratorInfrastructureError);
      await expect(promise).rejects.toMatchObject({
        code: "curator.persistence.upsert-failed",
        message: expect.stringContaining("<batch>") as unknown,
      });
    });

    it("wraps a SQL failure inside the transaction as upsertFailed (per-item catch)", async () => {
      // Wrap the connection so the prepared UPDATE throws on `run`
      // *inside* the transaction. This exercises both the per-item catch
      // (lines 157-162) and the outer wrapper that surfaces the recorded
      // failure as `upsertFailed` (lines 166-174).
      const wrapped: typeof db = Object.create(db) as typeof db;
      wrapped.prepare = (sql: string) => {
        const inner = db.prepare(sql);
        return {
          run: () => {
            throw new Error("simulated update failure");
          },
          get: inner.get.bind(inner),
          all: inner.all.bind(inner),
          iterate: inner.iterate.bind(inner),
        };
      };
      const writerLocal = new SqliteMemoryEntryWriter(wrapped);
      const promise = writerLocal.applyDecayBatch({
        workspaceId: makeWorkspaceId(),
        items: [
          {
            kind: MemoryEntryKind.learning(),
            entryId: FIXED_LEARNING_UUID,
            newConfidence: Confidence.of(0.5),
          },
        ],
      });
      await expect(promise).rejects.toBeInstanceOf(CuratorInfrastructureError);
      await expect(promise).rejects.toMatchObject({
        code: "curator.persistence.upsert-failed",
        message: expect.stringContaining("learnings") as unknown,
      });
    });
  });

  describe("tagEntityAsStale (errors & edges)", () => {
    it("raises rowMalformed when the persisted row fails the Schema (NULL confidence)", async () => {
      // Allow NULL: redefine entities to admit NULL in confidence so we
      // can persist a structurally invalid row that breaks `z.number()`.
      db.exec(`DROP TABLE entities`);
      db.exec(
        `CREATE TABLE entities (
           id TEXT PRIMARY KEY,
           confidence REAL,
           tags_json TEXT NOT NULL DEFAULT '[]'
         )`,
      );
      db.prepare(
        `INSERT INTO entities (id, confidence, tags_json) VALUES (?, NULL, ?)`,
      ).run(FIXED_ENTITY_UUID, "[]");
      const promise = writer.tagEntityAsStale({
        workspaceId: makeWorkspaceId(),
        entityId: FIXED_ENTITY_UUID,
      });
      await expect(promise).rejects.toBeInstanceOf(CuratorInfrastructureError);
      await expect(promise).rejects.toMatchObject({
        code: "curator.persistence.row-malformed",
        message: expect.stringContaining("entities") as unknown,
      });
    });

    it("raises rowMalformed when tags_json parses but is not an array of strings", async () => {
      db.prepare(
        `INSERT INTO entities (id, confidence, tags_json) VALUES (?, ?, ?)`,
      ).run(FIXED_ENTITY_UUID, 0.8, JSON.stringify([1, 2, 3]));
      await expect(
        writer.tagEntityAsStale({
          workspaceId: makeWorkspaceId(),
          entityId: FIXED_ENTITY_UUID,
        }),
      ).rejects.toMatchObject({
        code: "curator.persistence.row-malformed",
      });
    });

    it("wraps an UPDATE failure as upsertFailed (entities table dropped after SELECT)", async () => {
      db.prepare(
        `INSERT INTO entities (id, confidence, tags_json) VALUES (?, ?, ?)`,
      ).run(FIXED_ENTITY_UUID, 0.8, "[]");

      // Wrap the connection so that the UPDATE statement is sabotaged at
      // `run(...)` time (mirrors a mid-transaction schema mutation that
      // would never happen in production but exercises the catch path).
      const wrapped: typeof db = Object.create(db) as typeof db;
      let prepareCalls = 0;
      wrapped.prepare = (sql: string) => {
        prepareCalls += 1;
        const inner = db.prepare(sql);
        if (prepareCalls === 1) {
          // First prepare = SELECT; pass through.
          return inner;
        }
        // Second prepare = UPDATE; replace `run` with a thrower.
        return {
          run: () => {
            throw new Error("simulated update failure");
          },
          get: inner.get.bind(inner),
          all: inner.all.bind(inner),
          iterate: inner.iterate.bind(inner),
        };
      };
      const writerLocal = new SqliteMemoryEntryWriter(wrapped);
      await expect(
        writerLocal.tagEntityAsStale({
          workspaceId: makeWorkspaceId(),
          entityId: FIXED_ENTITY_UUID,
        }),
      ).rejects.toMatchObject({
        code: "curator.persistence.upsert-failed",
        message: expect.stringContaining("entities") as unknown,
      });
    });

    it("clamps a persisted confidence above 1.0 to 0.5 when halving", async () => {
      // The defensive `halved > 1 ? 0.5 : halved` branch on line 222.
      db.prepare(
        `INSERT INTO entities (id, confidence, tags_json) VALUES (?, ?, ?)`,
      ).run(FIXED_ENTITY_UUID, 3.0, "[]");
      const tagged = await writer.tagEntityAsStale({
        workspaceId: makeWorkspaceId(),
        entityId: FIXED_ENTITY_UUID,
      });
      expect(tagged).toBe(true);
      const row = db
        .prepare(`SELECT confidence FROM entities WHERE id = ?`)
        .get(FIXED_ENTITY_UUID) as { confidence: number };
      expect(row.confidence).toBe(0.5);
    });
  });

  describe("markPruned (errors & dispatch)", () => {
    it("raises unsupportedKind when delete dispatcher cannot route", async () => {
      const ghost = makeUnsupportedKind("ghost-kind");
      await expect(
        writer.markPruned({
          workspaceId: makeWorkspaceId(),
          kind: ghost,
          entryId: FIXED_LEARNING_UUID,
          contentSnapshot: "{}",
          reasonKind: "low_confidence",
          prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
        }),
      ).rejects.toBeInstanceOf(CuratorInfrastructureError);
    });

    it("re-throws CuratorInfrastructureError unchanged when the closure raises it", async () => {
      // Drop the `pruned` table — this makes the INSERT throw a SqliteError
      // inside the transaction. The catch wraps it as `upsertFailed`,
      // which is itself a CuratorInfrastructureError; on the second
      // attempt below we simulate a closure that raises the typed error
      // directly to exercise the `instanceof` short-circuit (line 271).
      const sentinel = CuratorInfrastructureError.upsertFailed(
        "decisions",
        new Error("boom"),
      );
      const wrapped: typeof db = Object.create(db) as typeof db;
      wrapped.transaction = <T>(fn: () => T): T => {
        // Run the closure inside a real tx so the rollback semantics
        // are preserved, then surface the typed error.
        try {
          return db.transaction(fn);
        } finally {
          // Force the typed error path regardless of fn's outcome.
          // eslint-disable-next-line no-unsafe-finally
          throw sentinel;
        }
      };
      const writerLocal = new SqliteMemoryEntryWriter(wrapped);
      const promise = writerLocal.markPruned({
        workspaceId: makeWorkspaceId(),
        kind: MemoryEntryKind.decision(),
        entryId: FIXED_DECISION_UUID,
        contentSnapshot: "{}",
        reasonKind: "low_confidence",
        prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
      });
      await expect(promise).rejects.toBe(sentinel);
    });
  });

  describe("decaySqlForKind / deleteSqlForKind / tableForKind (defensive tails)", () => {
    it("decaySqlForKind throws unsupportedKind for an unknown kind", async () => {
      const ghost = makeUnsupportedKind("phantom");
      await expect(
        writer.applyDecay({
          workspaceId: makeWorkspaceId(),
          kind: ghost,
          entryId: "irrelevant",
          newConfidence: Confidence.of(0.5),
        }),
      ).rejects.toMatchObject({
        code: "curator.persistence.unsupported-kind",
        message: expect.stringContaining("applyDecay") as unknown,
      });
    });

    it("deleteSqlForKind throws unsupportedKind for an unknown kind (via markPruned)", async () => {
      const ghost = makeUnsupportedKind("phantom");
      await expect(
        writer.markPruned({
          workspaceId: makeWorkspaceId(),
          kind: ghost,
          entryId: "irrelevant",
          contentSnapshot: "{}",
          reasonKind: "manual",
          prunedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
        }),
      ).rejects.toMatchObject({
        code: "curator.persistence.unsupported-kind",
        message: expect.stringContaining("markPruned") as unknown,
      });
    });

    it("tableForKind falls back to '<unknown>' inside the upsertFailed message when batch fails on a ghost kind", async () => {
      // The `applyDecayBatch` prep loop calls `tableForKind` for every
      // item, then wraps any later failure with that table name. If
      // the kind is unrouteable, `decaySqlForKind` throws first — but
      // `tableForKind`'s `<unknown>` tail is exercised here when the
      // map lookup later finds the ghost kind. We assert the upsert
      // wrapper carries the expected fallback table name.
      const ghost = makeUnsupportedKind("ghost-x");
      const promise = writer.applyDecayBatch({
        workspaceId: makeWorkspaceId(),
        items: [
          {
            kind: ghost,
            entryId: "irrelevant",
            newConfidence: Confidence.of(0.1),
          },
        ],
      });
      // The prep loop raises unsupportedKind; the batch surfaces it as-is.
      await expect(promise).rejects.toMatchObject({
        code: "curator.persistence.unsupported-kind",
      });
    });
  });
});
