/**
 * Public surface of `modules/secrets/infrastructure/`.
 *
 * Re-exports the concrete adapters so the composition root can wire
 * them with their ports in one place. Mirrors the pattern adopted by
 * `shared/infrastructure/index.ts` and
 * `modules/encryption/infrastructure/index.ts`.
 */

export { ShannonEntropyCalculator } from "./scanner/shannon-entropy-calculator.ts";
export { BuiltInPatternRegistry } from "./scanner/built-in-pattern-registry.ts";
export { DefaultSecretsScanner } from "./scanner/default-secrets-scanner.ts";
export type { DefaultSecretsScannerOptions } from "./scanner/default-secrets-scanner.ts";

export { SqliteSecretAuditRepository } from "./persistence/sqlite-secret-audit-repository.ts";

export { FilesystemPreCommitHookInstaller } from "./hook/filesystem-pre-commit-hook-installer.ts";

export { SecretsInfrastructureError } from "./errors/secrets-infrastructure-error.ts";
export { ForeignHookExistsError } from "./errors/foreign-hook-exists-error.ts";
