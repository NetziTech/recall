import { describe, it, expect } from "vitest";
import { KeyId } from "../../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

const VALID_UUID_V7 = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";

describe("KeyId", () => {
  it("from() accepts a valid UUID v7", () => {
    const id = KeyId.from(VALID_UUID_V7);
    expect(id.toString()).toBe(VALID_UUID_V7);
  });

  it("from() normalises to lowercase", () => {
    const id = KeyId.from(VALID_UUID_V7.toUpperCase());
    expect(id.toString()).toBe(VALID_UUID_V7);
  });

  it("from() rejects non-UUID-v7", () => {
    expect(() => KeyId.from("not-a-uuid")).toThrow(InvalidInputError);
  });

  it("from() rejects empty string", () => {
    expect(() => KeyId.from("")).toThrow(InvalidInputError);
  });

  it("equals() compares value", () => {
    const a = KeyId.from(VALID_UUID_V7);
    const b = KeyId.from(VALID_UUID_V7);
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);

    const c = KeyId.from("01952f3c-2222-7000-8000-aaaaaaaaaaaa");
    expect(a.equals(c)).toBe(false);
  });
});
