/**
 * Public surface of `modules/secrets/application/use-cases/`.
 *
 * Re-exports the concrete use case classes so the composition root
 * can wire them with their adapters in one place.
 */

export { ScanTextUseCase } from "./scan-text.use-case.ts";
export { SanitizePathUseCase } from "./sanitize-path.use-case.ts";
export { RecordSecretEventUseCase } from "./record-secret-event.use-case.ts";
export { InstallPreCommitHookUseCase } from "./install-pre-commit-hook.use-case.ts";
