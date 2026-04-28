import { describe, it, expect } from "vitest";
import { KdfSpec } from "../../../../../src/modules/encryption/domain/value-objects/kdf-spec.ts";
import { KdfAlgorithm } from "../../../../../src/modules/encryption/domain/value-objects/kdf-algorithm.ts";
import { KdfParams } from "../../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { SaltBytes } from "../../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";

const salt = (): SaltBytes => SaltBytes.from(new Uint8Array(16).fill(7));

describe("KdfSpec", () => {
  it("create() builds when algorithm matches params.algorithm", () => {
    const params = KdfParams.defaults(salt());
    const spec = KdfSpec.create({
      algorithm: KdfAlgorithm.argon2id(),
      params,
    });
    expect(spec.algorithm.kind).toBe("argon2id");
    expect(spec.params).toBe(params);
  });

  it("argon2idDefaults builds the canonical spec", () => {
    const spec = KdfSpec.argon2idDefaults(salt());
    expect(spec.algorithm.kind).toBe("argon2id");
    expect(spec.params.memoryKib).toBe(65536);
  });

  it("equals() identity & content", () => {
    const a = KdfSpec.argon2idDefaults(salt());
    const b = KdfSpec.argon2idDefaults(salt());
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
  });

  it("equals() returns false for different params", () => {
    const a = KdfSpec.argon2idDefaults(salt());
    const otherSalt = SaltBytes.from(new Uint8Array(16).fill(0xaa));
    const b = KdfSpec.argon2idDefaults(otherSalt);
    expect(a.equals(b)).toBe(false);
  });
});
