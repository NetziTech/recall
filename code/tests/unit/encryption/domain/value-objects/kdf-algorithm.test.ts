import { describe, it, expect } from "vitest";
import { KdfAlgorithm } from "../../../../../src/modules/encryption/domain/value-objects/kdf-algorithm.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("KdfAlgorithm", () => {
  it("create('argon2id') succeeds", () => {
    const a = KdfAlgorithm.create("argon2id");
    expect(a.kind).toBe("argon2id");
  });

  it("create() trims whitespace", () => {
    const a = KdfAlgorithm.create("  argon2id  ");
    expect(a.kind).toBe("argon2id");
  });

  it("create() rejects unknown algorithm", () => {
    expect(() => KdfAlgorithm.create("scrypt")).toThrow(InvalidInputError);
  });

  it("create() rejects empty string", () => {
    expect(() => KdfAlgorithm.create("")).toThrow(InvalidInputError);
  });

  it("create() rejects whitespace-only", () => {
    expect(() => KdfAlgorithm.create("   ")).toThrow(InvalidInputError);
  });

  it("create() rejects non-string", () => {
    expect(() =>
      KdfAlgorithm.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("argon2id() factory builds canonical instance", () => {
    const a = KdfAlgorithm.argon2id();
    expect(a.isArgon2id()).toBe(true);
    expect(a.kind).toBe("argon2id");
  });

  it("isKind() validates inputs", () => {
    expect(KdfAlgorithm.isKind("argon2id")).toBe(true);
    expect(KdfAlgorithm.isKind("bcrypt")).toBe(false);
  });

  it("toString() returns kind", () => {
    expect(KdfAlgorithm.argon2id().toString()).toBe("argon2id");
  });

  it("equals() compares kind", () => {
    const a = KdfAlgorithm.argon2id();
    const b = KdfAlgorithm.argon2id();
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
  });
});
