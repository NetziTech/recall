import { describe, it, expect, vi, beforeEach } from "vitest";

import { isErr, isOk } from "../../../../src/shared/domain/types/result.ts";
import { KdfParams } from "../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { Passphrase } from "../../../../src/modules/encryption/domain/value-objects/passphrase.ts";
import { SaltBytes } from "../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { KdfDerivationFailedError } from "../../../../src/modules/encryption/infrastructure/errors/kdf-derivation-failed-error.ts";

/**
 * `@noble/hashes/argon2.js` is mocked so we can drive the
 * `classifyKdfError` branch points without paying argon2's wall-clock
 * cost. Each test re-stubs the implementation via `mockImplementationOnce`.
 */
vi.mock("@noble/hashes/argon2.js", () => ({
  argon2idAsync: vi.fn(),
}));

const noble = await import("@noble/hashes/argon2.js");
const { Argon2idKdf } = await import(
  "../../../../src/modules/encryption/infrastructure/kdf/argon2id-kdf.ts"
);

const params = (): KdfParams =>
  KdfParams.defaults(SaltBytes.from(new Uint8Array(16).fill(7)));

const argon2idAsync = noble.argon2idAsync as unknown as ReturnType<typeof vi.fn>;

describe("Argon2idKdf — error classification (with mocked noble-hashes)", () => {
  beforeEach(() => {
    argon2idAsync.mockReset();
  });

  it("throws KdfDerivationFailedError when noble throws an OOM-like Error (message contains 'memory')", async () => {
    argon2idAsync.mockImplementationOnce(() => {
      throw new Error("out of memory: 65536 KiB requested");
    });
    const kdf = new Argon2idKdf();
    await expect(
      kdf.derive(Passphrase.from("a-strong-passphrase"), params()),
    ).rejects.toBeInstanceOf(KdfDerivationFailedError);
  });

  it("throws KdfDerivationFailedError when noble throws message containing 'alloc'", async () => {
    argon2idAsync.mockImplementationOnce(() => {
      throw new Error("alloc failed");
    });
    const kdf = new Argon2idKdf();
    await expect(
      kdf.derive(Passphrase.from("a-strong-passphrase"), params()),
    ).rejects.toBeInstanceOf(KdfDerivationFailedError);
  });

  it("throws KdfDerivationFailedError when noble throws message containing 'range'", async () => {
    argon2idAsync.mockImplementationOnce(() => {
      throw new Error("out of range");
    });
    const kdf = new Argon2idKdf();
    await expect(
      kdf.derive(Passphrase.from("a-strong-passphrase"), params()),
    ).rejects.toBeInstanceOf(KdfDerivationFailedError);
  });

  it("throws KdfDerivationFailedError (library-failure) when noble throws a generic Error", async () => {
    argon2idAsync.mockImplementationOnce(() => {
      throw new Error("unknown library bug");
    });
    const kdf = new Argon2idKdf();
    await expect(
      kdf.derive(Passphrase.from("a-strong-passphrase"), params()),
    ).rejects.toBeInstanceOf(KdfDerivationFailedError);
  });

  it("throws KdfDerivationFailedError (library-failure) when noble throws a non-Error value", async () => {
    argon2idAsync.mockImplementationOnce(() => {
      throw "not an Error instance";
    });
    const kdf = new Argon2idKdf();
    await expect(
      kdf.derive(Passphrase.from("a-strong-passphrase"), params()),
    ).rejects.toBeInstanceOf(KdfDerivationFailedError);
  });

  it("re-throws a pre-classified KdfDerivationFailedError without wrapping", async () => {
    const pre = KdfDerivationFailedError.libraryFailure(new Error("upstream"));
    argon2idAsync.mockImplementationOnce(() => {
      throw pre;
    });
    const kdf = new Argon2idKdf();
    try {
      await kdf.derive(Passphrase.from("a-strong-passphrase"), params());
      expect.fail("expected derive to throw");
    } catch (thrown) {
      expect(thrown).toBe(pre);
    }
  });

  it("returns ok(DerivedKey) when noble resolves successfully (sanity)", async () => {
    const fake = new Uint8Array(32).fill(0xab);
    argon2idAsync.mockImplementationOnce(() => Promise.resolve(fake));
    const kdf = new Argon2idKdf();
    const result = await kdf.derive(
      Passphrase.from("a-strong-passphrase"),
      params(),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.length()).toBe(32);
    }
  });
});

describe("Argon2idKdf — algorithm-mismatch defensive guard", () => {
  it("throws KdfDerivationFailedError when params.algorithm.isArgon2id() returns false", async () => {
    // The `KdfAlgorithm` VO only constructs `argon2id` today, but the
    // adapter still re-checks the discriminator as defence-in-depth.
    // We bypass the factory by mutating the read-only property after
    // construction (matches the pattern used by the parameter-floor
    // tests in `argon2id-kdf.test.ts`).
    const goodParams = params();
    const stubAlgorithm = {
      isArgon2id: (): boolean => false,
      toString: (): string => "argon2i-future",
    };
    Object.defineProperty(goodParams, "algorithm", {
      value: stubAlgorithm,
      writable: false,
      configurable: false,
    });
    const kdf = new Argon2idKdf();
    await expect(
      kdf.derive(Passphrase.from("a-strong-passphrase"), goodParams),
    ).rejects.toBeInstanceOf(KdfDerivationFailedError);
  });

  it("derive() Result Err channel surfaces WeakKdfParamsError for memory_kib floor", async () => {
    // Sanity check that the typed-error path stays disjoint from the
    // throw path: weak params return Err(WeakKdfParamsError) without
    // touching the algorithm guard.
    const goodParams = params();
    Object.defineProperty(goodParams, "memoryKib", {
      value: 1024,
      writable: false,
      configurable: false,
    });
    const kdf = new Argon2idKdf();
    const result = await kdf.derive(
      Passphrase.from("a-strong-passphrase"),
      goodParams,
    );
    expect(isErr(result)).toBe(true);
  });
});
