/**
 * Unit tests for the B-MCP-1 fix: the five MCP tool facade adapters
 * resolve `WorkspaceId` from a constructor-injected default and only
 * fall back to the wire input when one is supplied. Real MCP clients
 * (Claude Code, Cursor, ...) launch the server with the project root
 * as cwd and DO NOT pass `workspace_id` on every `tools/call`; they
 * expect the server to know its own workspace from the cwd alone.
 *
 * The previous behaviour — throwing
 * `McpFacadeNotImplementedError` on absent wire input — broke every
 * standard client and is the regression closed by this commit.
 *
 * Coverage matrix (one assertion per axis × per facade):
 *
 *   | Facade                     | wire absent | wire override | wire malformed |
 *   |----------------------------|:-----------:|:-------------:|:--------------:|
 *   | `CheckHealthFacadeAdapter` | yes         | yes           | yes            |
 *   | `RememberFacadeAdapter`    | yes         | yes           | yes            |
 *   | `GetContextFacadeAdapter`  | yes         | -             | -              |
 *   | `RecallMemoryFacadeAdapter`| yes         | -             | -              |
 *   | `TrackTaskFacadeAdapter`   | yes         | -             | -              |
 *
 * (The override / malformed columns for the three non-health facades
 * are exercised end-to-end by `tests/e2e/B-mcp-server-binary.test.ts`
 * — duplicating them here would couple us to internal stub shapes
 * without raising the bug-detection signal.)
 *
 * The placeholder/init-flow safety axis: when the bootstrap supplies
 * the canonical placeholder (`00000000-0000-7000-8000-000000000000`,
 * the v7-valid UUID `buildContainer` injects when `config.json` does
 * not exist yet), the facade still wires a successful call — the use
 * case is the line of defence for "the placeholder workspace has no
 * data" semantics, not the boundary. The placeholder being a valid
 * UUID v7 means `WorkspaceId.from` accepts it; the bug B-MCP-1
 * documented an INVALID placeholder
 * (`00000000-0000-0000-0000-000000000000`) that hard-failed the
 * boundary on every call. We pin the v7-valid placeholder behaviour
 * here so a future regression cannot re-introduce the v4 placeholder.
 */
import { describe, expect, it } from "vitest";

import {
  CheckHealthFacadeAdapter,
  GetContextFacadeAdapter,
  RecallMemoryFacadeAdapter,
  RememberFacadeAdapter,
  TrackTaskFacadeAdapter,
} from "../../../../src/composition/facades/mcp-server-facades.ts";
import type { HealthCheckUseCase } from "../../../../src/modules/workspace/application/use-cases/health-check.use-case.ts";
import type { GetContextBundle } from "../../../../src/modules/retrieval/application/ports/in/get-context-bundle.port.ts";
import type { RecallMemory } from "../../../../src/modules/retrieval/application/ports/in/recall-memory.port.ts";
import type { RecordDecision } from "../../../../src/modules/memory/application/ports/in/record-decision.port.ts";
import type { RecordEntity } from "../../../../src/modules/memory/application/ports/in/record-entity.port.ts";
import type { RecordLearning } from "../../../../src/modules/memory/application/ports/in/record-learning.port.ts";
import type { RecordTurn } from "../../../../src/modules/memory/application/ports/in/record-turn.port.ts";
import type { TrackTask } from "../../../../src/modules/memory/application/ports/in/track-task.port.ts";
import type { ContextBundle } from "../../../../src/modules/retrieval/domain/aggregates/context-bundle.ts";
import type { RecallResult } from "../../../../src/modules/retrieval/domain/aggregates/recall-result.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";

const BOOTSTRAP_WORKSPACE_ID = "01940000-0000-7000-8000-000000000001";
const OVERRIDE_WORKSPACE_ID = "01940000-0000-7000-8000-000000000002";
const PLACEHOLDER_WORKSPACE_ID = "00000000-0000-7000-8000-000000000000";

function buildHealthUseCase(): {
  readonly useCase: HealthCheckUseCase;
} {
  // The HealthCheckUseCase is a concrete class with several ports
  // injected. The facade only invokes `.check(...)`; we return a
  // minimal fake satisfying that surface and erase the rest of the
  // class with a structural cast. The facade does not introspect any
  // other field, so this is safe and isolated.
  const fake = {
    check: () =>
      Promise.resolve({
        checks: [
          { id: "database.openable", status: "pass" as const, message: "" },
          { id: "embedder.loadable", status: "pass" as const, message: "" },
        ],
        healthy: true,
      }),
  };
  return { useCase: fake as unknown as HealthCheckUseCase };
}

describe("CheckHealthFacadeAdapter — workspace id resolution (B-MCP-1)", () => {
  const SCHEMA_VERSION = "1.0.0";
  const EMBEDDING_MODEL = "fastembed:BGESmallEN15";

  it("uses the constructor-injected workspace id when wire input omits it", async () => {
    const adapter = new CheckHealthFacadeAdapter(
      buildHealthUseCase().useCase,
      SCHEMA_VERSION,
      EMBEDDING_MODEL,
      WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID),
    );
    const out = await adapter.health({});
    expect(out.workspace_id).toBe(BOOTSTRAP_WORKSPACE_ID);
  });

  it("uses the wire `workspace_id` when present and valid", async () => {
    const adapter = new CheckHealthFacadeAdapter(
      buildHealthUseCase().useCase,
      SCHEMA_VERSION,
      EMBEDDING_MODEL,
      WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID),
    );
    const out = await adapter.health({ workspace_id: OVERRIDE_WORKSPACE_ID });
    expect(out.workspace_id).toBe(OVERRIDE_WORKSPACE_ID);
  });

  it("rejects a malformed wire `workspace_id` with a typed DomainError", async () => {
    const adapter = new CheckHealthFacadeAdapter(
      buildHealthUseCase().useCase,
      SCHEMA_VERSION,
      EMBEDDING_MODEL,
      WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID),
    );
    // Not a UUID v7 (version nibble is `0`, not `7`). The
    // dispatcher's error mapper translates this into JSON-RPC
    // -32602 INVALID_PARAMS.
    await expect(
      adapter.health({ workspace_id: "deadbeef-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("accepts the v7-valid bootstrap placeholder without hard-failing", async () => {
    // The bootstrap injects this placeholder when `.recall/config.json`
    // does not exist yet (the `recall init` flow). The facade must
    // accept it at the boundary; the downstream use case decides
    // what to do (the init flow never invokes `mem.health` against
    // this placeholder, so a successful boundary is harmless).
    const adapter = new CheckHealthFacadeAdapter(
      buildHealthUseCase().useCase,
      SCHEMA_VERSION,
      EMBEDDING_MODEL,
      WorkspaceId.from(PLACEHOLDER_WORKSPACE_ID),
    );
    const out = await adapter.health({});
    expect(out.workspace_id).toBe(PLACEHOLDER_WORKSPACE_ID);
  });

  it("preserves the back-compat `memoria_db` wire field name in `size_bytes`", async () => {
    // v0.1.0 shipped this name; renaming it without a major version
    // bump would silently break clients that snapshotted the shape.
    // Tracked as wire-schema debt; this assertion pins the contract.
    const adapter = new CheckHealthFacadeAdapter(
      buildHealthUseCase().useCase,
      SCHEMA_VERSION,
      EMBEDDING_MODEL,
      WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID),
    );
    const out = await adapter.health({});
    expect(out.size_bytes).toEqual({ memoria_db: 0, vectors_db: 0 });
  });
});

describe("RememberFacadeAdapter — workspace id resolution (B-MCP-1)", () => {
  // The remember facade fans out to five record use cases on the
  // `kind` discriminator. We only exercise the `decision` branch
  // here — the resolution helper is shared, so covering one branch
  // is enough to detect a regression of the resolver itself; the
  // E2E suite covers the full fan-out.
  function buildAdapter(injected: WorkspaceId): {
    readonly adapter: RememberFacadeAdapter;
    readonly capturedWorkspaceId: { current: WorkspaceId | null };
  } {
    const captured = { current: null as WorkspaceId | null };
    const recordDecision: RecordDecision = {
      record: (input) => {
        captured.current = input.workspaceId;
        return Promise.resolve({
          decisionId: DecisionId.from("01940000-0000-7000-8000-000000000aa1"),
          embeddingEnqueued: true,
        });
      },
    };
    const recordLearning = {} as RecordLearning;
    const recordEntity = {} as RecordEntity;
    const recordTurn = {} as RecordTurn;
    const trackTask = {} as TrackTask;

    return {
      adapter: new RememberFacadeAdapter(
        recordDecision,
        recordLearning,
        recordEntity,
        recordTurn,
        trackTask,
        injected,
      ),
      capturedWorkspaceId: captured,
    };
  }

  it("uses the injected default when the wire input omits `workspace_id`", async () => {
    const { adapter, capturedWorkspaceId } = buildAdapter(
      WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID),
    );
    await adapter.remember({
      kind: "decision",
      content: "Test decision rationale.",
      title: "test",
    });
    expect(capturedWorkspaceId.current?.toString()).toBe(BOOTSTRAP_WORKSPACE_ID);
  });

  it("uses the wire `workspace_id` when present and valid", async () => {
    const { adapter, capturedWorkspaceId } = buildAdapter(
      WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID),
    );
    await adapter.remember({
      workspace_id: OVERRIDE_WORKSPACE_ID,
      kind: "decision",
      content: "Test decision rationale.",
      title: "test",
    });
    expect(capturedWorkspaceId.current?.toString()).toBe(OVERRIDE_WORKSPACE_ID);
  });

  it("rejects a malformed wire `workspace_id`", async () => {
    const { adapter } = buildAdapter(WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID));
    await expect(
      adapter.remember({
        workspace_id: "deadbeef-0000-0000-0000-000000000000",
        kind: "decision",
        content: "x",
        title: "x",
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });
});

describe("GetContextFacadeAdapter — wire-omitted workspace id (B-MCP-1)", () => {
  it("uses the injected default when wire omits `workspace_id`", async () => {
    let captured: WorkspaceId | null = null;
    const useCase: GetContextBundle = {
      build: (input) => {
        captured = input.workspaceId;
        return Promise.resolve({
          getLayers: () => [],
        } as unknown as ContextBundle);
      },
    };
    const adapter = new GetContextFacadeAdapter(
      useCase,
      WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID),
    );
    await adapter.assemble({});
    expect((captured as WorkspaceId | null)?.toString()).toBe(
      BOOTSTRAP_WORKSPACE_ID,
    );
  });
});

describe("RecallMemoryFacadeAdapter — wire-omitted workspace id (B-MCP-1)", () => {
  it("uses the injected default when wire omits `workspace_id`", async () => {
    let captured: WorkspaceId | null = null;
    const useCase: RecallMemory = {
      recall: (input) => {
        captured = input.workspaceId;
        return Promise.resolve({
          getEntries: () => [],
          totalCandidates: 0,
          totalTokens: { toNumber: () => 0 },
          fallbackReason: null,
        } as unknown as RecallResult);
      },
    };
    const adapter = new RecallMemoryFacadeAdapter(
      useCase,
      WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID),
    );
    await adapter.recall({ query: "x" });
    expect((captured as WorkspaceId | null)?.toString()).toBe(
      BOOTSTRAP_WORKSPACE_ID,
    );
  });
});

describe("TrackTaskFacadeAdapter — wire-omitted workspace id (B-MCP-1)", () => {
  it("uses the injected default when wire omits `workspace_id`", async () => {
    let captured: WorkspaceId | null = null;
    const useCase = {
      create: (input: { workspaceId: WorkspaceId }) => {
        captured = input.workspaceId;
        return Promise.resolve({
          taskId: TaskId.from("01940000-0000-7000-8000-000000000bb1"),
        });
      },
      // Other methods are not invoked by the `create` action; the
      // adapter's exhaustive switch on `action` only reaches them
      // when the wire DTO carries those literals.
    } as unknown as TrackTask;
    const adapter = new TrackTaskFacadeAdapter(
      useCase,
      WorkspaceId.from(BOOTSTRAP_WORKSPACE_ID),
    );
    await adapter.task({
      action: "create",
      title: "t",
    });
    expect((captured as WorkspaceId | null)?.toString()).toBe(
      BOOTSTRAP_WORKSPACE_ID,
    );
  });
});
