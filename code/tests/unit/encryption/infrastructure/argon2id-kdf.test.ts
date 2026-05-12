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
    // The two derivations are launched in parallel via Promise.all
    // so they interleave their event-loop ticks. Each derivation
    // takes ~30 s of wall-clock on its own; running them
    // sequentially totals > 60 s, which trips Vitest's hardcoded
    // birpc `onTaskUpdate` timeout (vitest issue #8164) and trips
    // CI even though the test itself passes. `argon2idAsync`
    // yields to the event loop on `asyncTick = 10 ms` boundaries
    // so two concurrent calls share CPU efficiently, halving the
    // wall-clock to ~35 s and keeping the test under the 60 s
    // limit on Node 24 LTS Krypton (where GC/JIT cost is ~40%
    // higher than Node 20 Iron).
    { timeout: 45_000 },
    async () => {
      const [a, b] = await Promise.all([
        kdf.derive(Passphrase.from("a-strong-passphrase"), params()),
        kdf.derive(Passphrase.from("a-strong-passphrase"), params()),
      ]);
      if (isOk(a) && isOk(b)) {
        expect(a.value.equals(b.value)).toBe(true);
      } else {
        expect.fail("expected both Ok");
      }
    },
  );

  it(
    "different passphrase → different key",
    // Same parallelisation rationale as the determinism test
    // above: two concurrent argon2id derivations interleave on
    // the asyncTick boundary so wall-clock stays under the
    // birpc 60 s timeout.
    { timeout: 45_000 },
    async () => {
      const [a, b] = await Promise.all([
        kdf.derive(Passphrase.from("passphrase-alpha-12"), params()),
        kdf.derive(Passphrase.from("passphrase-beta-1234"), params()),
      ]);
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
