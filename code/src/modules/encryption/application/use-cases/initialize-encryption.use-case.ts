import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { isErr } from "../../../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EncryptionConfig } from "../../domain/aggregates/encryption-config.ts";
import type { EnvelopeCipher } from "../../domain/services/envelope-cipher.ts";
import type { EncryptionConfigRepository } from "../../domain/repositories/encryption-config-repository.ts";
import { KdfParams } from "../../domain/value-objects/kdf-params.ts";
import { KdfSpec } from "../../domain/value-objects/kdf-spec.ts";
import { KeyEnvelope } from "../../domain/value-objects/key-envelope.ts";
import { KeyId } from "../../domain/value-objects/key-id.ts";
import { MasterKey } from "../../domain/value-objects/master-key.ts";
import type { Passphrase } from "../../domain/value-objects/passphrase.ts";
import { SaltBytes } from "../../domain/value-objects/salt-bytes.ts";
import type { InitializeEncryption } from "../ports/in/initialize-encryption.port.ts";
import type { Kdf } from "../ports/out/kdf.port.ts";
import type { RandomBytes } from "../ports/out/random-bytes.port.ts";
import type { ValidatorEncrypter } from "../ports/out/validator-encrypter.port.ts";

/**
 * Canonical sentinel encrypted under the master key and stored as
 * the workspace's `key_validator_blob`. Reflects the spec sentinel
 * documented in `docs/11-seguridad-modos.md` §7 ("Validacion de
 * clave"); using a fixed, versioned token keeps the validator path
 * deterministic for a given workspace and lets future versions of
 * the validator (`VALID-WORKSPACE-V2`, ...) bump the prefix without
 * breaking backwards compatibility. Encoded as UTF-8 in the use
 * case body — `TextEncoder` is part of the Node 20 standard
 * library so no dependency is added.
 */
const VALIDATOR_SENTINEL_TEXT = "VALID-WORKSPACE-V1";

/**
 * Length of the salt used by the KDF. Mirrors
 * `SaltBytes.minLengthBytes()`; the use case picks the floor because
 * RFC 9106 §3.1 declares 16 bytes the recommended minimum and there
 * is no upside to going larger by default.
 */
const SALT_LENGTH_BYTES = 16;

/**
 * Use case: initialise encryption for a workspace.
 *
 * See `InitializeEncryption` (input port) for the high-level flow.
 *
 * Implementation notes:
 * - Every random buffer comes from the injected `RandomBytes` port,
 *   not from a direct `crypto.getRandomValues` call. This keeps the
 *   composition root in charge of the entropy source and makes the
 *   use case trivially testable (a `FakeRandomBytes` adapter yields
 *   a deterministic byte sequence).
 * - The KDF parameters use the canonical defaults
 *   (`KdfParams.defaults(salt)`); the user can rotate to stronger
 *   parameters later via `add-key --kdf-params ...` (a v0.5 flow).
 * - The master key is generated INSIDE this use case rather than by
 *   the aggregate factory because it requires CSPRNG access; passing
 *   it via `EncryptionConfig.initialize(...)` keeps the aggregate
 *   pure (no infrastructure dependency).
 * - The first envelope's `keyId` is minted via the shared
 *   `IdGenerator` port — same path every other aggregate uses.
 * - The validator blob is produced by the dedicated
 *   `ValidatorEncrypter` port (NOT by reusing `EnvelopeCipher`).
 *   See the port JSDoc for the SOLID-ISP rationale.
 *
 * Security:
 * - The use case logs only public metadata (workspace id, key id,
 *   algorithm name). NEVER the master key, derived key, passphrase,
 *   salt or validator plaintext.
 * - Primitive failures (KDF, AEAD, CSPRNG) propagate as
 *   `EncryptionInfrastructureError` exceptions; the use case does
 *   not swallow them.
 */
export class InitializeEncryptionUseCase implements InitializeEncryption {
  public constructor(
    private readonly repository: EncryptionConfigRepository,
    private readonly kdf: Kdf,
    private readonly envelopeCipher: EnvelopeCipher,
    private readonly validatorEncrypter: ValidatorEncrypter,
    private readonly randomBytes: RandomBytes,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async initialize(input: {
    workspaceId: WorkspaceId;
    passphrase: Passphrase;
  }): Promise<EncryptionConfig> {
    // 1. Materials: master key + salt.
    const masterKey = MasterKey.from(
      this.randomBytes.next(MasterKey.lengthBytes()),
    );
    const salt = SaltBytes.from(this.randomBytes.next(SALT_LENGTH_BYTES));

    // 2. KDF spec + params (defaults: argon2id + 64 MiB / 3 / 4).
    const kdfParams = KdfParams.defaults(salt);
    const kdfSpec = KdfSpec.create({
      algorithm: kdfParams.algorithm,
      params: kdfParams,
    });

    // 3. Derive the user key from the passphrase. The KDF port may
    //    return a `WeakKdfParamsError` only if the params bypass the
    //    domain factory (defence in depth); the defaults we just
    //    built do not, so this branch is theoretically unreachable.
    //    We surface the error as a thrown exception because there is
    //    no Result channel on this use case (the input port returns
    //    a plain `Promise<EncryptionConfig>` — see the port JSDoc).
    const derivation = await this.kdf.derive(input.passphrase, kdfParams);
    if (isErr(derivation)) {
      throw derivation.error;
    }
    const derivedKey = derivation.value;

    // 4. Wrap the master key with the derived key → first envelope.
    const wrappedMasterKey = await this.envelopeCipher.wrap(
      masterKey,
      derivedKey,
    );

    // 5. AEAD-encrypt the validator sentinel under the master key
    //    via the dedicated port. The encoded text is 18 bytes; the
    //    cipher does NOT pad. The plaintext is recovered verbatim
    //    on validate.
    const sentinelPlaintext = new TextEncoder().encode(VALIDATOR_SENTINEL_TEXT);
    const validatorBlob = await this.validatorEncrypter.encrypt({
      masterKey,
      plaintext: sentinelPlaintext,
    });

    // 6. Build the first key envelope.
    const keyId = KeyId.from(this.idGenerator.generateString());
    const occurredAt = this.clock.now();
    const envelope = KeyEnvelope.create({
      keyId,
      encryptedMasterKey: wrappedMasterKey,
      kdfParams,
      createdAt: occurredAt,
      label: null,
    });

    // 7. Construct the aggregate (starts UNLOCKED, emits
    //    `EncryptionInitialized`).
    const config = EncryptionConfig.initialize({
      workspaceId: input.workspaceId,
      masterKey,
      firstEnvelope: envelope,
      kdfSpec,
      validatorBlob,
      occurredAt,
    });

    // 8. Persist.
    await this.repository.save(config);

    this.logger.info(
      {
        workspaceId: input.workspaceId.toString(),
        keyId: keyId.toString(),
        algorithm: kdfSpec.algorithm.toString(),
      },
      "encryption initialized",
    );

    return config;
  }
}
