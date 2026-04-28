import { describe, it, expect } from "vitest";
import { KdfParams } from "../../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { KdfAlgorithm } from "../../../../../src/modules/encryption/domain/value-objects/kdf-algorithm.ts";
import { SaltBytes } from "../../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { WeakKdfParamsError } from "../../../../../src/modules/encryption/domain/errors/weak-kdf-params-error.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

const validSalt = (): SaltBytes => SaltBytes.from(new Uint8Array(16).fill(7));

describe("KdfParams", () => {
  it("create() builds with valid params", () => {
    const params = KdfParams.create({
      algorithm: KdfAlgorithm.argon2id(),
      memoryKib: 65536,
      iterations: 3,
      parallelism: 4,
      salt: validSalt(),
    });
    expect(params.memoryKib).toBe(65536);
    expect(params.iterations).toBe(3);
    expect(params.parallelism).toBe(4);
  });

  it("rejects memoryKib below 65536 with WeakKdfParamsError", () => {
    expect(() =>
      KdfParams.create({
        algorithm: KdfAlgorithm.argon2id(),
        memoryKib: 32768,
        iterations: 3,
        parallelism: 4,
        salt: validSalt(),
      }),
    ).toThrow(WeakKdfParamsError);
  });

  it("rejects iterations below 3", () => {
    expect(() =>
      KdfParams.create({
        algorithm: KdfAlgorithm.argon2id(),
        memoryKib: 65536,
        iterations: 2,
        parallelism: 4,
        salt: validSalt(),
      }),
    ).toThrow(WeakKdfParamsError);
  });

  it("rejects parallelism below 4", () => {
    expect(() =>
      KdfParams.create({
        algorithm: KdfAlgorithm.argon2id(),
        memoryKib: 65536,
        iterations: 3,
        parallelism: 1,
        salt: validSalt(),
      }),
    ).toThrow(WeakKdfParamsError);
  });

  it("rejects negative numbers as InvalidInput before weak check", () => {
    expect(() =>
      KdfParams.create({
        algorithm: KdfAlgorithm.argon2id(),
        memoryKib: -1,
        iterations: 3,
        parallelism: 4,
        salt: validSalt(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-integer numbers", () => {
    expect(() =>
      KdfParams.create({
        algorithm: KdfAlgorithm.argon2id(),
        memoryKib: 65536.5,
        iterations: 3,
        parallelism: 4,
        salt: validSalt(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-finite numbers", () => {
    expect(() =>
      KdfParams.create({
        algorithm: KdfAlgorithm.argon2id(),
        memoryKib: Infinity,
        iterations: 3,
        parallelism: 4,
        salt: validSalt(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects zero iterations", () => {
    expect(() =>
      KdfParams.create({
        algorithm: KdfAlgorithm.argon2id(),
        memoryKib: 65536,
        iterations: 0,
        parallelism: 4,
        salt: validSalt(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects zero parallelism", () => {
    expect(() =>
      KdfParams.create({
        algorithm: KdfAlgorithm.argon2id(),
        memoryKib: 65536,
        iterations: 3,
        parallelism: 0,
        salt: validSalt(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-number for any field", () => {
    expect(() =>
      KdfParams.create({
        algorithm: KdfAlgorithm.argon2id(),
        memoryKib: "65536" as unknown as number,
        iterations: 3,
        parallelism: 4,
        salt: validSalt(),
      }),
    ).toThrow(InvalidInputError);
  });

  it("defaults() returns exactly the documented values", () => {
    const params = KdfParams.defaults(validSalt());
    expect(params.memoryKib).toBe(65536);
    expect(params.iterations).toBe(3);
    expect(params.parallelism).toBe(4);
    expect(params.algorithm.kind).toBe("argon2id");
  });

  it("equals() compares all fields", () => {
    const p1 = KdfParams.defaults(validSalt());
    const p2 = KdfParams.defaults(validSalt());
    expect(p1.equals(p1)).toBe(true);
    expect(p1.equals(p2)).toBe(true);
  });

  it("equals() returns false on different salt", () => {
    const p1 = KdfParams.defaults(validSalt());
    const p2 = KdfParams.defaults(SaltBytes.from(new Uint8Array(16).fill(8)));
    expect(p1.equals(p2)).toBe(false);
  });

  it("equals() returns false on different memory", () => {
    const p1 = KdfParams.defaults(validSalt());
    const p2 = KdfParams.create({
      algorithm: KdfAlgorithm.argon2id(),
      memoryKib: 131072,
      iterations: 3,
      parallelism: 4,
      salt: validSalt(),
    });
    expect(p1.equals(p2)).toBe(false);
  });

  it("equals() returns false on different iterations", () => {
    const p1 = KdfParams.defaults(validSalt());
    const p2 = KdfParams.create({
      algorithm: KdfAlgorithm.argon2id(),
      memoryKib: 65536,
      iterations: 4,
      parallelism: 4,
      salt: validSalt(),
    });
    expect(p1.equals(p2)).toBe(false);
  });

  it("equals() returns false on different parallelism", () => {
    const p1 = KdfParams.defaults(validSalt());
    const p2 = KdfParams.create({
      algorithm: KdfAlgorithm.argon2id(),
      memoryKib: 65536,
      iterations: 3,
      parallelism: 8,
      salt: validSalt(),
    });
    expect(p1.equals(p2)).toBe(false);
  });

  it("minimums() exposes the floors", () => {
    const m = KdfParams.minimums();
    expect(m.memoryKib).toBe(65536);
    expect(m.iterations).toBe(3);
    expect(m.parallelism).toBe(4);
  });
});
