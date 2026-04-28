import { describe, it, expect } from "vitest";
import { Argon2idKdf } from "../../../../src/modules/encryption/infrastructure/kdf/argon2id-kdf.ts";
import { Passphrase } from "../../../../src/modules/encryption/domain/value-objects/passphrase.ts";
import { KdfParams } from "../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { SaltBytes } from "../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { isOk, isErr } from "../../../../src/shared/domain/types/result.ts";
import { WeakKdfParamsError } from "../../../../src/modules/encryption/domain/errors/weak-kdf-params-error.ts";

const params = (): KdfParams =>
  KdfParams.defaults(SaltBytes.from(new Uint8Array(16).fill(7)));

describe("Argon2idKdf", () => {
  const kdf = new Argon2idKdf();

  it("derives a 32-byte key (slow but real)", { timeout: 30_000 }, async () => {
    const result = await kdf.derive(
      Passphrase.from("a-strong-passphrase"),
      params(),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.length()).toBe(32);
    }
  });

  it(
    "deterministic: same passphrase + params → same derived key",
    { timeout: 30_000 },
    async () => {
      const a = await kdf.derive(
        Passphrase.from("a-strong-passphrase"),
        params(),
      );
      const b = await kdf.derive(
        Passphrase.from("a-strong-passphrase"),
        params(),
      );
      if (isOk(a) && isOk(b)) {
        expect(a.value.equals(b.value)).toBe(true);
      } else {
        expect.fail("expected both Ok");
      }
    },
  );

  it(
    "different passphrase → different key",
    { timeout: 30_000 },
    async () => {
      const a = await kdf.derive(
        Passphrase.from("passphrase-alpha-12"),
        params(),
      );
      const b = await kdf.derive(
        Passphrase.from("passphrase-beta-1234"),
        params(),
      );
      if (isOk(a) && isOk(b)) {
        expect(a.value.equals(b.value)).toBe(false);
      }
    },
  );

  it("returns Err(WeakKdfParamsError) when bypassed params are weak", async () => {
    const adapter = new Argon2idKdf();
    // Build a "weak" KdfParams by patching the prototype after creation —
    // we use a trick: build with floor params, then mutate via Object.defineProperty.
    const goodParams = params();
    Object.defineProperty(goodParams, "memoryKib", {
      value: 1024,
      writable: false,
      configurable: false,
    });
    const result = await adapter.derive(
      Passphrase.from("a-strong-passphrase"),
      goodParams,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(WeakKdfParamsError);
      expect(result.error.parameter).toBe("memory_kib");
    }
  });

  it("returns Err for weak iterations", async () => {
    const adapter = new Argon2idKdf();
    const goodParams = params();
    Object.defineProperty(goodParams, "iterations", {
      value: 1,
      writable: false,
      configurable: false,
    });
    const result = await adapter.derive(
      Passphrase.from("a-strong-passphrase"),
      goodParams,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.parameter).toBe("iterations");
    }
  });

  it("returns Err for weak parallelism", async () => {
    const adapter = new Argon2idKdf();
    const goodParams = params();
    Object.defineProperty(goodParams, "parallelism", {
      value: 1,
      writable: false,
      configurable: false,
    });
    const result = await adapter.derive(
      Passphrase.from("a-strong-passphrase"),
      goodParams,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.parameter).toBe("parallelism");
    }
  });
});
