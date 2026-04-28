import { describe, it, expect } from "vitest";

import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

const RAW = "01952f3b-7d8c-7b4a-94f1-a3f8d12e5c89";

describe("WorkspaceId", () => {
  it("from() creates a typed WorkspaceId", () => {
    const w = WorkspaceId.from(RAW);
    expect(w).toBeInstanceOf(WorkspaceId);
    expect(w.toString()).toBe(RAW);
  });

  it("rejects malformed UUIDs with workspace_id field", () => {
    try {
      WorkspaceId.from("nope");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidInputError);
      expect((err as InvalidInputError).field).toBe("workspace_id");
    }
  });

  it("normalizes uppercase to lowercase", () => {
    const w = WorkspaceId.from(RAW.toUpperCase());
    expect(w.toString()).toBe(RAW);
  });

  it("equals: distinct instances same value", () => {
    expect(WorkspaceId.from(RAW).equals(WorkspaceId.from(RAW))).toBe(true);
  });

  it("equals: different values", () => {
    const other = "01952f3b-7d8c-7000-8000-aaaaaaaaaaaa";
    expect(WorkspaceId.from(RAW).equals(WorkspaceId.from(other))).toBe(false);
  });
});
