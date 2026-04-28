/**
 * Coverage-targeted tests for mcp-server domain VOs.
 *
 * Adds tests for ProtocolVersion, ClientInfo / ClientName,
 * LastInvokedAt, and ToolResult edges not covered by the existing
 * `value-objects.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { ClientInfo, ClientName } from "../../../../src/modules/mcp-server/domain/value-objects/client-info.ts";
import { LastInvokedAt } from "../../../../src/modules/mcp-server/domain/value-objects/last-invoked-at.ts";
import { ProtocolVersion } from "../../../../src/modules/mcp-server/domain/value-objects/protocol-version.ts";
import { ToolResult } from "../../../../src/modules/mcp-server/domain/value-objects/tool-result.ts";
import { InvalidProtocolVersionError } from "../../../../src/modules/mcp-server/domain/errors/invalid-protocol-version-error.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";

import { ANCHOR_TIME_MS } from "../../../helpers/factories.ts";

const ts = (ms: number = ANCHOR_TIME_MS): Timestamp => Timestamp.fromEpochMs(ms);

describe("ProtocolVersion.create branches", () => {
  it("accepts canonical semver and round-trips toString()", () => {
    const v = ProtocolVersion.create("1.2.3");
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
    expect(v.toString()).toBe("1.2.3");
  });

  it("trims leading/trailing whitespace", () => {
    expect(ProtocolVersion.create("  1.2.3  ").toString()).toBe("1.2.3");
  });

  it("rejects non-string input", () => {
    expect(() =>
      ProtocolVersion.create(42 as unknown as string),
    ).toThrow(InvalidProtocolVersionError);
  });

  it("rejects empty / whitespace-only", () => {
    expect(() => ProtocolVersion.create("")).toThrow(InvalidProtocolVersionError);
    expect(() => ProtocolVersion.create("   ")).toThrow(InvalidProtocolVersionError);
  });

  it("rejects malformed shapes", () => {
    expect(() => ProtocolVersion.create("1.2")).toThrow(
      InvalidProtocolVersionError,
    );
    expect(() => ProtocolVersion.create("a.b.c")).toThrow(
      InvalidProtocolVersionError,
    );
  });

  it("of() builds from numeric components", () => {
    expect(ProtocolVersion.of(0, 1, 0).toString()).toBe("0.1.0");
  });

  it("of() rejects non-finite", () => {
    expect(() => ProtocolVersion.of(Number.POSITIVE_INFINITY, 0, 0)).toThrow(
      InvalidProtocolVersionError,
    );
    expect(() => ProtocolVersion.of(Number.NaN, 0, 0)).toThrow(
      InvalidProtocolVersionError,
    );
  });

  it("of() rejects non-integer", () => {
    expect(() => ProtocolVersion.of(1.5, 0, 0)).toThrow(
      InvalidProtocolVersionError,
    );
  });

  it("of() rejects negative components", () => {
    expect(() => ProtocolVersion.of(-1, 0, 0)).toThrow(
      InvalidProtocolVersionError,
    );
  });

  it("equals() returns true for matching components", () => {
    expect(
      ProtocolVersion.of(1, 0, 0).equals(ProtocolVersion.of(1, 0, 0)),
    ).toBe(true);
  });

  it("equals() returns false on mismatch", () => {
    expect(
      ProtocolVersion.of(1, 0, 0).equals(ProtocolVersion.of(1, 0, 1)),
    ).toBe(false);
  });
});

describe("ClientName branches", () => {
  it("create() accepts a normal name", () => {
    expect(ClientName.create("Claude Desktop").toString()).toBe(
      "Claude Desktop",
    );
  });

  it("rejects non-string input", () => {
    expect(() =>
      ClientName.create(42 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("rejects names containing newlines", () => {
    expect(() => ClientName.create("ab\ncd")).toThrow(InvalidInputError);
    expect(() => ClientName.create("ab\rcd")).toThrow(InvalidInputError);
  });

  it("rejects empty / whitespace-only", () => {
    expect(() => ClientName.create("")).toThrow(InvalidInputError);
    expect(() => ClientName.create("   ")).toThrow(InvalidInputError);
  });

  it("rejects names above the cap (200 chars)", () => {
    expect(() => ClientName.create("a".repeat(201))).toThrow(InvalidInputError);
  });

  it("maxLength() exposes the constant", () => {
    expect(ClientName.maxLength()).toBe(200);
  });
});

describe("ClientInfo.create branches", () => {
  const protocolVersion = ProtocolVersion.create("1.0.0");
  const name = ClientName.create("Claude Desktop");

  it("accepts an empty capability list", () => {
    const ci = ClientInfo.create({ name, protocolVersion });
    expect(ci.capabilities.length).toBe(0);
  });

  it("normalises and dedupes capabilities, preserving order", () => {
    const ci = ClientInfo.create({
      name,
      protocolVersion,
      capabilities: ["sampling", " sampling ", "prompts"],
    });
    expect(ci.capabilities).toEqual(["sampling", "prompts"]);
  });

  it("hasCapability() trims and returns true / false", () => {
    const ci = ClientInfo.create({
      name,
      protocolVersion,
      capabilities: ["sampling"],
    });
    expect(ci.hasCapability("sampling")).toBe(true);
    expect(ci.hasCapability("  sampling  ")).toBe(true);
    expect(ci.hasCapability("missing")).toBe(false);
    expect(ci.hasCapability("")).toBe(false);
    expect(ci.hasCapability("   ")).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(ci.hasCapability(42 as any)).toBe(false);
  });

  it("rejects above the capabilities cap (64 entries)", () => {
    const tooMany = Array.from({ length: 65 }, (_, i) => `cap-${String(i)}`);
    expect(() =>
      ClientInfo.create({ name, protocolVersion, capabilities: tooMany }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-string capability entry", () => {
    expect(() =>
      ClientInfo.create({
        name,
        protocolVersion,
        capabilities: [42 as unknown as string],
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects empty / whitespace-only capability", () => {
    expect(() =>
      ClientInfo.create({ name, protocolVersion, capabilities: [""] }),
    ).toThrow(InvalidInputError);
    expect(() =>
      ClientInfo.create({ name, protocolVersion, capabilities: ["   "] }),
    ).toThrow(InvalidInputError);
  });

  it("rejects capability above 128 chars", () => {
    expect(() =>
      ClientInfo.create({
        name,
        protocolVersion,
        capabilities: ["a".repeat(129)],
      }),
    ).toThrow(InvalidInputError);
  });

  it("equals() returns true for identical content", () => {
    const a = ClientInfo.create({
      name,
      protocolVersion,
      capabilities: ["sampling"],
    });
    const b = ClientInfo.create({
      name,
      protocolVersion,
      capabilities: ["sampling"],
    });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });

  it("equals() distinguishes name, version, capability list", () => {
    const base = ClientInfo.create({
      name,
      protocolVersion,
      capabilities: ["sampling"],
    });
    const otherName = ClientInfo.create({
      name: ClientName.create("Other"),
      protocolVersion,
      capabilities: ["sampling"],
    });
    expect(base.equals(otherName)).toBe(false);
    const otherVersion = ClientInfo.create({
      name,
      protocolVersion: ProtocolVersion.of(2, 0, 0),
      capabilities: ["sampling"],
    });
    expect(base.equals(otherVersion)).toBe(false);
    const noCap = ClientInfo.create({ name, protocolVersion });
    expect(base.equals(noCap)).toBe(false);
    const diffCapValue = ClientInfo.create({
      name,
      protocolVersion,
      capabilities: ["prompts"],
    });
    expect(base.equals(diffCapValue)).toBe(false);
  });
});

describe("LastInvokedAt branches", () => {
  it("never() carries kind=never with at=null", () => {
    const a = LastInvokedAt.never();
    expect(a.hasBeenInvoked()).toBe(false);
    expect(a.toValue().kind).toBe("never");
    expect(a.toValue().at).toBeNull();
  });

  it("at() carries kind=at and the timestamp", () => {
    const a = LastInvokedAt.at(ts());
    expect(a.hasBeenInvoked()).toBe(true);
    expect(a.toValue().kind).toBe("at");
  });

  it("touch() always produces a kind=at instance", () => {
    const t1 = LastInvokedAt.never().touch(ts(ANCHOR_TIME_MS + 1));
    expect(t1.hasBeenInvoked()).toBe(true);
    const t2 = LastInvokedAt.at(ts()).touch(ts(ANCHOR_TIME_MS + 100));
    expect(t2.hasBeenInvoked()).toBe(true);
  });

  it("millisecondsSince returns null when never invoked", () => {
    expect(LastInvokedAt.never().millisecondsSince(ts())).toBeNull();
  });

  it("millisecondsSince returns the elapsed delta", () => {
    const last = LastInvokedAt.at(ts(ANCHOR_TIME_MS));
    expect(last.millisecondsSince(ts(ANCHOR_TIME_MS + 100))).toBe(100);
  });

  it("millisecondsSince clamps negative deltas to 0", () => {
    const last = LastInvokedAt.at(ts(ANCHOR_TIME_MS + 100));
    expect(last.millisecondsSince(ts(ANCHOR_TIME_MS))).toBe(0);
  });

  it("equals() compares kind + timestamp", () => {
    expect(LastInvokedAt.never().equals(LastInvokedAt.never())).toBe(true);
    expect(LastInvokedAt.at(ts()).equals(LastInvokedAt.at(ts()))).toBe(true);
    expect(LastInvokedAt.never().equals(LastInvokedAt.at(ts()))).toBe(false);
    expect(LastInvokedAt.at(ts()).equals(LastInvokedAt.never())).toBe(false);
    expect(
      LastInvokedAt.at(ts()).equals(LastInvokedAt.at(ts(ANCHOR_TIME_MS + 1))),
    ).toBe(false);
    const sample = LastInvokedAt.at(ts());
    expect(sample.equals(sample)).toBe(true);
  });
});

describe("ToolResult success/error variants", () => {
  it("success() carries payload", () => {
    const payload = { ok: true };
    const r = ToolResult.success(payload);
    expect(r.kind).toBe("success");
    expect(r.isSuccess()).toBe(true);
    expect(r.isError()).toBe(false);
    const view = r.toValue();
    if (view.kind !== "success") throw new Error("kind drift");
    expect(view.payload).toBe(payload);
  });

  it("error() carries code + message + data", () => {
    const r = ToolResult.error({ code: -32000, message: "boom", data: { k: 1 } });
    expect(r.kind).toBe("error");
    expect(r.isError()).toBe(true);
    expect(r.isSuccess()).toBe(false);
    const view = r.toValue();
    if (view.kind !== "error") throw new Error("kind drift");
    expect(view.code).toBe(-32000);
    expect(view.message).toBe("boom");
    expect(view.data).toEqual({ k: 1 });
  });

  it("error() omits the data field when not supplied", () => {
    const r = ToolResult.error({ code: 1, message: "x" });
    const view = r.toValue();
    if (view.kind !== "error") throw new Error("kind drift");
    expect(view.data).toBeUndefined();
  });

  it("error() rejects non-finite / non-integer code", () => {
    expect(() => ToolResult.error({ code: 1.5, message: "x" })).toThrow(
      InvalidInputError,
    );
    expect(() =>
      ToolResult.error({ code: Number.POSITIVE_INFINITY, message: "x" }),
    ).toThrow(InvalidInputError);
  });

  it("error() rejects non-string / empty message", () => {
    expect(() =>
      ToolResult.error({
        code: 1,
        message: 42 as unknown as string,
      }),
    ).toThrow(InvalidInputError);
    expect(() => ToolResult.error({ code: 1, message: "" })).toThrow(
      InvalidInputError,
    );
    expect(() => ToolResult.error({ code: 1, message: "    " })).toThrow(
      InvalidInputError,
    );
  });

  it("equals on success compares payload by reference", () => {
    const payload = { x: 1 };
    const a = ToolResult.success(payload);
    const b = ToolResult.success(payload);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
    const c = ToolResult.success({ x: 1 });
    expect(a.equals(c)).toBe(false);
  });

  it("equals on error compares code, message, hasData, data ref", () => {
    const a = ToolResult.error({ code: 1, message: "m" });
    const b = ToolResult.error({ code: 1, message: "m" });
    expect(a.equals(b)).toBe(true);
    const c = ToolResult.error({ code: 2, message: "m" });
    expect(a.equals(c)).toBe(false);
    const d = ToolResult.error({ code: 1, message: "other" });
    expect(a.equals(d)).toBe(false);
    const data = { k: 1 };
    const withData = ToolResult.error({ code: 1, message: "m", data });
    const withDataB = ToolResult.error({ code: 1, message: "m", data });
    expect(withData.equals(withDataB)).toBe(true);
    expect(a.equals(withData)).toBe(false); // hasData differs
    const otherData = { k: 1 };
    const withOtherData = ToolResult.error({ code: 1, message: "m", data: otherData });
    expect(withData.equals(withOtherData)).toBe(false);
  });

  it("success vs error are never equal", () => {
    expect(
      ToolResult.success({}).equals(ToolResult.error({ code: 1, message: "x" })),
    ).toBe(false);
  });
});
