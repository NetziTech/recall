import type { WorkspaceMode } from "../../../domain/value-objects/workspace-mode.ts";
import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";

/**
 * Driven (output) port for the side effects the workspace use cases
 * need to perform on the host filesystem:
 *
 *   - Create / remove the `.mcp-memoria/` directory tree.
 *   - Read / write `<root>/.mcp-memoria/config.json` (with `0o600`).
 *   - Manage the host project's `.gitignore` according to the privacy
 *     mode (`docs/11-seguridad-modos.md` §§2-4).
 *
 * Why this is a port and not a thin `node:fs` call from the use
 * case:
 *   - Hexagonal: the use case must be testable without touching disk.
 *     A `RecordingWorkspaceFilesystem` test double can capture writes
 *     and replay reads from a map.
 *   - Boundary for the file-permission contract. The implementation
 *     guarantees `config.json` lands with `0o600`; the use case
 *     never has to remember the constant.
 *   - Boundary for path validation. The adapter is the layer that
 *     refuses `..` segments and NUL bytes; the use case operates on
 *     `WorkspacePath` instances that have already been canonicalised.
 *
 * Mode-aware behaviour:
 *   - `shared`    : do nothing to `.gitignore` (memory is versioned plain).
 *   - `encrypted` : do nothing to `.gitignore` (memory is versioned
 *                   ciphered). If a previous `private` lifecycle had
 *                   inserted an exclusion, REMOVE it.
 *   - `private`   : ensure `.mcp-memoria/` is present in the host
 *                   project's `.gitignore` (or create the file). The
 *                   adapter does NOT prompt for confirmation: that is
 *                   a CLI concern. The use case is responsible for
 *                   gating user consent before invoking this port.
 */

/**
 * Snapshot of `<root>/.mcp-memoria/config.json` returned by
 * {@link WorkspaceFilesystem.readConfig}. The fields mirror the
 * persistent slice documented in `docs/03-modelo-datos.md` §2 plus
 * the encryption sub-slice (when present). The application layer is
 * responsible for parsing the strings into the domain VOs.
 */
export interface PersistedWorkspaceConfig {
  readonly schemaVersion: string;
  readonly workspaceId: string;
  readonly displayName: string;
  readonly mode: string;
  readonly createdAtMs: number;
  readonly embedder: {
    readonly provider: string;
    readonly model: string;
    readonly dim: number;
  };
}

export interface WorkspaceFilesystem {
  /**
   * Returns `true` iff `<root>/.mcp-memoria/config.json` exists and is
   * a regular file. Does NOT verify its contents; that is the
   * caller's job once it parses the file via {@link readConfig}.
   */
  workspaceExists(rootPath: WorkspacePath): Promise<boolean>;

  /**
   * Creates the `<root>/.mcp-memoria/` directory tree. Idempotent: if
   * the directory already exists the adapter does nothing. The mode
   * of the directory itself is `0o700`.
   */
  createWorkspaceDirectory(rootPath: WorkspacePath): Promise<void>;

  /**
   * Reads and parses `<root>/.mcp-memoria/config.json`. Throws a
   * `WorkspaceInfrastructureError` when the file is missing,
   * unreadable, or fails JSON validation against the
   * `PersistedWorkspaceConfig` schema. The adapter performs only
   * shape validation here; semantic validation (e.g. "is the mode
   * actually one of the three allowed strings?") happens in the use
   * case via the domain VO factories.
   */
  readConfig(rootPath: WorkspacePath): Promise<PersistedWorkspaceConfig>;

  /**
   * Writes `<root>/.mcp-memoria/config.json` atomically (write to a
   * temporary sibling then rename) with permissions `0o600`. Throws
   * a `WorkspaceInfrastructureError` on any I/O failure; partial
   * writes never reach the canonical filename.
   */
  writeConfig(
    rootPath: WorkspacePath,
    config: PersistedWorkspaceConfig,
  ): Promise<void>;

  /**
   * Updates the host project's `.gitignore` to match the policy of
   * `mode`:
   *   - `private`    : ensure a `.mcp-memoria/` line is present.
   *   - `shared`/`encrypted`: ensure no `.mcp-memoria/` line is
   *     present (remove it if a previous lifecycle had added it).
   *
   * Idempotent. The adapter creates the `.gitignore` file when
   * absent and `mode` is `private`; for the other modes it never
   * creates the file.
   */
  ensureGitignore(
    rootPath: WorkspacePath,
    mode: WorkspaceMode,
  ): Promise<void>;

  /**
   * Removes the entire `<root>/.mcp-memoria/` directory tree
   * recursively. Used by `DestroyWorkspaceUseCase` (the `mcp-memoria
   * wipe` flow) AFTER the SQL tables have been truncated and any
   * encryption material has been destroyed.
   *
   * Defense-in-depth: implementations MUST resolve the deletion target
   * to `<rootPath>/.mcp-memoria/` and refuse to remove anything else
   * (no following symlinks, no surprising parent-of-target deletions).
   * The CLI confirmation gate (literal `WIPE` or `--confirm`) lives
   * one layer up; this port assumes the caller already obtained
   * consent.
   *
   * Idempotent: a non-existent `.mcp-memoria/` is a no-op (no error).
   */
  removeWorkspaceDirectory(rootPath: WorkspacePath): Promise<void>;
}
