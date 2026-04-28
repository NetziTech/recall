import { describe, it, expect } from "vitest";
import {
  InitInputSchema,
  ContextInputSchema,
  HealthInputSchema,
  RecallInputSchema,
  RememberInputSchema,
  TaskInputSchema,
} from "../../../../src/modules/mcp-server/infrastructure/validation/index.ts";

describe("InitInputSchema", () => {
  it("accepts valid input", () => {
    expect(
      InitInputSchema.safeParse({ mode: "shared" }).success,
    ).toBe(true);
  });

  it("accepts empty {}", () => {
    expect(InitInputSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown property (.strict)", () => {
    expect(
      InitInputSchema.safeParse({ unknown_field: 1 }).success,
    ).toBe(false);
  });

  it("rejects invalid mode", () => {
    expect(
      InitInputSchema.safeParse({ mode: "wrong" }).success,
    ).toBe(false);
  });

  it("rejects empty workspace_path string", () => {
    expect(
      InitInputSchema.safeParse({ workspace_path: "" }).success,
    ).toBe(false);
  });
});

describe("ContextInputSchema", () => {
  it("accepts wire layer literals", () => {
    expect(
      ContextInputSchema.safeParse({
        include_layers: ["system_identity", "code_map"],
      }).success,
    ).toBe(true);
  });

  it("rejects unknown layer", () => {
    expect(
      ContextInputSchema.safeParse({
        include_layers: ["unknown_layer"],
      }).success,
    ).toBe(false);
  });

  it("rejects empty include/exclude arrays", () => {
    expect(
      ContextInputSchema.safeParse({ include_layers: [] }).success,
    ).toBe(false);
  });

  it("layer_overrides accepts a record with all 7 layer keys", () => {
    expect(
      ContextInputSchema.safeParse({
        layer_overrides: {
          system_identity: 100,
          project_constitution: 100,
          active_tasks: 100,
          recent_turns: 100,
          relevant_memory: 100,
          code_map: 100,
          open_questions: 100,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects negative max_tokens", () => {
    expect(ContextInputSchema.safeParse({ max_tokens: -1 }).success).toBe(false);
  });
});

describe("RecallInputSchema", () => {
  it("accepts kinds with 'any' wildcard", () => {
    expect(
      RecallInputSchema.safeParse({ kinds: ["any"] }).success,
    ).toBe(true);
  });

  it("rejects empty kinds", () => {
    expect(RecallInputSchema.safeParse({ kinds: [] }).success).toBe(false);
  });

  it("accepts top_k positive integer", () => {
    expect(RecallInputSchema.safeParse({ top_k: 8 }).success).toBe(true);
  });

  it("rejects top_k zero", () => {
    expect(RecallInputSchema.safeParse({ top_k: 0 }).success).toBe(false);
  });

  it("accepts order_by relevance|recency|score|usage", () => {
    for (const o of ["relevance", "recency", "score", "usage"]) {
      expect(RecallInputSchema.safeParse({ order_by: o }).success).toBe(true);
    }
  });

  it("rejects invalid order_by", () => {
    expect(RecallInputSchema.safeParse({ order_by: "alpha" }).success).toBe(
      false,
    );
  });
});

describe("RememberInputSchema", () => {
  it("accepts decision content", () => {
    expect(
      RememberInputSchema.safeParse({
        kind: "decision",
        content: "we use TypeScript",
      }).success,
    ).toBe(true);
  });

  it("rejects 'any' kind (recall-only wildcard)", () => {
    expect(
      RememberInputSchema.safeParse({
        kind: "any",
        content: "x",
      }).success,
    ).toBe(false);
  });

  it("rejects empty content", () => {
    expect(
      RememberInputSchema.safeParse({ kind: "decision", content: "" }).success,
    ).toBe(false);
  });

  it("rejects missing kind", () => {
    expect(
      RememberInputSchema.safeParse({ content: "x" }).success,
    ).toBe(false);
  });
});

describe("TaskInputSchema", () => {
  it("accepts create action", () => {
    expect(
      TaskInputSchema.safeParse({ action: "create", title: "foo" }).success,
    ).toBe(true);
  });

  it("rejects unknown action", () => {
    expect(TaskInputSchema.safeParse({ action: "frob" }).success).toBe(false);
  });

  it("accepts list action with filter", () => {
    expect(
      TaskInputSchema.safeParse({
        action: "list",
        filter: { status: "any" },
      }).success,
    ).toBe(true);
  });

  it("accepts priority enum", () => {
    expect(
      TaskInputSchema.safeParse({
        action: "create",
        priority: "high",
      }).success,
    ).toBe(true);
  });
});

describe("HealthInputSchema", () => {
  it("accepts {}", () => {
    expect(HealthInputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts verbose boolean", () => {
    expect(HealthInputSchema.safeParse({ verbose: true }).success).toBe(true);
  });

  it("rejects unknown property", () => {
    expect(HealthInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});
