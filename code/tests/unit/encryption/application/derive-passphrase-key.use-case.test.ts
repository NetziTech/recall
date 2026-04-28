import { describe, it, expect } from "vitest";
import { DerivePassphraseKeyUseCase } from "../../../../src/modules/encryption/application/use-cases/derive-passphrase-key.use-case.ts";
import { Passphrase } from "../../../../src/modules/encryption/domain/value-objects/passphrase.ts";
import { KdfParams } from "../../../../src/modules/encryption/domain/value-objects/kdf-params.ts";
import { SaltBytes } from "../../../../src/modules/encryption/domain/value-objects/salt-bytes.ts";
import { DerivedKey } from "../../../../src/modules/encryption/domain/value-objects/derived-key.ts";
import { WeakKdfParamsError } from "../../../../src/modules/encryption/domain/errors/weak-kdf-params-error.ts";
import { ok, err, isOk, isErr } from "../../../../src/shared/domain/types/result.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

describe("DerivePassphraseKeyUseCase", () => {
  it("returns Ok(DerivedKey) when KDF succeeds", async () => {
    const expected = DerivedKey.from(buf(32, 0xab));
    const useCase = new DerivePassphraseKeyUseCase(
      { derive: async () => Promise.resolve(ok(expected)) },
      new RecordingLogger(),
    );
    const result = await useCase.derive({
      passphrase: Passphrase.from("strong-passphrase-here"),
      params: KdfParams.defaults(SaltBytes.from(buf(16, 1))),
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.equals(expected)).toBe(true);
    }
  });

  it("returns Err(WeakKdfParamsError) when KDF rejects", async () => {
    const error = new WeakKdfParamsError({
      parameter: "memory_kib",
      actual: 1,
      minimum: 65536,
    });
    const useCase = new DerivePassphraseKeyUseCase(
      { derive: async () => Promise.resolve(err(error)) },
      new RecordingLogger(),
    );
    const result = await useCase.derive({
      passphrase: Passphrase.from("strong-passphrase-here"),
      params: KdfParams.defaults(SaltBytes.from(buf(16, 1))),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.parameter).toBe("memory_kib");
    }
  });

  it("logs at debug without leaking passphrase length", async () => {
    const logger = new RecordingLogger();
    const useCase = new DerivePassphraseKeyUseCase(
      {
        derive: async () =>
          Promise.resolve(ok(DerivedKey.from(buf(32, 1)))),
      },
      logger,
    );
    await useCase.derive({
      passphrase: Passphrase.from("strong-passphrase-here"),
      params: KdfParams.defaults(SaltBytes.from(buf(16, 1))),
    });
    const debug = logger.entries.find((e) => e.level === "debug");
    expect(debug).toBeDefined();
    if (typeof debug?.payload === "object") {
      expect(JSON.stringify(debug.payload)).not.toContain("strong-passphrase");
    }
  });
});
