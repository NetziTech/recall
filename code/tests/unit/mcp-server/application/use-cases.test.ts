import { describe, it, expect } from "vitest";
import { InitWorkspaceUseCase } from "../../../../src/modules/mcp-server/application/use-cases/init-workspace.use-case.ts";
import { CheckHealthUseCase } from "../../../../src/modules/mcp-server/application/use-cases/check-health.use-case.ts";
import { GetContextUseCase } from "../../../../src/modules/mcp-server/application/use-cases/get-context.use-case.ts";
import { RecallMemoryUseCase } from "../../../../src/modules/mcp-server/application/use-cases/recall-memory.use-case.ts";
import { RememberUseCase } from "../../../../src/modules/mcp-server/application/use-cases/remember.use-case.ts";
import { TrackTaskUseCase } from "../../../../src/modules/mcp-server/application/use-cases/track-task.use-case.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";
import type {
  InitOutputWire,
  HealthOutputWire,
  ContextOutputWire,
  RecallOutputWire,
  RememberOutputWire,
  TaskOutputWire,
} from "../../../../src/modules/mcp-server/application/dtos/wire-types.dto.ts";

describe("InitWorkspaceUseCase", () => {
  it("forwards to facade and logs", async () => {
    const expected: InitOutputWire = {
      workspace_id: "ws-1",
      mode: "shared",
      is_new: true,
      schema_version: "0.1.0",
      embedder: { provider: "fastembed", dimension: 384 },
    };
    const logger = new RecordingLogger();
    const useCase = new InitWorkspaceUseCase(
      { initialize: async () => Promise.resolve(expected) },
      logger,
    );
    const out = await useCase.init({});
    expect(out).toBe(expected);
    expect(logger.entries.find((e) => e.level === "info")?.message).toBe(
      "tool invocation completed",
    );
  });

  it("propagates errors from facade", async () => {
    const useCase = new InitWorkspaceUseCase(
      {
        initialize: async () => {
          throw new Error("facade fail");
        },
      },
      new RecordingLogger(),
    );
    await expect(useCase.init({})).rejects.toThrow("facade fail");
  });
});

describe("CheckHealthUseCase", () => {
  it("forwards to facade and logs summary", async () => {
    const expected: HealthOutputWire = {
      workspace_id: "ws-1",
      mode: "shared",
      schema_version: "0.1.0",
      total_entries: 10,
      encryption_status: "not-applicable",
      fts_health: "ok",
      vector_index_health: "ok",
      warnings: [],
    };
    const logger = new RecordingLogger();
    const useCase = new CheckHealthUseCase(
      { health: async () => Promise.resolve(expected) },
      logger,
    );
    const out = await useCase.health({});
    expect(out).toBe(expected);
    expect(logger.entries.find((e) => e.level === "info")).toBeDefined();
  });
});

describe("GetContextUseCase", () => {
  it("forwards to facade", async () => {
    const expected: ContextOutputWire = {
      workspace_id: "ws-1",
      bundle: { layers: [], total_tokens: 0 },
    };
    const useCase = new GetContextUseCase(
      { assemble: async () => Promise.resolve(expected) },
      new RecordingLogger(),
    );
    const out = await useCase.getContext({});
    expect(out).toBe(expected);
  });
});

describe("RecallMemoryUseCase", () => {
  it("forwards to facade", async () => {
    const expected: RecallOutputWire = {
      workspace_id: "ws-1",
      results: [],
      total: 0,
    };
    const useCase = new RecallMemoryUseCase(
      { recall: async () => Promise.resolve(expected) },
      new RecordingLogger(),
    );
    const out = await useCase.recall({});
    expect(out).toBe(expected);
  });
});

describe("RememberUseCase", () => {
  it("forwards to facade", async () => {
    const expected: RememberOutputWire = {
      workspace_id: "ws-1",
      id: "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89",
      kind: "decision",
      created_at_ms: 1,
    };
    const useCase = new RememberUseCase(
      { remember: async () => Promise.resolve(expected) },
      new RecordingLogger(),
    );
    const out = await useCase.remember({
      kind: "decision",
      content: "we use TypeScript",
    });
    expect(out).toBe(expected);
  });
});

describe("TrackTaskUseCase", () => {
  it("forwards to facade", async () => {
    const expected: TaskOutputWire = {
      action: "create",
      workspace_id: "ws-1",
      task: {
        id: "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89",
        title: "foo",
        status: "todo",
        priority: "medium",
        created_at_ms: 1,
        updated_at_ms: 1,
        tags: [],
        blocked_by: [],
      },
    };
    const useCase = new TrackTaskUseCase(
      { task: async () => Promise.resolve(expected) },
      new RecordingLogger(),
    );
    const out = await useCase.task({ action: "create", title: "foo" });
    expect(out).toBe(expected);
  });
});
