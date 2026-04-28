/**
 * Wires the `secrets` module: scanner adapters, the persistence
 * repository, the pre-commit hook installer, and the use cases.
 *
 * The scanner is constructed with the canonical defence-in-depth
 * configuration documented in `docs/11-seguridad-modos.md` §6:
 *   - regex registry (`BuiltInPatternRegistry`)
 *   - entropy calculator (`ShannonEntropyCalculator`)
 *   - default entropy threshold (4.5 bits/char per RFC heuristic)
 *   - tilde-rewrite path policy keyed on `os.userInfo().username`
 *     so paths that include the user's home are redacted to `~`.
 */

import * as os from "node:os";

import type { DatabaseConnection } from "../../shared/application/ports/database-connection.port.ts";
import type { Clock } from "../../shared/application/ports/clock.port.ts";
import type { IdGenerator } from "../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../shared/application/ports/logger.port.ts";
import { InstallPreCommitHookUseCase } from "../../modules/secrets/application/use-cases/install-pre-commit-hook.use-case.ts";
import { RecordSecretEventUseCase } from "../../modules/secrets/application/use-cases/record-secret-event.use-case.ts";
import { SanitizePathUseCase } from "../../modules/secrets/application/use-cases/sanitize-path.use-case.ts";
import { ScanTextUseCase } from "../../modules/secrets/application/use-cases/scan-text.use-case.ts";
import { EntropyThreshold } from "../../modules/secrets/domain/value-objects/entropy-threshold.ts";
import { PathSanitizerRule } from "../../modules/secrets/domain/value-objects/path-sanitizer-rule.ts";
import {
  BuiltInPatternRegistry,
  DefaultSecretsScanner,
  FilesystemPreCommitHookInstaller,
  ShannonEntropyCalculator,
  SqliteSecretAuditRepository,
} from "../../modules/secrets/infrastructure/index.ts";

/**
 * Bag of secrets-module use cases consumed by the CLI and the
 * mcp-server's `mem.remember` flow (Capa 1/2 secret detection).
 */
export interface SecretsWiring {
  readonly installPreCommitHook: InstallPreCommitHookUseCase;
  readonly recordSecretEvent: RecordSecretEventUseCase;
  readonly sanitizePath: SanitizePathUseCase;
  readonly scanText: ScanTextUseCase;
}

export interface SecretsWiringOptions {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly database: DatabaseConnection;
}

/**
 * Builds the secrets wiring. The defence-in-depth scanner uses:
 *   - `BuiltInPatternRegistry` (no extra patterns).
 *   - `ShannonEntropyCalculator`.
 *   - `EntropyThreshold.defaultThreshold()` (4.5 bits/char).
 *   - `PathSanitizerRule.tildeRewrite(username)`.
 *
 * The pre-commit hook installer reuses the same path-sanitiser rule.
 */
export function buildSecretsWiring(options: SecretsWiringOptions): SecretsWiring {
  const username = os.userInfo().username;
  const pathSanitizerRule = PathSanitizerRule.tildeRewrite(username);

  const patternRegistry = new BuiltInPatternRegistry();
  const entropyCalculator = new ShannonEntropyCalculator();
  const entropyThreshold = EntropyThreshold.defaultThreshold();

  const scanner = new DefaultSecretsScanner({
    patternRegistry,
    entropyCalculator,
    entropyThreshold,
    pathSanitizerRule,
  });

  const auditRepository = new SqliteSecretAuditRepository(options.database);
  const hookInstaller = new FilesystemPreCommitHookInstaller({
    pathSanitizerRule,
  });

  const installPreCommitHook = new InstallPreCommitHookUseCase(
    hookInstaller,
    options.logger,
  );
  const recordSecretEvent = new RecordSecretEventUseCase(
    auditRepository,
    options.idGenerator,
    options.clock,
    options.logger,
  );
  const sanitizePath = new SanitizePathUseCase(scanner);
  const scanText = new ScanTextUseCase(scanner, options.logger);

  return {
    installPreCommitHook,
    recordSecretEvent,
    sanitizePath,
    scanText,
  };
}
