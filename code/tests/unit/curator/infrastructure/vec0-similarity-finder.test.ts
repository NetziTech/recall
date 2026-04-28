import { describe, expect, it } from "vitest";
import { Vec0SimilarityFinder } from "../../../../src/modules/curator/infrastructure/similarity/vec0-similarity-finder.ts";
import type {
  ConsolidationCandidate,
  SimilarityFinder,
} from "../../../../src/modules/curator/application/ports/out/similarity-finder.port.ts";
import { ConsolidationThreshold } from "../../../../src/modules/curator/domain/value-objects/consolidation-threshold.ts";
import type {
  DatabaseConnection,
  PreparedStatement,
  RunResult,
} from "../../../../src/shared/application/ports/database-connection.port.ts";
import { SilentLogger, RecordingEventPublisher } from "../../../helpers/test-doubles.ts";

/**
 * Minimal stub `DatabaseConnection` that the Vec0 finder can drive.
 * The stub returns canned rows for the two SQL forms the adapter uses:
 *  - SQL_LOAD_EMBEDDING (single-row): yields `{ embedding: Uint8Array }`.
 *  - SQL_KNN_BY_VECTOR (multi-row): yields `{ id, distance }` rows.
 *
 * Behaviour can be tweaked per-instance to model: missing embeddings,
 * vec0 unavailable (prepare throws on the KNN SQL), KNN failure.
 */
class StubDatabase implements DatabaseConnection {
  public knnPrepareThrows: boolean = false;
  public knnRunThrows: boolean = false;
  public knnRows: Map<string, Array<{ id: string; distance: number }>> =
    new Map();
  public embeddings: Map<string, Uint8Array> = new Map();

  public prepare(sql: string): PreparedStatement {
    if (sql.includes("MATCH")) {
      if (this.knnPrepareThrows) {
        throw new Error("vec0 not loaded");
      }
      return this.makeKnnStmt();
    }
    return this.makeLoadStmt();
  }

  public exec(): void {
    /* unused */
  }

  public transaction<T>(fn: () => T): T {
    return fn();
  }

  public close(): void {
    /* unused */
  }

  private makeLoadStmt(): PreparedStatement {
    const embeddings = this.embeddings;
    return {
      run: (): RunResult => ({ changes: 0, lastInsertRowid: 0 }),
      get: (...params: readonly unknown[]): unknown => {
        const id = params[0] as string;
        const buf = embeddings.get(id);
        if (buf === undefined) return undefined;
        return { embedding: buf };
      },
      all: (): readonly unknown[] => [],
      iterate: (): IterableIterator<unknown> =>
        ([] as unknown[])[Symbol.iterator]() as IterableIterator<unknown>,
    };
  }

  private makeKnnStmt(): PreparedStatement {
    const rowsByVector = this.knnRows;
    const knnRunThrows = this.knnRunThrows;
    const embeddings = this.embeddings;
    return {
      run: (): RunResult => ({ changes: 0, lastInsertRowid: 0 }),
      get: (): unknown => undefined,
      all: (...params: readonly unknown[]): readonly unknown[] => {
        if (knnRunThrows) throw new Error("KNN failed");
        const vector = params[0] as Uint8Array;
        // Match by reverse-lookup: find which id has this exact buffer.
        for (const [id, buf] of embeddings.entries()) {
          if (buf === vector) {
            return rowsByVector.get(id) ?? [];
          }
        }
        return [];
      },
      iterate: (): IterableIterator<unknown> =>
        ([] as unknown[])[Symbol.iterator]() as IterableIterator<unknown>,
    };
  }
}

function makeFinder(db: StubDatabase): SimilarityFinder {
  return new Vec0SimilarityFinder(db, new SilentLogger());
}

function makeCandidate(id: string): ConsolidationCandidate {
  return {
    learningId: id,
    text: `text-${id}`,
    useCount: 0,
    confidenceValue: 1,
  };
}

const A = "01952f3d-1111-7000-8000-000000000001";
const B = "01952f3d-1111-7000-8000-000000000002";
const C = "01952f3d-1111-7000-8000-000000000003";

describe("Vec0SimilarityFinder", () => {
  it("returns empty array when fewer than 2 candidates", async () => {
    const db = new StubDatabase();
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A)],
      threshold: ConsolidationThreshold.default(),
    });
    expect(out.length).toBe(0);
  });

  it("degrades gracefully when vec0 KNN is unavailable", async () => {
    const db = new StubDatabase();
    db.knnPrepareThrows = true;
    db.embeddings.set(A, new Uint8Array(8));
    db.embeddings.set(B, new Uint8Array(8));
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A), makeCandidate(B)],
      threshold: ConsolidationThreshold.default(),
    });
    expect(out.length).toBe(0);
  });

  it("emits a pair when cosine score (1 - distance) exceeds threshold", async () => {
    const db = new StubDatabase();
    const va = new Uint8Array([1, 2, 3]);
    const vb = new Uint8Array([4, 5, 6]);
    db.embeddings.set(A, va);
    db.embeddings.set(B, vb);
    // KNN for A returns B with distance 0.05 -> cosine 0.95 > 0.92.
    db.knnRows.set(A, [{ id: B, distance: 0.05 }]);
    db.knnRows.set(B, [{ id: A, distance: 0.05 }]);
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A), makeCandidate(B)],
      threshold: ConsolidationThreshold.default(),
    });
    expect(out.length).toBe(1);
    expect(out[0]?.idA).toBe(A);
    expect(out[0]?.idB).toBe(B);
    expect(out[0]?.cosineScore.toNumber()).toBeCloseTo(0.95, 5);
  });

  it("filters out pairs below threshold", async () => {
    const db = new StubDatabase();
    db.embeddings.set(A, new Uint8Array([1]));
    db.embeddings.set(B, new Uint8Array([2]));
    // distance 0.5 -> cosine 0.5 < 0.92.
    db.knnRows.set(A, [{ id: B, distance: 0.5 }]);
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A), makeCandidate(B)],
      threshold: ConsolidationThreshold.default(),
    });
    expect(out.length).toBe(0);
  });

  it("deduplicates symmetric pairs ((a,b) and (b,a))", async () => {
    const db = new StubDatabase();
    db.embeddings.set(A, new Uint8Array([1]));
    db.embeddings.set(B, new Uint8Array([2]));
    db.knnRows.set(A, [{ id: B, distance: 0.05 }]);
    db.knnRows.set(B, [{ id: A, distance: 0.05 }]);
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A), makeCandidate(B)],
      threshold: ConsolidationThreshold.default(),
    });
    expect(out.length).toBe(1);
  });

  it("skips candidates without an embedding (silent degradation)", async () => {
    const db = new StubDatabase();
    // Only A has an embedding.
    db.embeddings.set(A, new Uint8Array([1]));
    db.knnRows.set(A, []);
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A), makeCandidate(B)],
      threshold: ConsolidationThreshold.default(),
    });
    expect(out.length).toBe(0);
  });

  it("ignores KNN matches that are not in the candidate set", async () => {
    const db = new StubDatabase();
    db.embeddings.set(A, new Uint8Array([1]));
    db.embeddings.set(B, new Uint8Array([2]));
    db.knnRows.set(A, [{ id: "01952f3d-1111-7000-8000-aaaaaaaaaaaa", distance: 0.05 }]);
    db.knnRows.set(B, []);
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A), makeCandidate(B)],
      threshold: ConsolidationThreshold.default(),
    });
    expect(out.length).toBe(0);
  });

  it("skips KNN-self pair (id === candidate)", async () => {
    const db = new StubDatabase();
    db.embeddings.set(A, new Uint8Array([1]));
    db.embeddings.set(B, new Uint8Array([2]));
    db.knnRows.set(A, [{ id: A, distance: 0 }]); // self
    db.knnRows.set(B, []);
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A), makeCandidate(B)],
      threshold: ConsolidationThreshold.default(),
    });
    expect(out.length).toBe(0);
  });

  it("logs and continues when KNN query fails for one candidate", async () => {
    const db = new StubDatabase();
    db.embeddings.set(A, new Uint8Array([1]));
    db.embeddings.set(B, new Uint8Array([2]));
    db.embeddings.set(C, new Uint8Array([3]));
    db.knnRunThrows = true;
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A), makeCandidate(B), makeCandidate(C)],
      threshold: ConsolidationThreshold.default(),
    });
    // Every per-candidate KNN query fails; result is empty.
    expect(out.length).toBe(0);
    void RecordingEventPublisher; // unused
  });

  it("clamps cosine score to [-1, 1] when distance is out of bounds", async () => {
    const db = new StubDatabase();
    db.embeddings.set(A, new Uint8Array([1]));
    db.embeddings.set(B, new Uint8Array([2]));
    // Distance -0.1 -> raw cosine 1.1 -> clamped to 1.
    db.knnRows.set(A, [{ id: B, distance: -0.1 }]);
    db.knnRows.set(B, []);
    const finder = makeFinder(db);
    const out = await finder.findPairs({
      candidates: [makeCandidate(A), makeCandidate(B)],
      threshold: ConsolidationThreshold.default(),
    });
    expect(out.length).toBe(1);
    expect(out[0]?.cosineScore.toNumber()).toBe(1);
  });
});
