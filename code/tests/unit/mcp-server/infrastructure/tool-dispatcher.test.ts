import { describe, it, expect } from "vitest";

import { ToolDispatcher } from "../../../../src/modules/mcp-server/infrastructure/dispatch/tool-dispatcher.ts";
import type { ToolUseCases } from "../../../../src/modules/mcp-server/infrastructure/dispatch/tool-dispatcher.ts";
import { StaticToolRegistry } from "../../../../src/modules/mcp-server/infrastructure/registry/static-tool-registry.ts";
import { ToolRegistration } from "../../../../src/modules/mcp-server/domain/aggregates/tool-registration.ts";
import { ToolName } from "../../../../src/modules/mcp-server/domain/value-objects/tool-name.ts";
import { ToolDescription } from "../../../../src/modules/mcp-server/domain/value-objects/tool-description.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { UnknownToolError } from "../../../../src/modules/mcp-server/domain/errors/unknown-tool-error.ts";
import { ToolDisabledError } from "../../../../src/modules/mcp-server/domain/errors/tool-disabled-error.ts";
import { InvalidParamsError } from "../../../../src/modules/mcp-server/infrastructure/errors/invalid-params-error.ts";
import type {
  InitInputWire,
  InitOutputWire,
  ContextInputWire,
  ContextOutputWire,
  RecallInputWire,
  RecallOutputWire,
  RememberInputWire,
  RememberOutputWire,
  TaskInputWire,
  TaskOutputWire,
  HealthInputWire,
  HealthOutputWire,
} from "../../../../src/modules/mcp-server/application/dtos/wire-types.dto.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────

interface CallRecord {
  readonly tool: string;
  readonly input: unknown;
}

function makeRegistry(opts?: {
  readonly disabled?: ReadonlySet<string>;
  readonly skip?: ReadonlySet<string>;
}): StaticToolRegistry {
  const registry = new StaticToolRegistry();
  const ts = Timestamp.fromEpochMs(1);
  for (const name of ToolName.all()) {
    if (opts?.skip?.has(name.toString()) === true) continue;
    const reg = ToolRegistration.register({
      name,
      description: ToolDescription.create(`desc for ${name.toString()}`),
      occurredAt: ts,
    });
    if (opts?.disabled?.has(name.toString()) === true) {
      reg.disable({ occurredAt: ts });
    }
    registry.register(reg);
  }
  return registry;
}

function makeUseCases(records: CallRecord[]): ToolUseCases {
  const initOut: InitOutputWire = {
    workspace_id: "ws-1",
    workspace_path: "/tmp/x",
    display_name: "x",
    schema_version: "0.1.0",
    mode: "shared",
    is_new: true,
    total_entries: 0,
  };
  const contextOut: ContextOutputWire = {
    bundle: { layers: [], total_tokens: 0 },
  };
  const recallOut: RecallOutputWire = {
    results: [],
    total_candidates: 0,
    total_tokens: 0,
  };
  const rememberOut: RememberOutputWire = {
    id: "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89",
    kind: "decision",
    upserted: true,
    embedding_status: "ready",
  };
  const taskOut: TaskOutputWire = {
    action: "create",
    task_id: "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89",
    updated_at: 1,
  };
  const healthOut: HealthOutputWire = {
    schema_version: "0.1.0",
    workspace_id: "ws-1",
    workspace_path: "/tmp/x",
    mode: "shared",
    encryption_status: "n/a",
    total_entries: 0,
    entries_by_kind: {},
    size_bytes: { memoria_db: 0, vectors_db: 0 },
    active_session: null,
    last_curator_run: null,
    embedding_model: "test",
    embedding_queue_pending: 0,
    fts_health: "ok",
    vector_index_health: "ok",
  };
  return {
    init: {
      init: async (input: InitInputWire): Promise<InitOutputWire> => {
        records.push({ tool: "mem.init", input });
        return Promise.resolve(initOut);
      },
    },
    context: {
      getContext: async (
        input: ContextInputWire,
      ): Promise<ContextOutputWire> => {
        records.push({ tool: "mem.context", input });
        return Promise.resolve(contextOut);
      },
    },
    recall: {
      recall: async (input: RecallInputWire): Promise<RecallOutputWire> => {
        records.push({ tool: "mem.recall", input });
        return Promise.resolve(recallOut);
      },
    },
    remember: {
      remember: async (
        input: RememberInputWire,
      ): Promise<RememberOutputWire> => {
        records.push({ tool: "mem.remember", input });
        return Promise.resolve(rememberOut);
      },
    },
    task: {
      task: async (input: TaskInputWire): Promise<TaskOutputWire> => {
        records.push({ tool: "mem.task", input });
        return Promise.resolve(taskOut);
      },
    },
    health: {
      health: async (input: HealthInputWire): Promise<HealthOutputWire> => {
        records.push({ tool: "mem.health", input });
        return Promise.resolve(healthOut);
      },
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("ToolDispatcher — happy path per MVP tool", () => {
  it("dispatches mem.init", async () => {
    const records: CallRecord[] = [];
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases(records));
    const out = await dispatcher.dispatch("mem.init", { mode: "shared" }, 100);
    expect(records.length).toBe(1);
    expect(records[0]?.tool).toBe("mem.init");
    expect(records[0]?.input).toEqual({ mode: "shared" });
    expect(out).toBeTruthy();
  });

  it("dispatches mem.context", async () => {
    const records: CallRecord[] = [];
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases(records));
    await dispatcher.dispatch("mem.context", { max_tokens: 1000 }, 1);
    expect(records[0]?.tool).toBe("mem.context");
  });

  it("dispatches mem.recall", async () => {
    const records: CallRecord[] = [];
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases(records));
    await dispatcher.dispatch("mem.recall", { query: "foo" }, 1);
    expect(records[0]?.tool).toBe("mem.recall");
  });

  it("dispatches mem.remember", async () => {
    const records: CallRecord[] = [];
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases(records));
    await dispatcher.dispatch(
      "mem.remember",
      { kind: "decision", title: "T", content: "we use TS" },
      1,
    );
    expect(records[0]?.tool).toBe("mem.remember");
  });

  it("dispatches mem.task", async () => {
    const records: CallRecord[] = [];
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases(records));
    await dispatcher.dispatch(
      "mem.task",
      { action: "create", title: "Test task" },
      1,
    );
    expect(records[0]?.tool).toBe("mem.task");
  });

  it("dispatches mem.health", async () => {
    const records: CallRecord[] = [];
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases(records));
    await dispatcher.dispatch("mem.health", {}, 1);
    expect(records[0]?.tool).toBe("mem.health");
  });
});

describe("ToolDispatcher — error paths", () => {
  it("throws UnknownToolError for unknown wire string (VO rejects)", async () => {
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases([]));
    await expect(
      dispatcher.dispatch("mem.bogus", {}, 1),
    ).rejects.toBeInstanceOf(UnknownToolError);
  });

  it("throws UnknownToolError when name not in registry", async () => {
    // Registry that lacks `mem.recall` while ToolName.recall() is still legal
    const registry = makeRegistry({
      skip: new Set<string>(["mem.recall"]),
    });
    const dispatcher = new ToolDispatcher(registry, makeUseCases([]));
    await expect(
      dispatcher.dispatch("mem.recall", { query: "x" }, 1),
    ).rejects.toBeInstanceOf(UnknownToolError);
  });

  it("throws ToolDisabledError when registration is disabled", async () => {
    const registry = makeRegistry({
      disabled: new Set<string>(["mem.recall"]),
    });
    const dispatcher = new ToolDispatcher(registry, makeUseCases([]));
    await expect(
      dispatcher.dispatch("mem.recall", { query: "x" }, 1),
    ).rejects.toBeInstanceOf(ToolDisabledError);
  });

  it("throws InvalidParamsError when Zod rejects (init: bad mode)", async () => {
    const records: CallRecord[] = [];
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases(records));
    await expect(
      dispatcher.dispatch("mem.init", { mode: "wrong" }, 1),
    ).rejects.toBeInstanceOf(InvalidParamsError);
    // Use case must NOT be invoked
    expect(records.length).toBe(0);
  });

  it("InvalidParamsError carries Zod issues with path", async () => {
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases([]));
    try {
      await dispatcher.dispatch(
        "mem.remember",
        { kind: "not-a-kind", content: "x" },
        1,
      );
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidParamsError);
      const ipe = err as InvalidParamsError;
      expect(ipe.details.length).toBeGreaterThan(0);
      // path entries should be string|number
      for (const issue of ipe.details) {
        for (const seg of issue.path) {
          expect(["string", "number"].includes(typeof seg)).toBe(true);
        }
      }
    }
  });

  it("InvalidParamsError when args is wrong type (string instead of object)", async () => {
    const dispatcher = new ToolDispatcher(makeRegistry(), makeUseCases([]));
    await expect(
      dispatcher.dispatch("mem.init", "string-args", 1),
    ).rejects.toBeInstanceOf(InvalidParamsError);
  });

  it("propagates use case errors", async () => {
    const records: CallRecord[] = [];
    const ucs = makeUseCases(records);
    const failing: ToolUseCases = {
      ...ucs,
      health: {
        health: async (): Promise<HealthOutputWire> => {
          await Promise.resolve();
          throw new Error("downstream boom");
        },
      },
    };
    const dispatcher = new ToolDispatcher(makeRegistry(), failing);
    await expect(dispatcher.dispatch("mem.health", {}, 1)).rejects.toThrow(
      "downstream boom",
    );
  });
});

describe("ToolDispatcher — bookkeeping", () => {
  it("records invocation count in registration on success", async () => {
    const records: CallRecord[] = [];
    const registry = makeRegistry();
    const dispatcher = new ToolDispatcher(registry, makeUseCases(records));
    await dispatcher.dispatch("mem.health", {}, 100);
    const reg = registry.findByName(ToolName.health());
    expect(reg).not.toBeNull();
    if (reg !== null) {
      expect(reg.getInvocationCount().toNumber()).toBe(1);
    }
  });

  it("does NOT bump invocation count when Zod rejects", async () => {
    const registry = makeRegistry();
    const dispatcher = new ToolDispatcher(registry, makeUseCases([]));
    try {
      await dispatcher.dispatch("mem.init", { mode: "bad" }, 1);
    } catch {
      // expected
    }
    const reg = registry.findByName(ToolName.init());
    expect(reg).not.toBeNull();
    if (reg !== null) {
      expect(reg.getInvocationCount().toNumber()).toBe(0);
    }
  });

  it("does not throw when bookkeeping fails (defensive swallow)", async () => {
    // Replace the registration with one whose `recordInvocation` throws.
    const registry = new StaticToolRegistry();
    const ts = Timestamp.fromEpochMs(1);
    const reg = ToolRegistration.register({
      name: ToolName.health(),
      description: ToolDescription.create("desc"),
      occurredAt: ts,
    });
    // Monkey-patch: throw on recordInvocation. We use the public API to
    // simulate a defect — bookkeeping must never override a successful
    // tool call.
    reg.recordInvocation = (): never => {
      throw new Error("bookkeeping crash");
    };
    registry.register(reg);
    const dispatcher = new ToolDispatcher(registry, makeUseCases([]));
    // Expect success despite bookkeeping crash
    await expect(dispatcher.dispatch("mem.health", {}, 1)).resolves.toBeTruthy();
  });

  it("records multiple invocations across different tools", async () => {
    const registry = makeRegistry();
    const dispatcher = new ToolDispatcher(registry, makeUseCases([]));
    await dispatcher.dispatch("mem.health", {}, 1);
    await dispatcher.dispatch("mem.health", {}, 2);
    await dispatcher.dispatch("mem.context", {}, 3);
    const health = registry.findByName(ToolName.health());
    const context = registry.findByName(ToolName.context());
    if (health !== null) {
      expect(health.getInvocationCount().toNumber()).toBe(2);
    }
    if (context !== null) {
      expect(context.getInvocationCount().toNumber()).toBe(1);
    }
  });
});
