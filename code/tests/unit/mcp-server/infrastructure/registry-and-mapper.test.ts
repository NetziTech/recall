import { describe, it, expect } from "vitest";
import { StaticToolRegistry } from "../../../../src/modules/mcp-server/infrastructure/registry/static-tool-registry.ts";
import { ToolRegistration } from "../../../../src/modules/mcp-server/domain/aggregates/tool-registration.ts";
import { ToolName } from "../../../../src/modules/mcp-server/domain/value-objects/tool-name.ts";
import { ToolDescription } from "../../../../src/modules/mcp-server/domain/value-objects/tool-description.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { mapErrorToJsonRpc } from "../../../../src/modules/mcp-server/infrastructure/dispatch/error-mapper.ts";
import { InvalidParamsError } from "../../../../src/modules/mcp-server/infrastructure/errors/invalid-params-error.ts";
import { ParseError } from "../../../../src/modules/mcp-server/infrastructure/errors/parse-error.ts";
import { InvalidRequestError } from "../../../../src/modules/mcp-server/infrastructure/errors/invalid-request-error.ts";
import { InternalError } from "../../../../src/modules/mcp-server/infrastructure/errors/internal-error.ts";
import { UnknownToolError } from "../../../../src/modules/mcp-server/domain/errors/unknown-tool-error.ts";
import { ToolDisabledError } from "../../../../src/modules/mcp-server/domain/errors/tool-disabled-error.ts";
import { JsonRpcErrorCodes } from "../../../../src/shared/domain/errors/json-rpc-error-codes.ts";
import { DomainError } from "../../../../src/shared/domain/errors/domain-error.ts";

const buildRegistration = (name: ToolName): ToolRegistration =>
  ToolRegistration.register({
    name,
    description: ToolDescription.create("test"),
    occurredAt: Timestamp.fromEpochMs(1),
  });

describe("StaticToolRegistry", () => {
  it("register + findByName round-trips", () => {
    const registry = new StaticToolRegistry();
    const reg = buildRegistration(ToolName.init());
    registry.register(reg);
    expect(registry.findByName(ToolName.init())).toBe(reg);
  });

  it("findByName returns null for unknown", () => {
    const registry = new StaticToolRegistry();
    expect(registry.findByName(ToolName.recall())).toBeNull();
  });

  it("listAll returns frozen snapshot", () => {
    const registry = new StaticToolRegistry();
    registry.register(buildRegistration(ToolName.init()));
    registry.register(buildRegistration(ToolName.recall()));
    const all = registry.listAll();
    expect(all.length).toBe(2);
    expect(Object.isFrozen(all)).toBe(true);
  });

  it("register throws on duplicate name", () => {
    const registry = new StaticToolRegistry();
    registry.register(buildRegistration(ToolName.init()));
    expect(() => registry.register(buildRegistration(ToolName.init()))).toThrow();
  });

  it("findByName resolves regardless of which ToolName instance is used", () => {
    const registry = new StaticToolRegistry();
    registry.register(buildRegistration(ToolName.create("mem.init")));
    expect(registry.findByName(ToolName.init())).not.toBeNull();
  });

  it("registers all 6 tools", () => {
    const registry = new StaticToolRegistry();
    for (const name of ToolName.all()) {
      registry.register(buildRegistration(name));
    }
    expect(registry.listAll().length).toBe(6);
  });
});

describe("mapErrorToJsonRpc", () => {
  it("maps ParseError to -32700", () => {
    const out = mapErrorToJsonRpc(new ParseError("bad json"));
    expect(out.code).toBe(-32700);
  });

  it("maps InvalidRequestError to -32600", () => {
    const out = mapErrorToJsonRpc(new InvalidRequestError("bad request"));
    expect(out.code).toBe(-32600);
  });

  it("maps InvalidParamsError to -32602 with structured data", () => {
    const out = mapErrorToJsonRpc(
      new InvalidParamsError("bad params", { details: [] }),
    );
    expect(out.code).toBe(-32602);
    expect(out.data).toEqual({ issues: [] });
  });

  it("maps InternalError to -32603", () => {
    const out = mapErrorToJsonRpc(new InternalError("boom"));
    expect(out.code).toBe(-32603);
  });

  it("maps UnknownToolError to -32601", () => {
    const out = mapErrorToJsonRpc(new UnknownToolError("mem.unknown"));
    expect(out.code).toBe(-32601);
  });

  it("maps ToolDisabledError to its custom code", () => {
    const out = mapErrorToJsonRpc(new ToolDisabledError(ToolName.init()));
    expect(out.code).toBeLessThan(0);
  });

  it("maps generic DomainError with known prefix code", () => {
    class WorkspaceNotFound extends DomainError {
      public readonly code = "workspace.not-found";
    }
    const out = mapErrorToJsonRpc(new WorkspaceNotFound("not found"));
    expect(out.code).toBe(JsonRpcErrorCodes.WORKSPACE_NOT_FOUND);
  });

  it("maps secrets.detected to SECRET_DETECTED", () => {
    class SecretDetected extends DomainError {
      public readonly code = "secrets.detected";
    }
    const out = mapErrorToJsonRpc(new SecretDetected("secret"));
    expect(out.code).toBe(JsonRpcErrorCodes.SECRET_DETECTED);
  });

  it("maps encryption.invalid-key to INVALID_KEY", () => {
    class InvalidKey extends DomainError {
      public readonly code = "encryption.invalid-key";
    }
    const out = mapErrorToJsonRpc(new InvalidKey("bad"));
    expect(out.code).toBe(JsonRpcErrorCodes.INVALID_KEY);
  });

  it("falls back to -32602 for unknown DomainError", () => {
    class WeirdError extends DomainError {
      public readonly code = "weird.error";
    }
    const out = mapErrorToJsonRpc(new WeirdError("weird"));
    expect(out.code).toBe(-32602);
  });

  it("falls back to -32603 for non-DomainError", () => {
    const out = mapErrorToJsonRpc(new Error("foo"));
    expect(out.code).toBe(-32603);
    expect(out.message).toBe("internal error");
  });

  it("falls back to -32603 for non-Error throwable", () => {
    const out = mapErrorToJsonRpc("string-error");
    expect(out.code).toBe(-32603);
  });

  it("truncates long messages", () => {
    const longMsg = "x".repeat(2000);
    const out = mapErrorToJsonRpc(new InvalidRequestError(longMsg));
    expect(out.message.length).toBeLessThanOrEqual(1024);
  });

  it("maps each well-known custom code", () => {
    const cases: Array<[string, number]> = [
      ["workspace.session-expired", JsonRpcErrorCodes.SESSION_EXPIRED],
      ["workspace.disk-full", JsonRpcErrorCodes.DISK_FULL],
      [
        "workspace.schema-version-incompatible",
        JsonRpcErrorCodes.SCHEMA_VERSION_INCOMPATIBLE,
      ],
      [
        "retrieval.embedder-unavailable",
        JsonRpcErrorCodes.EMBEDDING_SERVICE_UNAVAILABLE,
      ],
      ["curator.rate-limited", JsonRpcErrorCodes.RATE_LIMITED],
      ["encryption.locked", JsonRpcErrorCodes.ENCRYPTED_LOCKED],
      ["encryption.key-revoked", JsonRpcErrorCodes.KEY_REVOKED],
      ["memory.task-not-found", JsonRpcErrorCodes.TASK_NOT_FOUND],
    ];
    for (const [code, expected] of cases) {
      class C extends DomainError {
        public readonly code = code;
      }
      const out = mapErrorToJsonRpc(new C("x"));
      expect(out.code).toBe(expected);
    }
  });

  it("maps coded application errors (Error subclass with `.code: string`)", () => {
    // `MemoryApplicationError` and `CuratorApplicationError`
    // intentionally extend `Error` (not `DomainError`) per their
    // class JSDoc; the mapper still routes their stable `code` onto
    // a wire code via duck typing.
    class CodedAppError extends Error {
      public readonly code = "memory.task-not-found";
      public constructor(message: string) {
        super(message);
        this.name = "CodedAppError";
      }
    }
    const out = mapErrorToJsonRpc(new CodedAppError("not found"));
    expect(out.code).toBe(JsonRpcErrorCodes.TASK_NOT_FOUND);
    expect(out.message).toContain("not found");
  });

  it("falls back to -32602 for coded Error with unknown prefix", () => {
    class WeirdAppError extends Error {
      public readonly code = "weird.app.thing";
    }
    const out = mapErrorToJsonRpc(new WeirdAppError("weird"));
    expect(out.code).toBe(-32602);
  });

  describe("W-3.5-SEC-L2 path-leak redaction across the wire envelope", () => {
    const SECRET_ROOT = "/Users/alice/private/workspace";
    const SECRET_HOOK = "/Users/alice/private/workspace/.git/hooks/pre-commit";

    it("WorkspaceInfrastructureError.configMissing does not leak the path", async () => {
      const { WorkspaceInfrastructureError } = await import(
        "../../../../src/modules/workspace/infrastructure/errors/workspace-infrastructure-error.ts"
      );
      const out = mapErrorToJsonRpc(
        WorkspaceInfrastructureError.configMissing(SECRET_ROOT),
      );
      expect(out.message).not.toContain(SECRET_ROOT);
      expect(out.message).not.toContain("/Users/alice");
    });

    it("WorkspaceInfrastructureError.detectionFailed does not leak the path", async () => {
      const { WorkspaceInfrastructureError } = await import(
        "../../../../src/modules/workspace/infrastructure/errors/workspace-infrastructure-error.ts"
      );
      const out = mapErrorToJsonRpc(
        WorkspaceInfrastructureError.detectionFailed(SECRET_ROOT, new Error("u")),
      );
      expect(out.message).not.toContain(SECRET_ROOT);
    });

    it("WorkspaceInfrastructureError.gitignoreUpdateFailed does not leak the path", async () => {
      const { WorkspaceInfrastructureError } = await import(
        "../../../../src/modules/workspace/infrastructure/errors/workspace-infrastructure-error.ts"
      );
      const out = mapErrorToJsonRpc(
        WorkspaceInfrastructureError.gitignoreUpdateFailed(SECRET_ROOT, new Error("u")),
      );
      expect(out.message).not.toContain(SECRET_ROOT);
    });

    it("WorkspaceInfrastructureError.unlockTargetMissing does not leak the path", async () => {
      const { WorkspaceInfrastructureError } = await import(
        "../../../../src/modules/workspace/infrastructure/errors/workspace-infrastructure-error.ts"
      );
      const out = mapErrorToJsonRpc(
        WorkspaceInfrastructureError.unlockTargetMissing(SECRET_ROOT),
      );
      expect(out.message).not.toContain(SECRET_ROOT);
    });

    it("NoWorkspaceAtPathError does not leak the path", async () => {
      const { NoWorkspaceAtPathError } = await import(
        "../../../../src/modules/workspace/application/errors/workspace-application-error.ts"
      );
      const out = mapErrorToJsonRpc(new NoWorkspaceAtPathError(SECRET_ROOT));
      expect(out.message).not.toContain(SECRET_ROOT);
    });

    it("ForeignHookExistsError does not leak the hook path", async () => {
      const { ForeignHookExistsError } = await import(
        "../../../../src/modules/secrets/infrastructure/errors/foreign-hook-exists-error.ts"
      );
      const out = mapErrorToJsonRpc(new ForeignHookExistsError(SECRET_HOOK));
      expect(out.message).not.toContain(SECRET_HOOK);
      expect(out.message).not.toContain("/Users/alice");
    });

    it("CuratorInfrastructureError.scanFailed does not leak the path", async () => {
      const { CuratorInfrastructureError } = await import(
        "../../../../src/modules/curator/infrastructure/errors/curator-infrastructure-error.ts"
      );
      const out = mapErrorToJsonRpc(
        CuratorInfrastructureError.scanFailed(SECRET_ROOT, new Error("u")),
      );
      expect(out.message).not.toContain(SECRET_ROOT);
    });
  });
});
