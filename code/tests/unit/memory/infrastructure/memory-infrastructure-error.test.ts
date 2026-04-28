import { describe, expect, it } from "vitest";
import { MemoryInfrastructureError } from "../../../../src/modules/memory/infrastructure/errors/memory-infrastructure-error.ts";
import { InfrastructureError } from "../../../../src/shared/infrastructure/errors/infrastructure-error.ts";

describe("MemoryInfrastructureError factories", () => {
  const cause = new Error("u");

  it("rowMalformed", () => {
    const e = MemoryInfrastructureError.rowMalformed(
      "decisions",
      "bad zod",
      cause,
    );
    expect(e).toBeInstanceOf(InfrastructureError);
    expect(e.code).toBe("memory.persistence.row-malformed");
    expect(e.message).toContain("decisions");
    expect(e.message).toContain("bad zod");
  });

  it("upsertFailed", () => {
    const e = MemoryInfrastructureError.upsertFailed("learnings", cause);
    expect(e.code).toBe("memory.persistence.upsert-failed");
    expect(e.message).toContain("learnings");
  });

  it("deleteFailed", () => {
    const e = MemoryInfrastructureError.deleteFailed("memory_wipe", cause);
    expect(e.code).toBe("memory.persistence.delete-failed");
  });

  it("queryFailed", () => {
    const e = MemoryInfrastructureError.queryFailed("entities", cause);
    expect(e.code).toBe("memory.persistence.query-failed");
    expect(e.message).toContain("entities");
  });

  it("embeddingEnqueueFailed", () => {
    const e = MemoryInfrastructureError.embeddingEnqueueFailed(
      "decision",
      "01952f3c-2222-7000-8000-bbbbbbbbbb01",
      cause,
    );
    expect(e.code).toBe("memory.embedding.enqueue-failed");
    expect(e.message).toContain("decision");
    expect(e.message).toContain("01952f3c-2222-7000-8000-bbbbbbbbbb01");
  });

  it("importParseFailed", () => {
    const e = MemoryInfrastructureError.importParseFailed("bad json");
    expect(e.code).toBe("memory.import.parse-failed");
    expect(e.message).toContain("bad json");
  });

  it("exportSerializeFailed", () => {
    const e = MemoryInfrastructureError.exportSerializeFailed("circular");
    expect(e.code).toBe("memory.export.serialize-failed");
  });

  it("handoffParseFailed", () => {
    const e = MemoryInfrastructureError.handoffParseFailed("oversized");
    expect(e.code).toBe("memory.handoff.parse-failed");
  });

  it("error.cause is non-enumerable (not leaked by JSON.stringify)", () => {
    const e = MemoryInfrastructureError.queryFailed("decisions", cause);
    const json = JSON.stringify(e);
    expect(json).not.toContain("cause");
  });
});
