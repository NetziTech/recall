/**
 * Wires the `encryption` module: the cipher / KDF / random / validator
 * adapters, the persistence adapter (`JsonEncryptionConfigRepository`),
 * and the five use cases (`InitializeEncryption`, `UnlockEncryption`,
 * `LockEncryption`, `DerivePassphraseKey`, `DestroyEncryption`).
 *
 * Persistence adapter:
 *   - `JsonEncryptionConfigRepository` reads / writes the encryption
 *     slice of `<workspaceRoot>/.recall/config.json` via
 *     `node:fs/promises`. The adapter receives an absolute,
 *     canonicalised `workspaceRoot` from the bootstrap caller.
 *
 * Destroy use case:
 *   - `DestroyEncryptionUseCase` requires a publish-event closure
 *     (callable form of `EventPublisher.publish(event)`). The wiring
 *     wraps the shared publisher in a synchronous closure: the use
 *     case's call signature treats domain-event publishing as
 *     fire-and-forget per the publisher contract (the publisher
 *     itself is non-throwing).
 */

import type { Clock } from "../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../shared/application/ports/logger.port.ts";
import type { DomainEvent } from "../../shared/domain/types/domain-event.ts";
import { DerivePassphraseKeyUseCase } from "../../modules/encryption/application/use-cases/derive-passphrase-key.use-case.ts";
import { DestroyEncryptionUseCase } from "../../modules/encryption/application/use-cases/destroy-encryption.use-case.ts";
import { InitializeEncryptionUseCase } from "../../modules/encryption/application/use-cases/initialize-encryption.use-case.ts";
import { LockEncryptionUseCase } from "../../modules/encryption/application/use-cases/lock-encryption.use-case.ts";
import { UnlockEncryptionUseCase } from "../../modules/encryption/application/use-cases/unlock-encryption.use-case.ts";
import type { EncryptionConfigRepository } from "../../modules/encryption/domain/repositories/encryption-config-repository.ts";
import type { EnvelopeCipher } from "../../modules/encryption/domain/services/envelope-cipher.ts";
import type { Kdf } from "../../modules/encryption/application/ports/out/kdf.port.ts";
import type { RandomBytes } from "../../modules/encryption/application/ports/out/random-bytes.port.ts";
import {
  AesGcmEnvelopeCipher,
  AesGcmKeyValidator,
  AesGcmValidatorEncrypter,
  Argon2idKdf,
  JsonEncryptionConfigRepository,
  WebCryptoRandomBytes,
} from "../../modules/encryption/infrastructure/index.ts";

/**
 * Bag of encryption use cases the rest of composition consumes via
 * facades. The concrete classes implement the `*Encryption` driving
 * ports; the wrapping happens in `facades/workspace-encryption-facades.ts`.
 */
export interface EncryptionWiring {
  readonly initializeEncryption: InitializeEncryptionUseCase;
  readonly unlockEncryption: UnlockEncryptionUseCase;
  readonly lockEncryption: LockEncryptionUseCase;
  readonly destroyEncryption: DestroyEncryptionUseCase;
  readonly derivePassphraseKey: DerivePassphraseKeyUseCase;
  readonly repository: EncryptionConfigRepository;
  /**
   * Crypto primitives + RNG re-exposed so the composition root can
   * wire the database-dependent `AddEnvelopeUseCase` (ADR-005
   * multi-key flow) without duplicating the adapter instances. The
   * use case lives outside this wiring file because it needs a live
   * SQLite connection (audit-log adapter), which the bootstrap only
   * opens AFTER the encryption module has been initialised.
   */
  readonly primitives: EncryptionPrimitives;
}

/**
 * Subset of the encryption module's wired adapters that the
 * composition root needs to construct database-dependent use cases
 * (currently `AddEnvelopeUseCase`).
 */
export interface EncryptionPrimitives {
  readonly kdf: Kdf;
  readonly envelopeCipher: EnvelopeCipher;
  readonly randomBytes: RandomBytes;
}

export interface EncryptionWiringOptions {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly eventPublisher: EventPublisher;
  /** Absolute, canonicalised path of the workspace's host directory. */
  readonly workspaceRoot: string;
}

/**
 * Builds the encryption module wiring with the canonical adapters:
 *
 *   - `kdf`               → `Argon2idKdf`
 *   - `envelopeCipher`    → `AesGcmEnvelopeCipher`
 *   - `keyValidator`      → `AesGcmKeyValidator`
 *   - `validatorEncrypter`→ `AesGcmValidatorEncrypter`
 *   - `randomBytes`       → `WebCryptoRandomBytes`
 *   - `repository`        → `JsonEncryptionConfigRepository`.
 */
export function buildEncryptionWiring(
  options: EncryptionWiringOptions,
): EncryptionWiring {
  const repository = new JsonEncryptionConfigRepository({
    workspaceRoot: options.workspaceRoot,
    clock: options.clock,
    logger: options.logger,
  });
  const kdf = new Argon2idKdf();
  const envelopeCipher = new AesGcmEnvelopeCipher();
  const keyValidator = new AesGcmKeyValidator();
  const validatorEncrypter = new AesGcmValidatorEncrypter();
  const randomBytes = new WebCryptoRandomBytes();

  // Synchronous publish closure for the destroy use case. The
  // `EventPublisher.publish(...)` call is non-throwing per its
  // contract; we forward the returned promise into a `void` so a
  // pending subscriber does not block the use case.
  const publishEvent = (event: DomainEvent): void => {
    void options.eventPublisher.publish(event);
  };

  const initializeEncryption = new InitializeEncryptionUseCase(
    repository,
    kdf,
    envelopeCipher,
    validatorEncrypter,
    randomBytes,
    options.idGenerator,
    options.clock,
    options.logger,
  );

  const unlockEncryption = new UnlockEncryptionUseCase(
    repository,
    kdf,
    envelopeCipher,
    keyValidator,
    options.clock,
    options.logger,
  );

  const lockEncryption = new LockEncryptionUseCase(
    repository,
    options.clock,
    options.logger,
  );

  const destroyEncryption = new DestroyEncryptionUseCase(
    repository,
    kdf,
    envelopeCipher,
    keyValidator,
    options.clock,
    options.logger,
    publishEvent,
  );

  const derivePassphraseKey = new DerivePassphraseKeyUseCase(kdf, options.logger);

  return {
    initializeEncryption,
    unlockEncryption,
    lockEncryption,
    destroyEncryption,
    derivePassphraseKey,
    repository,
    primitives: { kdf, envelopeCipher, randomBytes },
  };
}
