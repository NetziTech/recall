/**
 * E2E test — Flow B: `dist/server.js` driven through stdio JSON-RPC.
 *
 * The server is spawned as a child process with `stdio: pipe` and
 * fed line-delimited JSON-RPC frames (NDJSON, one frame per line).
 * Each test opens a session, sends one or more requests, asserts
 * their responses, and closes the session.
 *
 * Coverage matrix (Tarea 5.3 §1.B):
 *   - `initialize` returns server info + capabilities.
 *   - `tools/list` returns the six MVP tools.
 *   - `tools/call` for each tool against a real, just-bootstrapped
 *     workspace.
 *   - Wire-error edges: malformed JSON (`-32700`), unknown method
 *     (`-32601`), unknown tool name.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  freshWorkspace,
  readWorkspaceId,
  runCli,
  setupBinaryHarness,
  startMcpServer,
  type McpServerSession,
} from "./_helpers/binary-harness.ts";

interface WorkspaceHandle {
  readonly path: string;
  readonly cleanup: () => void;
}

let cliPath = "";
let serverPath = "";
const workspaces: WorkspaceHandle[] = [];
const sessions: McpServerSession[] = [];

beforeAll(() => {
  const harness = setupBinaryHarness();
  cliPath = harness.cliPath;
  serverPath = harness.serverPath;
});

afterEach(async () => {
  // Stop every server first so the SQLite handle releases the
  // workspace database file before we wipe it.
  while (sessions.length > 0) {
    const s = sessions.pop();
    if (s !== undefined) {
      try {
        await s.stop();
      } catch {
        // ignore — shutdown failures are not test failures.
      }
    }
  }
  while (workspaces.length > 0) {
    const ws = workspaces.pop();
    if (ws !== undefined) ws.cleanup();
  }
});

afterAll(() => {
  for (const ws of workspaces) ws.cleanup();
  workspaces.length = 0;
});

async function provisionWorkspace(displayName: string): Promise<{
  readonly path: string;
  readonly workspaceId: string;
}> {
  const ws = freshWorkspace();
  workspaces.push(ws);
  const init = await runCli(cliPath, [
    "init",
    "--workspace",
    ws.path,
    "--mode",
    "shared",
    "--display-name",
    displayName,
  ]);
  if (init.exitCode !== 0) {
    throw new Error(
      `provisionWorkspace: cli init failed with ${String(init.exitCode)}: ${init.stderr}`,
    );
  }
  const id = readWorkspaceId(ws.path);
  return { path: ws.path, workspaceId: id };
}

async function openSession(workspaceRoot: string): Promise<McpServerSession> {
  const session = await startMcpServer(serverPath, workspaceRoot);
  sessions.push(session);
  return session;
}

describe("e2e / B / dist/server.js — protocol handshake", () => {
  it("`initialize` returns the server info and capabilities", async () => {
    const ws = await provisionWorkspace("init-server");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    expect(response.error).toBeUndefined();
    expect(response.id).toBe(1);

    const result = response.result as {
      readonly protocolVersion: string;
      readonly serverInfo: { readonly name: string; readonly version: string };
      readonly capabilities: { readonly tools: Record<string, unknown> };
    };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo.name).toBe("recall");
    expect(typeof result.serverInfo.version).toBe("string");
    expect(result.capabilities.tools).toBeDefined();
  });

  it("`tools/list` returns exactly the six MVP tools", async () => {
    const ws = await provisionWorkspace("tools-list");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
    });
    expect(response.error).toBeUndefined();
    const result = response.result as {
      readonly tools: readonly { readonly name: string; readonly description: string }[];
    };
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "mem.context",
        "mem.health",
        "mem.init",
        "mem.recall",
        "mem.remember",
        "mem.task",
      ].sort(),
    );
    for (const tool of result.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("malformed JSON yields a `-32700` parse error with id=null", async () => {
    const ws = await provisionWorkspace("parse-err");
    const session = await openSession(ws.path);

    const response = await session.sendRaw("{ this is not json }");
    expect(response).not.toBeNull();
    if (response === null) return; // narrow for TS
    expect(response.id).toBeNull();
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32700);
  });

  it("unknown method yields a `-32601` method-not-found error", async () => {
    const ws = await provisionWorkspace("method-miss");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 99,
      method: "definitely/missing",
    });
    expect(response.id).toBe(99);
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32601);
  });

  it("`tools/call` to an unknown tool yields a structured error", async () => {
    const ws = await provisionWorkspace("tool-miss");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: { name: "mem.unknown", arguments: {} },
    });
    expect(response.id).toBe(100);
    expect(response.error).toBeDefined();
    // Wire codes for unknown tools land in `-32602` (invalid params)
    // or a custom server-error range. Just assert the error envelope
    // is well-formed.
    expect(typeof response.error?.code).toBe("number");
    expect(typeof response.error?.message).toBe("string");
  });
});

describe("e2e / B / dist/server.js — tools/call happy paths", () => {
  it("`mem.health` returns a structured snapshot", async () => {
    const ws = await provisionWorkspace("health-call");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "mem.health",
        arguments: { workspace_id: ws.workspaceId },
      },
    });
    expect(response.error).toBeUndefined();
    expect(response.result).toBeTruthy();
  });

  it("`mem.remember` (kind=decision) returns an id and embedding_status", async () => {
    const ws = await provisionWorkspace("remember-call");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "mem.remember",
        arguments: {
          workspace_id: ws.workspaceId,
          kind: "decision",
          content: "Use vec0 for vector indexing.",
          title: "vec0",
          rationale: "Native to SQLite via sqlite-vec.",
          tags: ["retrieval"],
        },
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as {
      readonly id: string;
      readonly kind: string;
      readonly upserted: boolean;
      readonly embedding_status: string;
    };
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.kind).toBe("decision");
    expect(typeof result.upserted).toBe("boolean");
    expect(typeof result.embedding_status).toBe("string");
  });

  it("`mem.recall` returns a results array (possibly empty) without erroring", async () => {
    // mem.recall touches the embedder. The shipped binary uses
    // FastembedEmbedder which downloads ONNX weights on first call.
    // The bootstrap is lazy: an empty corpus + a query string short-
    // circuits the dense branch, so the recall path runs purely
    // through FTS5 and does not exercise the model. We assert the
    // wire envelope is well-formed regardless of the rank quality.
    const ws = await provisionWorkspace("recall-call");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "mem.recall",
        arguments: {
          workspace_id: ws.workspaceId,
          query: "anything",
          top_k: 4,
        },
      },
    });
    // B-014/B-017 fix: bootstrap pins the real workspace id and
    // boots the database eagerly so recall queries succeed against
    // the empty corpus instead of surfacing -32603.
    expect(response.error).toBeUndefined();
    const result = response.result as {
      readonly results: readonly unknown[];
    };
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("`mem.context` returns a 7-layer bundle with wire literals", async () => {
    const ws = await provisionWorkspace("context-call");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: "mem.context",
        arguments: {
          workspace_id: ws.workspaceId,
          max_tokens: 2_000,
        },
      },
    });
    // B-014/B-017 fix: same root-cause as recall — request now
    // succeeds without -32603.
    expect(response.error).toBeUndefined();
    const result = response.result as {
      readonly bundle: {
        readonly layers: readonly { readonly name: string }[];
        readonly total_tokens: number;
      };
    };
    expect(Array.isArray(result.bundle.layers)).toBe(true);
    expect(typeof result.bundle.total_tokens).toBe("number");

    // FIXED (B-018): the GetContextBundleUseCase now always emits
    // the seven canonical layers from `docs/02 §4.2`, with empty
    // layers carrying `entries_count: 0` instead of being dropped.
    // Hard-assert all seven wire literals are present even on a
    // freshly-initialised workspace.
    const layerNames = result.bundle.layers.map((l) => l.name).sort();
    expect(layerNames).toEqual(
      [
        "system_identity",
        "project_constitution",
        "active_tasks",
        "recent_turns",
        "relevant_memory",
        "code_map",
        "open_questions",
      ].sort(),
    );
    expect(result.bundle.layers.length).toBe(7);
  });

  it("`mem.task` create returns a task_id", async () => {
    const ws = await provisionWorkspace("task-call");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "mem.task",
        arguments: {
          workspace_id: ws.workspaceId,
          action: "create",
          title: "Wire e2e tests",
          description: "Exercise the bundled binary with spawn().",
          priority: "high",
        },
      },
    });
    // B-015/B-017 fix: same root-cause as recall/context.
    expect(response.error).toBeUndefined();
    const result = response.result as {
      readonly action: string;
      readonly task_id: string;
    };
    expect(result.action).toBe("create");
    expect(typeof result.task_id).toBe("string");
    expect(result.task_id.length).toBeGreaterThan(0);
  });
});

describe("e2e / B / dist/server.js — tools/call without `workspace_id` (B-MCP-1)", () => {
  // Real MCP clients (Claude Code, Cursor, ...) launch the server
  // with the project root as cwd and DO NOT pass `workspace_id` on
  // every `tools/call` — they expect the server to know its own
  // workspace from the cwd alone. Before B-MCP-1 the five facades
  // (`mem.context`, `mem.recall`, `mem.remember`, `mem.task`,
  // `mem.health`) hard-required `workspace_id` in the wire input
  // and threw `McpFacadeNotImplementedError` otherwise — breaking
  // every standard client.
  //
  // These tests pin the contract that each tool SHOULD work without
  // any wire `workspace_id`, with the bootstrap-resolved id from
  // `<cwd>/.recall/config.json` filled in transparently.

  it("`mem.health` succeeds without `workspace_id` in arguments", async () => {
    const ws = await provisionWorkspace("health-no-wsid");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "mem.health",
        arguments: {},
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as { readonly workspace_id: string };
    // The bootstrap must have read .recall/config.json and stamped
    // the canonical id on the response.
    expect(result.workspace_id).toBe(ws.workspaceId);
  });

  it("`mem.remember` (kind=decision) succeeds without `workspace_id`", async () => {
    const ws = await provisionWorkspace("remember-no-wsid");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "mem.remember",
        arguments: {
          kind: "decision",
          content: "Use bootstrap-resolved workspace_id by default.",
          title: "B-MCP-1",
          rationale: "Standard MCP clients omit workspace_id on tools/call.",
        },
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as { readonly id: string; readonly kind: string };
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.kind).toBe("decision");
  });

  it("`mem.recall` succeeds without `workspace_id`", async () => {
    const ws = await provisionWorkspace("recall-no-wsid");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: "mem.recall",
        arguments: { query: "anything", top_k: 4 },
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as { readonly results: readonly unknown[] };
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("`mem.context` succeeds without `workspace_id`", async () => {
    const ws = await provisionWorkspace("context-no-wsid");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 34,
      method: "tools/call",
      params: {
        name: "mem.context",
        arguments: { max_tokens: 2_000 },
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as {
      readonly bundle: { readonly layers: readonly unknown[] };
    };
    expect(Array.isArray(result.bundle.layers)).toBe(true);
    expect(result.bundle.layers.length).toBe(7);
  });

  it("`mem.task` create succeeds without `workspace_id`", async () => {
    const ws = await provisionWorkspace("task-no-wsid");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 35,
      method: "tools/call",
      params: {
        name: "mem.task",
        arguments: {
          action: "create",
          title: "Validate B-MCP-1 fix",
          description: "task created without explicit workspace_id.",
          priority: "medium",
        },
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as {
      readonly action: string;
      readonly task_id: string;
    };
    expect(result.action).toBe("create");
    expect(result.task_id.length).toBeGreaterThan(0);
  });

  it("explicit wire `workspace_id` still overrides the bootstrap default", async () => {
    // A client that does pass a wire `workspace_id` continues to
    // honour it — both the tools/call response and the persisted
    // record should carry the explicit id. We use the same id the
    // bootstrap would have resolved so the call succeeds; the test
    // just exercises the override path so the wire-then-default
    // resolution rule does not regress.
    const ws = await provisionWorkspace("override-wsid");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 36,
      method: "tools/call",
      params: {
        name: "mem.health",
        arguments: { workspace_id: ws.workspaceId },
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as { readonly workspace_id: string };
    expect(result.workspace_id).toBe(ws.workspaceId);
  });

  it("malformed wire `workspace_id` surfaces a typed -32602 error", async () => {
    const ws = await provisionWorkspace("bad-wsid");
    const session = await openSession(ws.path);

    const response = await session.request({
      jsonrpc: "2.0",
      id: 37,
      method: "tools/call",
      params: {
        name: "mem.health",
        // Not a UUID v7 — must surface as -32602 (invalid params).
        arguments: { workspace_id: "deadbeef-0000-0000-0000-000000000000" },
      },
    });
    expect(response.error).toBeDefined();
    expect(response.error?.code).toBe(-32602);
  });
});

describe("e2e / B / dist/server.js — multi-request session", () => {
  it("a single server keeps state across init → remember → health requests", async () => {
    const ws = await provisionWorkspace("session-rt");
    const session = await openSession(ws.path);

    const initRes = await session.request({
      jsonrpc: "2.0",
      id: 21,
      method: "initialize",
    });
    expect(initRes.error).toBeUndefined();

    const listRes = await session.request({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/list",
    });
    expect(listRes.error).toBeUndefined();

    const rememberRes = await session.request({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "mem.remember",
        arguments: {
          workspace_id: ws.workspaceId,
          kind: "learning",
          content: "FTS5 hit cost dominates recall.",
          severity: "tip",
        },
      },
    });
    expect(rememberRes.error).toBeUndefined();

    const healthRes = await session.request({
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "mem.health",
        arguments: { workspace_id: ws.workspaceId },
      },
    });
    expect(healthRes.error).toBeUndefined();

    // Verify the server preserved request id correlation across the
    // four sequential calls.
    expect(initRes.id).toBe(21);
    expect(listRes.id).toBe(22);
    expect(rememberRes.id).toBe(23);
    expect(healthRes.id).toBe(24);
  });
});
