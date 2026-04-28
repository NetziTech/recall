import { describe, it, expect } from "vitest";

import {
  JsonRpcHandler,
  type ServerInfo,
} from "../../../../src/modules/mcp-server/infrastructure/transport/json-rpc-handler.ts";
import { ToolDispatcher } from "../../../../src/modules/mcp-server/infrastructure/dispatch/tool-dispatcher.ts";
import type { ToolUseCases } from "../../../../src/modules/mcp-server/infrastructure/dispatch/tool-dispatcher.ts";
import { StaticToolRegistry } from "../../../../src/modules/mcp-server/infrastructure/registry/static-tool-registry.ts";
import { ToolRegistration } from "../../../../src/modules/mcp-server/domain/aggregates/tool-registration.ts";
import { ToolName } from "../../../../src/modules/mcp-server/domain/value-objects/tool-name.ts";
import { ToolDescription } from "../../../../src/modules/mcp-server/domain/value-objects/tool-description.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { DomainError } from "../../../../src/shared/domain/errors/domain-error.ts";
import { JsonRpcErrorCodes } from "../../../../src/shared/domain/errors/json-rpc-error-codes.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";
import type {
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from "../../../../src/modules/mcp-server/infrastructure/transport/json-rpc-types.ts";
import type {
  InitOutputWire,
  ContextOutputWire,
  RecallOutputWire,
  RememberOutputWire,
  TaskOutputWire,
  HealthOutputWire,
} from "../../../../src/modules/mcp-server/application/dtos/wire-types.dto.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────

const SERVER_INFO: ServerInfo = {
  name: "recall",
  version: "0.1.0",
  protocolVersion: "2025-06-18",
};

interface UseCaseHooks {
  readonly init?: () => Promise<InitOutputWire>;
  readonly context?: () => Promise<ContextOutputWire>;
  readonly recall?: () => Promise<RecallOutputWire>;
  readonly remember?: () => Promise<RememberOutputWire>;
  readonly task?: () => Promise<TaskOutputWire>;
  readonly health?: () => Promise<HealthOutputWire>;
}

function buildDefaultUseCases(hooks: UseCaseHooks): ToolUseCases {
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
    init: { init: hooks.init ?? ((): Promise<InitOutputWire> => Promise.resolve(initOut)) },
    context: {
      getContext:
        hooks.context ??
        ((): Promise<ContextOutputWire> => Promise.resolve(contextOut)),
    },
    recall: {
      recall:
        hooks.recall ??
        ((): Promise<RecallOutputWire> => Promise.resolve(recallOut)),
    },
    remember: {
      remember:
        hooks.remember ??
        ((): Promise<RememberOutputWire> => Promise.resolve(rememberOut)),
    },
    task: {
      task:
        hooks.task ??
        ((): Promise<TaskOutputWire> => Promise.resolve(taskOut)),
    },
    health: {
      health:
        hooks.health ??
        ((): Promise<HealthOutputWire> => Promise.resolve(healthOut)),
    },
  };
}

function buildHandler(opts?: {
  readonly useCases?: UseCaseHooks;
  readonly skip?: ReadonlySet<string>;
  readonly disabled?: ReadonlySet<string>;
}): {
  readonly handler: JsonRpcHandler;
  readonly logger: RecordingLogger;
  readonly registry: StaticToolRegistry;
} {
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
  const dispatcher = new ToolDispatcher(
    registry,
    buildDefaultUseCases(opts?.useCases ?? {}),
  );
  const logger = new RecordingLogger();
  const clock = new FakeClock({ initialMs: 100 });
  const handler = new JsonRpcHandler(
    dispatcher,
    registry,
    SERVER_INFO,
    clock,
    logger,
  );
  return { handler, logger, registry };
}

function asResponse(result: { kind: string }): JsonRpcResponse {
  if (result.kind !== "response") {
    throw new Error(`expected kind=response, got ${result.kind}`);
  }
  return (result as { kind: "response"; response: JsonRpcResponse }).response;
}

function asSuccess(response: JsonRpcResponse): JsonRpcSuccessResponse {
  if ("error" in response) {
    throw new Error(`expected success but got error code ${response.error.code}`);
  }
  return response;
}

function asError(response: JsonRpcResponse): JsonRpcErrorResponse {
  if (!("error" in response)) {
    throw new Error("expected error but got success");
  }
  return response;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("JsonRpcHandler — parse / envelope failures", () => {
  it("returns -32700 PARSE_ERROR for invalid JSON", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle("{not-json");
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32700);
    expect(resp.id).toBeNull();
    expect(resp.jsonrpc).toBe("2.0");
  });

  it("returns -32600 INVALID_REQUEST when not an object", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle("[]");
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32600);
    expect(resp.id).toBeNull();
  });

  it("returns -32600 INVALID_REQUEST when method is missing", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle('{"jsonrpc":"2.0","id":1}');
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32600);
  });

  it("returns -32600 INVALID_REQUEST when jsonrpc != 2.0", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"1.0","method":"initialize","id":1}',
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32600);
  });

  it("returns -32600 when id has invalid shape (boolean)", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"initialize","id":true}',
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32600);
    expect(resp.id).toBeNull();
  });

  it("returns -32600 when id is fractional number", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"initialize","id":1.5}',
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32600);
  });

  it("returns -32600 when id is empty string", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"initialize","id":""}',
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32600);
  });
});

describe("JsonRpcHandler — initialize", () => {
  it("returns server info and capabilities for initialize", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"initialize","id":1}',
    );
    const resp = asSuccess(asResponse(out));
    expect(resp.id).toBe(1);
    expect(resp.jsonrpc).toBe("2.0");
    const result = resp.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: { tools: Record<string, never> };
    };
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo.name).toBe("recall");
    expect(result.serverInfo.version).toBe("0.1.0");
    expect(result.capabilities.tools).toBeDefined();
  });

  it("preserves string id verbatim", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"initialize","id":"req-abc"}',
    );
    const resp = asSuccess(asResponse(out));
    expect(resp.id).toBe("req-abc");
  });
});

describe("JsonRpcHandler — tools/list", () => {
  it("returns the catalogue of registered tools", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"tools/list","id":2}',
    );
    const resp = asSuccess(asResponse(out));
    const result = resp.result as {
      tools: readonly { name: string; description: string }[];
    };
    expect(result.tools.length).toBe(6);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("mem.init");
    expect(names).toContain("mem.recall");
  });

  it("excludes disabled tools", async () => {
    const { handler } = buildHandler({
      disabled: new Set<string>(["mem.recall"]),
    });
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"tools/list","id":3}',
    );
    const resp = asSuccess(asResponse(out));
    const result = resp.result as {
      tools: readonly { name: string }[];
    };
    expect(result.tools.length).toBe(5);
    expect(result.tools.find((t) => t.name === "mem.recall")).toBeUndefined();
  });
});

describe("JsonRpcHandler — tools/call", () => {
  it("dispatches tools/call with valid args", async () => {
    let called = false;
    const { handler } = buildHandler({
      useCases: {
        health: async (): Promise<HealthOutputWire> => {
          called = true;
          return Promise.resolve({
            schema_version: "0.1.0",
            workspace_id: "ws-1",
            workspace_path: "/tmp/x",
            mode: "shared",
            encryption_status: "n/a",
            total_entries: 42,
            entries_by_kind: {},
            size_bytes: { memoria_db: 0, vectors_db: 0 },
            active_session: null,
            last_curator_run: null,
            embedding_model: "test",
            embedding_queue_pending: 0,
            fts_health: "ok",
            vector_index_health: "ok",
          });
        },
      },
    });
    const out = await handler.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "mem.health", arguments: {} },
      }),
    );
    const resp = asSuccess(asResponse(out));
    expect(called).toBe(true);
    const result = resp.result as { total_entries: number };
    expect(result.total_entries).toBe(42);
  });

  it("works without `arguments` field (default to {})", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "mem.health" },
      }),
    );
    const resp = asResponse(out);
    expect("error" in resp ? resp.error.code : "ok").toBe("ok");
  });

  it("returns -32601 METHOD_NOT_FOUND for unknown tool name", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "mem.nonexistent", arguments: {} },
      }),
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32601);
  });

  it("returns -32600 when params is missing", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"tools/call","id":1}',
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32600);
  });

  it("returns -32600 when params is not an object", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":[]}',
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32600);
  });

  it("returns -32600 when name is empty", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":""}}',
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32600);
  });

  it("returns -32602 INVALID_PARAMS with issues data", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "mem.init", arguments: { mode: "wrong" } },
      }),
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32602);
    expect(resp.error.data).toBeDefined();
    const data = resp.error.data as { issues: readonly unknown[] };
    expect(Array.isArray(data.issues)).toBe(true);
    expect(data.issues.length).toBeGreaterThan(0);
  });
});

describe("JsonRpcHandler — unknown method routing", () => {
  it("returns -32601 for completely unknown methods", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"unknown/method","id":1}',
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32601);
  });
});

describe("JsonRpcHandler — notifications (no id)", () => {
  it("never responds when id is absent for valid request", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"initialize"}',
    );
    expect(out.kind).toBe("no-response");
  });

  it("never responds when id is null for valid request", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"initialize","id":null}',
    );
    expect(out.kind).toBe("no-response");
  });

  it("notification with failing tool also returns no-response", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        // no id → notification
        params: { name: "mem.init", arguments: { mode: "wrong" } },
      }),
    );
    expect(out.kind).toBe("no-response");
  });

  it("still responds with parse error on notification (id=null)", async () => {
    // Per JSON-RPC 2.0 §4.1, parse errors return id:null even though the
    // client did not send an id (it can't be correlated either way).
    const { handler } = buildHandler();
    const out = await handler.handle("not-json");
    const resp = asError(asResponse(out));
    expect(resp.id).toBeNull();
  });
});

describe("JsonRpcHandler — error mapping", () => {
  it("maps domain errors via the error-mapper", async () => {
    class WorkspaceNotFound extends DomainError {
      public readonly code = "workspace.not-found";
    }
    const { handler } = buildHandler({
      useCases: {
        health: (): Promise<HealthOutputWire> => {
          throw new WorkspaceNotFound("not found");
        },
      },
    });
    const out = await handler.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "mem.health", arguments: {} },
      }),
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(JsonRpcErrorCodes.WORKSPACE_NOT_FOUND);
  });

  it("maps unmapped throwables to -32603 INTERNAL_ERROR", async () => {
    const { handler } = buildHandler({
      useCases: {
        health: (): Promise<HealthOutputWire> => {
          throw new Error("kaboom");
        },
      },
    });
    const out = await handler.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "mem.health", arguments: {} },
      }),
    );
    const resp = asError(asResponse(out));
    expect(resp.error.code).toBe(-32603);
    // Should NOT leak underlying message
    expect(resp.error.message).toBe("internal error");
  });

  it("logs every method-handler failure", async () => {
    const { handler, logger } = buildHandler({
      useCases: {
        health: (): Promise<HealthOutputWire> => {
          throw new Error("kaboom");
        },
      },
    });
    await handler.handle(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 1,
        params: { name: "mem.health", arguments: {} },
      }),
    );
    const warnEntries = logger.entries.filter((e) => e.level === "warn");
    expect(warnEntries.length).toBeGreaterThanOrEqual(1);
  });
});

describe("JsonRpcHandler — id correlation", () => {
  it("echoes string id verbatim in error responses", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"unknown/method","id":"my-id-42"}',
    );
    const resp = asError(asResponse(out));
    expect(resp.id).toBe("my-id-42");
  });

  it("echoes integer id verbatim in success", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"initialize","id":99}',
    );
    const resp = asSuccess(asResponse(out));
    expect(resp.id).toBe(99);
  });

  it("preserves number type (not coerced to string)", async () => {
    const { handler } = buildHandler();
    const out = await handler.handle(
      '{"jsonrpc":"2.0","method":"tools/list","id":7}',
    );
    const resp = asSuccess(asResponse(out));
    expect(typeof resp.id).toBe("number");
  });
});
