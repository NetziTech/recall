/**
 * Public surface of `shared/infrastructure/`.
 *
 * Re-exports the concrete adapters that the composition root wires
 * into use cases. Test doubles
 * ({@link FakeClock}, {@link FakeIdGenerator}) are also exported here
 * because the test composition root (under `tests/`) imports them by
 * the same path; the modularity validator keeps them out of
 * production wiring via Vitest coverage thresholds + the
 * `composition/` import policy.
 *
 * What is intentionally NOT here:
 * - The library-specific types (e.g. `BetterSqlite3Database`,
 *   `FlagEmbedding`). They live inside the adapter files only.
 * - Internal error helpers and helpers; consumers should pattern-match
 *   on the public `code` field of {@link InfrastructureError}, not on
 *   the constructor signatures.
 * - The KDF adapter — see Tarea 2.2 decision (Opción A): the KDF
 *   adapter belongs to `modules/encryption/infrastructure/` because
 *   it consumes domain VOs (`Passphrase`, `KdfParams`, `DerivedKey`).
 *   Pulling it here would invert the dependency graph
 *   (`docs/12 §1.5` Regla 2).
 */

export { SqliteDatabase } from "./database/sqlite-database.ts";
export type {
  EncryptionKeyBytes,
  SqliteDatabaseOpenOptions,
} from "./database/sqlite-database.ts";

export { MigrationsRunner } from "./database/migrations-runner.ts";
export type { MigrationsResult } from "./database/migrations-runner.ts";

export { PinoLogger, DEFAULT_REDACT_PATHS } from "./logger/pino-logger.ts";
export type { PinoLoggerOptions } from "./logger/pino-logger.ts";

export { TransformersEmbedder } from "./embedder/transformers-embedder.ts";
export type {
  TransformersEmbedderOptions,
  TransformersModelName,
} from "./embedder/transformers-embedder.ts";

export { SystemClock } from "./clock/system-clock.ts";
export { FakeClock } from "./clock/fake-clock.ts";
export type { FakeClockOptions } from "./clock/fake-clock.ts";

export { UuidV7IdGenerator } from "./id-generator/uuid-v7-id-generator.ts";
export { FakeIdGenerator } from "./id-generator/fake-id-generator.ts";
export type { FakeIdGeneratorOptions } from "./id-generator/fake-id-generator.ts";

export { secureZero } from "./crypto/secure-zero.ts";

export { InfrastructureError } from "./errors/infrastructure-error.ts";
export { DatabaseError } from "./errors/database-error.ts";
export type { DatabaseErrorCode } from "./errors/database-error.ts";
export { EmbedderError } from "./errors/embedder-error.ts";
export type { EmbedderErrorCode } from "./errors/embedder-error.ts";
