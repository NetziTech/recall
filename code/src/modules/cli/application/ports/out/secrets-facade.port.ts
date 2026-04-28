/**
 * Driven (output) facade ports toward the secrets module's CLI-facing
 * use cases:
 *
 *   - `mcp-memoria audit`         — run the audit pass over the
 *     workspace's persisted entries, returning a structured report.
 *   - `mcp-memoria sanitize`      — request after-the-fact
 *     redaction of one entry (`docs/11-seguridad-modos.md` §6.6
 *     "Sanitizacion post-hoc").
 *   - `mcp-memoria install-hook`  — install the optional pre-commit
 *     git hook (`docs/11-seguridad-modos.md` §6.4).
 *   - `mcp-memoria uninstall-hook` — remove the installed hook.
 */

export interface AuditFacadeInput {
  readonly rootPath: string;
  readonly checkSecrets: boolean;
  readonly strict: boolean;
}

export interface AuditFinding {
  readonly id: string;
  readonly kind: string;
  readonly severity: "info" | "warn" | "critical";
  readonly summary: string;
}

export interface AuditFacadeOutput {
  readonly findings: readonly AuditFinding[];
  readonly hasCritical: boolean;
}

export interface AuditFacade {
  audit(input: AuditFacadeInput): Promise<AuditFacadeOutput>;
}

export interface SanitizeFacadeInput {
  readonly rootPath: string;
  readonly entryId: string;
}

export interface SanitizeFacadeOutput {
  readonly entryId: string;
  readonly redactedPaths: readonly string[];
}

export interface SanitizeFacade {
  sanitize(input: SanitizeFacadeInput): Promise<SanitizeFacadeOutput>;
}

export interface InstallHookFacadeInput {
  readonly rootPath: string;
}

export interface InstallHookFacadeOutput {
  readonly installedAt: string;
}

export interface InstallHookFacade {
  install(
    input: InstallHookFacadeInput,
  ): Promise<InstallHookFacadeOutput>;
}

export interface UninstallHookFacadeInput {
  readonly rootPath: string;
}

export interface UninstallHookFacadeOutput {
  readonly removedAt: string | null;
}

export interface UninstallHookFacade {
  uninstall(
    input: UninstallHookFacadeInput,
  ): Promise<UninstallHookFacadeOutput>;
}
