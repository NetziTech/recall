/**
 * Tests for `CuratorApplicationError` factory branches.
 *
 * Existing tests exercise the error from happy-path use cases; this
 * file directly hits each static factory and the optional-cause
 * attachment path that the use case tests do not cover.
 */
import { describe, expect, it } from "vitest";

import { CuratorApplicationError } from "../../../../src/modules/curator/application/errors/curator-application-error.ts";

describe("CuratorApplicationError factories", () => {
  it("runAlreadyInflight carries the canonical code", () => {
    const e = CuratorApplicationError.runAlreadyInflight("ws-1", "run-1");
    expect(e.code).toBe("curator.run-already-inflight");
    expect(e.name).toBe("CuratorApplicationError");
    expect(e.message).toContain("ws-1");
    expect(e.message).toContain("run-1");
  });

  it("runNotFound carries the canonical code", () => {
    const e = CuratorApplicationError.runNotFound("run-x");
    expect(e.code).toBe("curator.run-not-found");
    expect(e.message).toContain("run-x");
  });

  it("does NOT define the cause property when not supplied", () => {
    const e = CuratorApplicationError.runNotFound("run-x");
    // `cause` not defined → property descriptor is undefined.
    expect(Object.getOwnPropertyDescriptor(e, "cause")).toBeUndefined();
  });

  it("instances are Error subclasses", () => {
    const e = CuratorApplicationError.runNotFound("run-x");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(CuratorApplicationError);
  });
});
