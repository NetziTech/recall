import { describe, it, expect } from "vitest";
import { RequestId } from "../../../../src/modules/mcp-server/domain/value-objects/request-id.ts";
import { ToolName } from "../../../../src/modules/mcp-server/domain/value-objects/tool-name.ts";
import { ToolDescription } from "../../../../src/modules/mcp-server/domain/value-objects/tool-description.ts";
import { ToolArgs } from "../../../../src/modules/mcp-server/domain/value-objects/tool-args.ts";
import { ToolResult } from "../../../../src/modules/mcp-server/domain/value-objects/tool-result.ts";
import { ToolCallId } from "../../../../src/modules/mcp-server/domain/value-objects/tool-call-id.ts";
import { InvocationCount } from "../../../../src/modules/mcp-server/domain/value-objects/invocation-count.ts";
import { LastInvokedAt } from "../../../../src/modules/mcp-server/domain/value-objects/last-invoked-at.ts";
import { ProtocolVersion } from "../../../../src/modules/mcp-server/domain/value-objects/protocol-version.ts";
import {
  ClientInfo,
  ClientName,
} from "../../../../src/modules/mcp-server/domain/value-objects/client-info.ts";
import { JsonRpcErrorCode } from "../../../../src/modules/mcp-server/domain/value-objects/error-code.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import { InvalidRequestIdError } from "../../../../src/modules/mcp-server/domain/errors/invalid-request-id-error.ts";
import { InvalidProtocolVersionError } from "../../../../src/modules/mcp-server/domain/errors/invalid-protocol-version-error.ts";

describe("RequestId", () => {
  it("from(string) accepts non-empty string", () => {
    const id = RequestId.from("abc-123");
    expect(id.kind).toBe("string");
    expect(id.toString()).toBe("abc-123");
  });

  it("from(string) trims and rejects whitespace-only / empty", () => {
    expect(() => RequestId.from("")).toThrow(InvalidRequestIdError);
    expect(() => RequestId.from("   ")).toThrow(InvalidRequestIdError);
    expect(RequestId.from("  ok  ").toString()).toBe("ok");
  });

  it("from(number) accepts integer", () => {
    const id = RequestId.from(42);
    expect(id.kind).toBe("number");
    expect(id.toString()).toBe("42");
  });

  it("from(number) rejects non-integer / non-finite", () => {
    expect(() => RequestId.from(1.5)).toThrow(InvalidRequestIdError);
    expect(() => RequestId.from(NaN)).toThrow(InvalidRequestIdError);
    expect(() => RequestId.from(Infinity)).toThrow(InvalidRequestIdError);
  });

  it("from(other) rejects boolean / null / object", () => {
    expect(() => RequestId.from(true)).toThrow(InvalidRequestIdError);
    expect(() => RequestId.from(null)).toThrow(InvalidRequestIdError);
    expect(() => RequestId.from({})).toThrow(InvalidRequestIdError);
  });

  it("ofString / ofNumber strict factories", () => {
    expect(RequestId.ofString("foo").kind).toBe("string");
    expect(RequestId.ofNumber(0).kind).toBe("number");
    expect(() =>
      RequestId.ofString(1 as unknown as string),
    ).toThrow(InvalidInputError);
    expect(() =>
      RequestId.ofNumber("x" as unknown as number),
    ).toThrow(InvalidInputError);
    expect(() => RequestId.ofString("")).toThrow(InvalidRequestIdError);
    expect(() => RequestId.ofNumber(NaN)).toThrow(InvalidRequestIdError);
    expect(() => RequestId.ofNumber(1.5)).toThrow(InvalidRequestIdError);
    expect(() => RequestId.ofNumber(Infinity)).toThrow(InvalidRequestIdError);
  });

  it("isString / isNumber discriminate", () => {
    expect(RequestId.from("a").isString()).toBe(true);
    expect(RequestId.from("a").isNumber()).toBe(false);
    expect(RequestId.from(1).isNumber()).toBe(true);
  });

  it("toValue exposes discriminated union", () => {
    const a = RequestId.from("foo");
    const va = a.toValue();
    expect(va.kind).toBe("string");
    if (va.kind === "string") expect(va.value).toBe("foo");
    const b = RequestId.from(42);
    const vb = b.toValue();
    expect(vb.kind).toBe("number");
    if (vb.kind === "number") expect(vb.value).toBe(42);
  });

  it("equals enforces kind + value match", () => {
    expect(RequestId.from("a").equals(RequestId.from("a"))).toBe(true);
    expect(RequestId.from("42").equals(RequestId.from(42))).toBe(false);
    expect(RequestId.from(1).equals(RequestId.from(2))).toBe(false);
  });
});

describe("ToolName", () => {
  it("create() accepts every MVP literal", () => {
    const expected = [
      "mem.init",
      "mem.context",
      "mem.recall",
      "mem.remember",
      "mem.task",
      "mem.health",
    ];
    for (const name of expected) {
      expect(ToolName.create(name).toString()).toBe(name);
    }
  });

  it("create() trims & rejects empty / unknown / non-string", () => {
    expect(ToolName.create("  mem.init  ").toString()).toBe("mem.init");
    expect(() => ToolName.create("")).toThrow(InvalidInputError);
    expect(() => ToolName.create("   ")).toThrow(InvalidInputError);
    expect(() => ToolName.create("mem.unknown")).toThrow(InvalidInputError);
    expect(() =>
      ToolName.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("convenience factories", () => {
    expect(ToolName.init().toString()).toBe("mem.init");
    expect(ToolName.context().toString()).toBe("mem.context");
    expect(ToolName.recall().toString()).toBe("mem.recall");
    expect(ToolName.remember().toString()).toBe("mem.remember");
    expect(ToolName.task().toString()).toBe("mem.task");
    expect(ToolName.health().toString()).toBe("mem.health");
  });

  it("isKind type guard", () => {
    expect(ToolName.isKind("mem.init")).toBe(true);
    expect(ToolName.isKind("mem.invalid")).toBe(false);
  });

  it("all() returns 6 tools, frozen", () => {
    const all = ToolName.all();
    expect(all.length).toBe(6);
    expect(Object.isFrozen(all)).toBe(true);
  });

  it("equals", () => {
    expect(ToolName.init().equals(ToolName.init())).toBe(true);
    expect(ToolName.init().equals(ToolName.recall())).toBe(false);
  });
});

describe("ToolDescription", () => {
  it("create() accepts non-empty bounded text", () => {
    const d = ToolDescription.create("does the thing");
    expect(d.toString()).toBe("does the thing");
  });

  it("rejects empty / oversized / non-string", () => {
    expect(() => ToolDescription.create("")).toThrow(InvalidInputError);
    expect(() => ToolDescription.create("x".repeat(2001))).toThrow(
      InvalidInputError,
    );
    expect(() =>
      ToolDescription.create(1 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("maxLength returns 2000", () => {
    expect(ToolDescription.maxLength()).toBe(2000);
  });
});

describe("ToolArgs", () => {
  it("from() wraps any unknown", () => {
    const a = ToolArgs.from({ foo: 1 });
    const v = a.raw() as { foo: number };
    expect(v.foo).toBe(1);
  });

  it("empty() returns {}", () => {
    const a = ToolArgs.empty();
    expect(a.raw()).toEqual({});
  });

  it("equals by reference", () => {
    const obj = { x: 1 };
    const a = ToolArgs.from(obj);
    const b = ToolArgs.from(obj);
    expect(a.equals(b)).toBe(true);
    const c = ToolArgs.from({ x: 1 });
    expect(a.equals(c)).toBe(false);
  });
});

describe("ToolResult", () => {
  it("success with payload", () => {
    const r = ToolResult.success({ ok: true });
    expect(r.kind).toBe("success");
    const v = r.toValue();
    expect(v.kind).toBe("success");
  });

  it("error with code, message, optional data", () => {
    const r = ToolResult.error({ code: -32602, message: "bad params" });
    expect(r.kind).toBe("error");
    const v = r.toValue();
    if (v.kind === "error") {
      expect(v.code).toBe(-32602);
      expect(v.message).toBe("bad params");
    }
  });

  it("error rejects invalid code / empty message", () => {
    expect(() => ToolResult.error({ code: 1.5, message: "x" })).toThrow(
      InvalidInputError,
    );
    expect(() => ToolResult.error({ code: NaN, message: "x" })).toThrow(
      InvalidInputError,
    );
    expect(() => ToolResult.error({ code: -32602, message: "" })).toThrow(
      InvalidInputError,
    );
  });

  it("error with data", () => {
    const r = ToolResult.error({
      code: -32602,
      message: "bad",
      data: { field: "x" },
    });
    const v = r.toValue();
    if (v.kind === "error") {
      expect(v.data).toEqual({ field: "x" });
    }
  });

  it("equals", () => {
    const a = ToolResult.success(1);
    const b = ToolResult.success(1);
    expect(a.equals(b)).toBe(true);
    const c = ToolResult.success(2);
    expect(a.equals(c)).toBe(false);
    const e1 = ToolResult.error({ code: -32602, message: "x" });
    const e2 = ToolResult.error({ code: -32602, message: "x" });
    expect(e1.equals(e2)).toBe(true);
  });
});

describe("ToolCallId", () => {
  const VALID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
  it("from valid uuid v7", () => {
    expect(ToolCallId.from(VALID).toString()).toBe(VALID);
  });
  it("rejects invalid", () => {
    expect(() => ToolCallId.from("invalid")).toThrow(InvalidInputError);
  });
});

describe("InvocationCount", () => {
  it("zero", () => {
    expect(InvocationCount.zero().value).toBe(0);
  });

  it("of() validates", () => {
    expect(InvocationCount.of(5).value).toBe(5);
    expect(() => InvocationCount.of(-1)).toThrow(InvalidInputError);
    expect(() => InvocationCount.of(1.5)).toThrow(InvalidInputError);
    expect(() => InvocationCount.of(NaN)).toThrow(InvalidInputError);
  });

  it("increment monotonic", () => {
    expect(InvocationCount.zero().increment().value).toBe(1);
    expect(InvocationCount.of(5).increment().value).toBe(6);
  });

  it("equals", () => {
    expect(InvocationCount.of(3).equals(InvocationCount.of(3))).toBe(true);
    expect(InvocationCount.of(3).equals(InvocationCount.of(4))).toBe(false);
  });
});

describe("LastInvokedAt", () => {
  it("never has null at", () => {
    const l = LastInvokedAt.never();
    expect(l.kind).toBe("never");
    expect(l.at).toBeNull();
  });

  it("at() pins moment", () => {
    const ts = Timestamp.fromEpochMs(123);
    const l = LastInvokedAt.at(ts);
    expect(l.kind).toBe("at");
    expect(l.at?.epochMs).toBe(123);
  });

  it("touch() returns at-form", () => {
    const ts = Timestamp.fromEpochMs(456);
    const l = LastInvokedAt.never().touch(ts);
    expect(l.kind).toBe("at");
    expect(l.at?.epochMs).toBe(456);
  });
});

describe("ProtocolVersion", () => {
  it("accepts valid semver", () => {
    expect(ProtocolVersion.create("1.2.3").toString()).toBe("1.2.3");
  });

  it("rejects malformed", () => {
    expect(() => ProtocolVersion.create("1.2")).toThrow(
      InvalidProtocolVersionError,
    );
    expect(() => ProtocolVersion.create("")).toThrow(
      InvalidProtocolVersionError,
    );
    expect(() => ProtocolVersion.create("a.b.c")).toThrow(
      InvalidProtocolVersionError,
    );
    expect(() =>
      ProtocolVersion.create(1 as unknown as string),
    ).toThrow(InvalidProtocolVersionError);
  });

  it("equals", () => {
    expect(
      ProtocolVersion.create("1.2.3").equals(ProtocolVersion.create("1.2.3")),
    ).toBe(true);
    expect(
      ProtocolVersion.create("1.2.3").equals(ProtocolVersion.create("1.2.4")),
    ).toBe(false);
  });
});

describe("JsonRpcErrorCode", () => {
  it("of accepts standard protocol codes", () => {
    expect(JsonRpcErrorCode.of(-32700).value).toBe(-32700);
    expect(JsonRpcErrorCode.of(-32600).value).toBe(-32600);
    expect(JsonRpcErrorCode.of(-32601).value).toBe(-32601);
    expect(JsonRpcErrorCode.of(-32602).value).toBe(-32602);
    expect(JsonRpcErrorCode.of(-32603).value).toBe(-32603);
  });

  it("of accepts server error block", () => {
    expect(JsonRpcErrorCode.of(-32000).value).toBe(-32000);
    expect(JsonRpcErrorCode.of(-32099).value).toBe(-32099);
  });

  it("of accepts custom MCP codes", () => {
    expect(JsonRpcErrorCode.of(-32108).value).toBe(-32108);
  });

  it("rejects out-of-range / non-integer", () => {
    expect(() => JsonRpcErrorCode.of(0)).toThrow(InvalidInputError);
    expect(() => JsonRpcErrorCode.of(-99999)).toThrow(InvalidInputError);
    expect(() => JsonRpcErrorCode.of(1.5)).toThrow(InvalidInputError);
    expect(() => JsonRpcErrorCode.of(NaN)).toThrow(InvalidInputError);
    expect(() => JsonRpcErrorCode.of(Infinity)).toThrow(InvalidInputError);
  });

  it("isAllowed type guard", () => {
    expect(JsonRpcErrorCode.isAllowed(-32700)).toBe(true);
    expect(JsonRpcErrorCode.isAllowed(0)).toBe(false);
    expect(JsonRpcErrorCode.isAllowed(1.5)).toBe(false);
  });

  it("isCustom / isStandardProtocol / isStandardServerError", () => {
    expect(JsonRpcErrorCode.of(-32108).isCustom()).toBe(true);
    expect(JsonRpcErrorCode.of(-32700).isStandardProtocol()).toBe(true);
    expect(JsonRpcErrorCode.of(-32050).isStandardServerError()).toBe(true);
  });

  it("equals", () => {
    expect(
      JsonRpcErrorCode.of(-32602).equals(JsonRpcErrorCode.of(-32602)),
    ).toBe(true);
    expect(
      JsonRpcErrorCode.of(-32602).equals(JsonRpcErrorCode.of(-32603)),
    ).toBe(false);
  });
});

describe("ClientInfo", () => {
  it("create() builds with valid inputs", () => {
    const info = ClientInfo.create({
      name: ClientName.create("claude-code"),
      protocolVersion: ProtocolVersion.create("1.0.0"),
      capabilities: ["sampling", "prompts"],
    });
    expect(info.name.toString()).toBe("claude-code");
    expect(info.capabilities.length).toBe(2);
  });

  it("deduplicates capabilities", () => {
    const info = ClientInfo.create({
      name: ClientName.create("x"),
      protocolVersion: ProtocolVersion.create("1.0.0"),
      capabilities: ["a", "a", "b"],
    });
    expect(info.capabilities.length).toBe(2);
  });

  it("hasCapability checks membership", () => {
    const info = ClientInfo.create({
      name: ClientName.create("x"),
      protocolVersion: ProtocolVersion.create("1.0.0"),
      capabilities: ["sampling"],
    });
    expect(info.hasCapability("sampling")).toBe(true);
    expect(info.hasCapability("missing")).toBe(false);
    expect(info.hasCapability("")).toBe(false);
    expect(info.hasCapability(1 as unknown as string)).toBe(false);
  });

  it("rejects oversized capabilities count", () => {
    expect(() =>
      ClientInfo.create({
        name: ClientName.create("x"),
        protocolVersion: ProtocolVersion.create("1.0.0"),
        capabilities: Array.from({ length: 65 }, (_, i) => `cap${String(i)}`),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects empty / oversized capability strings", () => {
    expect(() =>
      ClientInfo.create({
        name: ClientName.create("x"),
        protocolVersion: ProtocolVersion.create("1.0.0"),
        capabilities: [""],
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      ClientInfo.create({
        name: ClientName.create("x"),
        protocolVersion: ProtocolVersion.create("1.0.0"),
        capabilities: ["a".repeat(129)],
      }),
    ).toThrow(InvalidInputError);
  });

  it("ClientName rejects empty / overlong / non-string", () => {
    expect(() => ClientName.create("")).toThrow(InvalidInputError);
    expect(() => ClientName.create("a".repeat(201))).toThrow(
      InvalidInputError,
    );
    expect(() =>
      ClientName.create(1 as unknown as string),
    ).toThrow(InvalidInputError);
  });
});
