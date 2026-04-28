/**
 * Public surface of `modules/secrets/application/ports/`.
 *
 * The split between `in/` and `out/` mirrors the canonical hexagonal
 * naming convention from `docs/12-lineamientos-arquitectura.md` §1.3
 * and keeps the dependency arrows visible at the import path level.
 *
 * Driven (output) ports that already live in `domain/` (the source
 * of truth for `SecretsScanner`, `PatternRegistry`,
 * `EntropyCalculator`, `SecretAuditRepository`) are NOT re-exported
 * here: their natural home is the domain because the aggregates and
 * services consume them directly. Only ports that are exclusively
 * application-layer concerns (today: `PreCommitHookInstaller`) live
 * under `application/ports/out/`.
 */

export type { ScanText } from "./in/scan-text.port.ts";
export type { SanitizePath } from "./in/sanitize-path.port.ts";
export type { RecordSecretEvent } from "./in/record-secret-event.port.ts";
export type { InstallPreCommitHook } from "./in/install-pre-commit-hook.port.ts";

export type {
  PreCommitHookInstaller,
  PreCommitHookInstallReceipt,
  PreCommitHookInstallStatus,
} from "./out/pre-commit-hook-installer.port.ts";
export { isPreCommitHookInstallStatus } from "./out/pre-commit-hook-installer.port.ts";
