import { describe, expect, it } from "vitest";
import { MemoryApplicationError } from "../../../../src/modules/memory/application/errors/memory-application-error.ts";

describe("MemoryApplicationError factories", () => {
  const cause = new Error("boom");

  it("noActiveSession", () => {
    const e = MemoryApplicationError.noActiveSession("ws-1");
    expect(e).toBeInstanceOf(MemoryApplicationError);
    expect(e.code).toBe("memory.no-active-session");
    expect(e.message).toContain("ws-1");
  });

  it("sessionNotFound", () => {
    const e = MemoryApplicationError.sessionNotFound("s-1");
    expect(e.code).toBe("memory.session-not-found");
    expect(e.message).toContain("s-1");
  });

  it("taskNotFound", () => {
    const e = MemoryApplicationError.taskNotFound("t-1");
    expect(e.code).toBe("memory.task-not-found");
  });

  it("decisionNotFound", () => {
    const e = MemoryApplicationError.decisionNotFound("d-1");
    expect(e.code).toBe("memory.decision-not-found");
  });

  it("learningNotFound", () => {
    const e = MemoryApplicationError.learningNotFound("l-1");
    expect(e.code).toBe("memory.learning-not-found");
  });

  it("entityAlreadyExists", () => {
    const e = MemoryApplicationError.entityAlreadyExists("Foo", "class");
    expect(e.code).toBe("memory.entity-already-exists");
    expect(e.message).toContain("Foo");
    expect(e.message).toContain("class");
  });

  it("entityNotFound", () => {
    const e = MemoryApplicationError.entityNotFound("e-1");
    expect(e.code).toBe("memory.entity-not-found");
  });

  it("relationEndpointMissing", () => {
    const e = MemoryApplicationError.relationEndpointMissing("from", "x-1");
    expect(e.code).toBe("memory.relation-endpoint-missing");
    expect(e.message).toContain("from");
    expect(e.message).toContain("x-1");
  });

  it("importValidationFailed", () => {
    const e = MemoryApplicationError.importValidationFailed("bad", cause);
    expect(e.code).toBe("memory.import-validation-failed");
    expect(e.message).toContain("bad");
  });

  it("handoffParseFailed", () => {
    const e = MemoryApplicationError.handoffParseFailed("oversized");
    expect(e.code).toBe("memory.handoff-parse-failed");
  });

  it("exportSerializationFailed", () => {
    const e = MemoryApplicationError.exportSerializationFailed("circular");
    expect(e.code).toBe("memory.export-serialization-failed");
  });

  it("error.cause is non-enumerable (not leaked by JSON.stringify)", () => {
    const e = MemoryApplicationError.importValidationFailed("bad", cause);
    const json = JSON.stringify(e);
    expect(json).not.toContain("cause");
  });
});
