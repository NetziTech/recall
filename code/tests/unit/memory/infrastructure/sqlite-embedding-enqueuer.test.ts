import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteEmbeddingEnqueuer } from "../../../../src/modules/memory/infrastructure/embedding/sqlite-embedding-enqueuer.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  ANCHOR_TIME_MS,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const ENQ_UUID = "01952f3c-2222-7000-8000-9999999999aa";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  enqueuer: SqliteEmbeddingEnqueuer;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  ctx = {
    db,
    enqueuer: new SqliteEmbeddingEnqueuer(
      db,
      new FakeIdGenerator({ sequence: [ENQ_UUID] }),
    ),
  };
});
afterEach(() => {
  ctx.db.close();
});

describe("SqliteEmbeddingEnqueuer.enqueue", () => {
  it("inserts a row in embedding_queue", async () => {
    await ctx.enqueuer.enqueue({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "01952f3c-2222-7000-8000-bbbbbbbbbb01",
      enqueuedAt: makeTimestamp(ANCHOR_TIME_MS),
    });
    const stmt = ctx.db.prepare(
      "SELECT id, target_kind, target_row_id, enqueued_at_ms, attempts FROM embedding_queue WHERE id = ?",
    );
    const row = stmt.get(ENQ_UUID) as
      | {
          id: string;
          target_kind: string;
          target_row_id: string;
          enqueued_at_ms: number;
          attempts: number;
        }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.target_kind).toBe("decision");
    expect(row?.attempts).toBe(0);
  });

  it("rejects with embeddingEnqueueFailed when target_kind violates check", async () => {
    await expect(
      ctx.enqueuer.enqueue({
        workspaceId: makeWorkspaceId(),
        targetKind: "bogus" as never,
        targetRowId: "01952f3c-2222-7000-8000-aaaaaaaaaa01",
        enqueuedAt: makeTimestamp(ANCHOR_TIME_MS),
      }),
    ).rejects.toMatchObject({ code: "memory.embedding.enqueue-failed" });
  });
});
