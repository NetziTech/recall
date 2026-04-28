import { describe, it, expect } from "vitest";
import { AesGcmEnvelopeCipher } from "../../../../src/modules/encryption/infrastructure/cipher/aes-gcm-envelope-cipher.ts";
import { AesGcmKeyValidator } from "../../../../src/modules/encryption/infrastructure/cipher/aes-gcm-key-validator.ts";
import { AesGcmValidatorEncrypter } from "../../../../src/modules/encryption/infrastructure/cipher/aes-gcm-validator-encrypter.ts";
import { MasterKey } from "../../../../src/modules/encryption/domain/value-objects/master-key.ts";
import { DerivedKey } from "../../../../src/modules/encryption/domain/value-objects/derived-key.ts";
import { EncryptedMasterKey } from "../../../../src/modules/encryption/domain/value-objects/encrypted-master-key.ts";
import { AeadFailedError } from "../../../../src/modules/encryption/infrastructure/errors/aead-failed-error.ts";

const buf = (n: number, v = 0): Uint8Array => {
  const b = new Uint8Array(n);
  b.fill(v);
  return b;
};

describe("AesGcmEnvelopeCipher", () => {
  const cipher = new AesGcmEnvelopeCipher();

  it("round-trip wrap → unwrap recovers the master key", async () => {
    const masterKey = MasterKey.from(buf(32, 0xab));
    const derivedKey = DerivedKey.from(buf(32, 0xcd));
    const wrapped = await cipher.wrap(masterKey, derivedKey);
    const recovered = await cipher.unwrap(wrapped, derivedKey);
    expect(recovered.equals(masterKey)).toBe(true);
  });

  it("produces 32-byte ciphertext, 12-byte iv, 16-byte tag", async () => {
    const masterKey = MasterKey.from(buf(32, 0x11));
    const derivedKey = DerivedKey.from(buf(32, 0x22));
    const wrapped = await cipher.wrap(masterKey, derivedKey);
    expect(wrapped.ciphertextLength()).toBe(32);
    expect(wrapped.ivLength()).toBe(12);
    expect(wrapped.tagLength()).toBe(16);
  });

  it("each wrap produces a different IV (non-determinism)", async () => {
    const masterKey = MasterKey.from(buf(32, 0xab));
    const derivedKey = DerivedKey.from(buf(32, 0xcd));
    const a = await cipher.wrap(masterKey, derivedKey);
    const b = await cipher.wrap(masterKey, derivedKey);
    const ivA = a.withIv((bytes) => Buffer.from(bytes).toString("hex"));
    const ivB = b.withIv((bytes) => Buffer.from(bytes).toString("hex"));
    expect(ivA).not.toBe(ivB);
  });

  it("unwrap with wrong key throws AeadFailedError (authentication-failed)", async () => {
    const masterKey = MasterKey.from(buf(32, 0xab));
    const goodKey = DerivedKey.from(buf(32, 0xcd));
    const wrongKey = DerivedKey.from(buf(32, 0xff));
    const wrapped = await cipher.wrap(masterKey, goodKey);
    await expect(cipher.unwrap(wrapped, wrongKey)).rejects.toThrow(
      AeadFailedError,
    );
  });

  it("unwrap rejects malformed iv length", async () => {
    const masterKey = MasterKey.from(buf(32, 0xab));
    const dk = DerivedKey.from(buf(32, 0xcd));
    const wrapped = await cipher.wrap(masterKey, dk);
    // Build a malformed envelope with an unsupported IV length
    const malformed = EncryptedMasterKey.create({
      ciphertext: wrapped.withCiphertext((b) => new Uint8Array(b)),
      iv: buf(16),
      tag: wrapped.withTag((b) => new Uint8Array(b)),
    });
    await expect(cipher.unwrap(malformed, dk)).rejects.toThrow(AeadFailedError);
  });
});

describe("AesGcmValidatorEncrypter + AesGcmKeyValidator round-trip", () => {
  const encrypter = new AesGcmValidatorEncrypter();
  const validator = new AesGcmKeyValidator();

  it("encrypts a sentinel and validates it back", async () => {
    const masterKey = MasterKey.from(buf(32, 0x55));
    const sentinel = new TextEncoder().encode("VALID-WORKSPACE-V1");
    const blob = await encrypter.encrypt({ masterKey, plaintext: sentinel });
    const ok = await validator.validate(blob, masterKey);
    expect(ok).toBe(true);
  });

  it("validator returns false for a wrong master key", async () => {
    const masterKey = MasterKey.from(buf(32, 0x55));
    const wrongKey = MasterKey.from(buf(32, 0x66));
    const sentinel = new TextEncoder().encode("VALID-WORKSPACE-V1");
    const blob = await encrypter.encrypt({ masterKey, plaintext: sentinel });
    const ok = await validator.validate(blob, wrongKey);
    expect(ok).toBe(false);
  });

  it("encrypter rejects empty plaintext", async () => {
    const masterKey = MasterKey.from(buf(32, 0x55));
    await expect(
      encrypter.encrypt({ masterKey, plaintext: buf(0) }),
    ).rejects.toThrow(AeadFailedError);
  });

  it("encrypter rejects non-Uint8Array plaintext", async () => {
    const masterKey = MasterKey.from(buf(32, 0x55));
    await expect(
      encrypter.encrypt({
        masterKey,
        plaintext: "hello" as unknown as Uint8Array,
      }),
    ).rejects.toThrow(AeadFailedError);
  });

  it("each validator encryption uses a fresh IV", async () => {
    const masterKey = MasterKey.from(buf(32, 0x55));
    const sentinel = new TextEncoder().encode("VALID-WORKSPACE-V1");
    const a = await encrypter.encrypt({ masterKey, plaintext: sentinel });
    const b = await encrypter.encrypt({ masterKey, plaintext: sentinel });
    const ivA = a.withIv((bytes) => Buffer.from(bytes).toString("hex"));
    const ivB = b.withIv((bytes) => Buffer.from(bytes).toString("hex"));
    expect(ivA).not.toBe(ivB);
  });
});
