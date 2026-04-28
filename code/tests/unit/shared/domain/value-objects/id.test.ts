import { describe, it, expect } from "vitest";

import { Id } from "../../../../../src/shared/domain/value-objects/id.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

const VALID_LOWER = "01952f3b-7d8c-7b4a-94f1-a3f8d12e5c89";
const VALID_UPPER = "01952F3B-7D8C-7B4A-94F1-A3F8D12E5C89";
const VALID_VARIANT_8 = "01952f3b-7d8c-7000-8000-aaaaaaaaaaaa";
const VALID_VARIANT_9 = "01952f3b-7d8c-7000-9000-aaaaaaaaaaaa";
const VALID_VARIANT_A = "01952f3b-7d8c-7000-a000-aaaaaaaaaaaa";
const VALID_VARIANT_B = "01952f3b-7d8c-7000-b000-aaaaaaaaaaaa";

describe("Id", () => {
  it("creates from a canonical lowercase UUID v7", () => {
    const id = Id.create(VALID_LOWER);
    expect(id.toString()).toBe(VALID_LOWER);
  });

  it("normalizes uppercase to lowercase", () => {
    const id = Id.create(VALID_UPPER);
    expect(id.toString()).toBe(VALID_LOWER);
  });

  it("accepts every legal variant nibble (8/9/a/b)", () => {
    expect(Id.create(VALID_VARIANT_8).toString()).toBe(VALID_VARIANT_8);
    expect(Id.create(VALID_VARIANT_9).toString()).toBe(VALID_VARIANT_9);
    expect(Id.create(VALID_VARIANT_A).toString()).toBe(VALID_VARIANT_A);
    expect(Id.create(VALID_VARIANT_B).toString()).toBe(VALID_VARIANT_B);
  });

  it("rejects empty input", () => {
    expect(() => Id.create("")).toThrow(InvalidInputError);
  });

  it("rejects non-string input", () => {
    expect(() => Id.create(undefined as unknown as string)).toThrow(
      InvalidInputError,
    );
  });

  it("rejects malformed UUIDs", () => {
    expect(() => Id.create("not-a-uuid")).toThrow(InvalidInputError);
    expect(() =>
      Id.create("01952f3b-7d8c-1234-94f1-a3f8d12e5c89"),
    ).toThrow(InvalidInputError); // version != 7
    expect(() =>
      Id.create("01952f3b-7d8c-7b4a-c4f1-a3f8d12e5c89"),
    ).toThrow(InvalidInputError); // variant=c invalid
  });

  it("uses the provided fieldName in the error message", () => {
    try {
      Id.create("nope", "decision_id");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidInputError);
      expect((err as InvalidInputError).field).toBe("decision_id");
    }
  });

  it("toPrimitive returns the branded value", () => {
    const id = Id.create<"workspace">(VALID_LOWER);
    expect(id.toPrimitive()).toBe(VALID_LOWER);
  });

  it("equals: identity short-circuit", () => {
    const id = Id.create(VALID_LOWER);
    expect(id.equals(id)).toBe(true);
  });

  it("equals: same value, distinct instances", () => {
    const a = Id.create(VALID_LOWER);
    const b = Id.create(VALID_LOWER);
    expect(a.equals(b)).toBe(true);
  });

  it("equals: different value", () => {
    const a = Id.create(VALID_LOWER);
    const b = Id.create(VALID_VARIANT_8);
    expect(a.equals(b)).toBe(false);
  });
});
