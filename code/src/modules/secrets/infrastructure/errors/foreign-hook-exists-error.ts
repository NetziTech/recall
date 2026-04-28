import { SecretsInfrastructureError } from "./secrets-infrastructure-error.ts";

/**
 * Thrown when `FilesystemPreCommitHookInstaller.install(...)` is
 * asked to install a hook over an existing FOREIGN hook (one whose
 * content does not carry the project's managed-by marker) without
 * the `force` flag.
 *
 * Refusing to silently overwrite a foreign hook is the safe default
 * (`docs/11-seguridad-modos.md` §6 "Capa 4 — Pre-commit hook
 * opcional" requires actionable error messages).
 *
 * Invariants:
 * - `code` is the stable identifier `secrets.foreign-hook-exists`.
 * - `hookPath` echoes the absolute path of the offending hook so
 *   the CLI can surface it in the message. The path is NOT
 *   considered confidential (it is always
 *   `<workspaceRoot>/.git/hooks/pre-commit`).
 */
export class ForeignHookExistsError extends SecretsInfrastructureError {
  public readonly code = "secrets.foreign-hook-exists";
  public readonly hookPath: string;

  public constructor(hookPath: string, options?: { cause?: unknown }) {
    super(
      `pre-commit hook at ${hookPath} is not managed by recall; pass --force to overwrite`,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.hookPath = hookPath;
  }
}
