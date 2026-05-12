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
 * - The absolute path of the offending hook lives in
 *   `details.path` (W-3.5-SEC-L2). Although the path is always
 *   `<workspaceRoot>/.git/hooks/pre-commit` — i.e. derivable from
 *   public state — we keep it out of `message` and inside a
 *   structured field so the pino redactor (`details.path` is in
 *   `DEFAULT_REDACT_PATHS`) can hide it from logs uniformly with
 *   the other workspace-tier errors. The JSON-RPC wire mapper only
 *   surfaces `message` to clients, so this also keeps absolute
 *   paths out of remote responses.
 */
export type ForeignHookExistsErrorDetails = Readonly<{
  readonly path: string;
}>;

export class ForeignHookExistsError extends SecretsInfrastructureError {
  public readonly code = "secrets.foreign-hook-exists";
  public readonly details: ForeignHookExistsErrorDetails;

  public constructor(hookPath: string, cause?: unknown) {
    super(
      "pre-commit hook is not managed by recall; pass --force to overwrite",
      cause,
    );
    this.details = { path: hookPath };
  }
}
