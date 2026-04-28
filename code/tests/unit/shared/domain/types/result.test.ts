import { describe, it, expect } from "vitest";

import {
  ok,
  err,
  isOk,
  isErr,
  type Result,
} from "../../../../../src/shared/domain/types/result.ts";

describe("Result", () => {
  it("ok() builds a discriminated success", () => {
    const r = ok(42);
    expect(r.kind).toBe("ok");
    expect(r.value).toBe(42);
  });

  it("err() builds a discriminated failure", () => {
    const r = err("boom");
    expect(r.kind).toBe("err");
    expect(r.error).toBe("boom");
  });

  it("isOk narrows to Ok<T> on success", () => {
    const r: Result<number, string> = ok(1);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) {
      expect(r.value).toBe(1);
    }
  });

  it("isErr narrows to Err<E> on failure", () => {
    const r: Result<number, string> = err("nope");
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    if (isErr(r)) {
      expect(r.error).toBe("nope");
    }
  });

  it("preserves complex T and E payloads", () => {
    const okR = ok({ name: "x" } as const);
    const errR = err(new Error("e"));
    expect(isOk(okR) && okR.value.name).toBe("x");
    expect(isErr(errR) && errR.error.message).toBe("e");
  });
});
