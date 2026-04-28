import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";

import type {
  PersistedWorkspaceConfig,
  WorkspaceFilesystem,
} from "../../application/ports/out/workspace-filesystem.port.ts";
import type { WorkspaceMode } from "../../domain/value-objects/workspace-mode.ts";
import type { WorkspacePath } from "../../domain/value-objects/workspace-path.ts";
import { WorkspaceInfrastructureError } from "../errors/workspace-infrastructure-error.ts";

/**
 * Subdirectory inside a host project that contains the workspace
 * payload. Constant per `docs/03-modelo-datos.md` §1.
 */
const WORKSPACE_DIRECTORY_NAME = ".mcp-memoria";
const CONFIG_FILE_NAME = "config.json";
const GITIGNORE_FILE_NAME = ".gitignore";

/** Permission bits documented in `docs/11-seguridad-modos.md` §7. */
const CONFIG_FILE_MODE = 0o600;
const WORKSPACE_DIR_MODE = 0o700;

/**
 * Token written into the host `.gitignore` when the privacy mode is
 * `private`. Trailing slash is the conventional ignore-shape for a
 * directory and matches the example in `docs/11-seguridad-modos.md` §4.
 */
const GITIGNORE_LINE = `${WORKSPACE_DIRECTORY_NAME}/`;

/**
 * Zod schema enforcing the on-disk shape of `config.json`. The
 * persisted slice mirrors `docs/03-modelo-datos.md` §2.
 *
 * - `schema_version` MAJOR.MINOR.PATCH
 * - `workspace_id`   UUID v7 (full validation deferred to the
 *                    `WorkspaceId` VO)
 * - `display_name`   non-empty string
 * - `mode`           one of "shared" | "encrypted" | "private"
 * - `created_at_ms`  non-negative integer
 * - `embedder`       provider/model/dim sub-object
 *
 * `metadata`, `secrets`, `retrieval`, `curator`, and the
 * encrypted-mode sub-fields (`kdf`, `kdf_params`, `key_envelopes`,
 * `key_validator_blob_b64`) are intentionally NOT modelled here:
 * they are owned by the secrets, retrieval, curator, and encryption
 * modules respectively, and the workspace adapter must stay
 * decoupled from their schemas. The adapter passes them through
 * unchanged when re-writing the file.
 */
const PERSISTED_CONFIG_SCHEMA = z.looseObject({
  schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  workspace_id: z.string().min(1),
  display_name: z.string().min(1),
  mode: z.enum(["shared", "encrypted", "private"]),
  created_at_ms: z.number().int().nonnegative(),
  embedder: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    dim: z.number().int().positive(),
  }),
});

type RawConfig = z.infer<typeof PERSISTED_CONFIG_SCHEMA>;

/**
 * Filesystem adapter for the workspace module. Implements
 * {@link WorkspaceFilesystem} by delegating to `node:fs/promises` and
 * using POSIX-style atomic writes (write-then-rename).
 *
 * Path safety:
 *   - Inputs are `WorkspacePath` instances which the domain has
 *     already validated as absolute. The adapter further canonicalises
 *     the result via `path.resolve` before any I/O.
 *   - `..` segments and NUL bytes inside the workspace name are
 *     rejected at this layer (they cannot exist by construction
 *     because the directory name is a constant, but we assert
 *     defensively to help future changes that allow custom directory
 *     names).
 *
 * Atomicity:
 *   - `writeConfig` writes to a temporary sibling file in the same
 *     directory as the canonical name and renames atomically. Same
 *     filesystem guarantees `rename(2)` is atomic.
 *   - The temporary suffix is randomised via `os.tmpdir`-like seed
 *     (we use `process.pid + Date.now()`) to avoid collisions when
 *     two CLIs initialise concurrently.
 *
 * Concurrency:
 *   - The adapter does NOT take any process-level lock. Concurrent
 *     `writeConfig` invocations against the same workspace would
 *     race in the rename step and the last writer wins. The CLI is
 *     interactive and not run concurrently against the same
 *     workspace; the MCP server holds the database lock at its
 *     SQLite layer. We document this as a known limitation rather
 *     than introducing a flock dance the CLI rarely needs.
 */
export class NodeWorkspaceFilesystem implements WorkspaceFilesystem {
  public async workspaceExists(rootPath: WorkspacePath): Promise<boolean> {
    const configPath = NodeWorkspaceFilesystem.configFilePath(rootPath);
    try {
      const stat = await fs.stat(configPath);
      return stat.isFile();
    } catch (err: unknown) {
      if (NodeWorkspaceFilesystem.isEnoent(err)) return false;
      throw WorkspaceInfrastructureError.configReadFailed(
        rootPath.toString(),
        err,
      );
    }
  }

  public async createWorkspaceDirectory(
    rootPath: WorkspacePath,
  ): Promise<void> {
    const dir = NodeWorkspaceFilesystem.workspaceDirPath(rootPath);
    try {
      await fs.mkdir(dir, { recursive: true, mode: WORKSPACE_DIR_MODE });
      // `mkdir` honours `mode` only on creation; reapply explicitly so
      // an existing directory tightens its permissions on every init.
      await fs.chmod(dir, WORKSPACE_DIR_MODE);
    } catch (err: unknown) {
      throw WorkspaceInfrastructureError.directoryCreateFailed(
        rootPath.toString(),
        err,
      );
    }
  }

  public async readConfig(
    rootPath: WorkspacePath,
  ): Promise<PersistedWorkspaceConfig> {
    const configPath = NodeWorkspaceFilesystem.configFilePath(rootPath);
    let raw: string;
    try {
      raw = await fs.readFile(configPath, "utf8");
    } catch (err: unknown) {
      if (NodeWorkspaceFilesystem.isEnoent(err)) {
        throw WorkspaceInfrastructureError.configMissing(rootPath.toString());
      }
      throw WorkspaceInfrastructureError.configReadFailed(
        rootPath.toString(),
        err,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: unknown) {
      throw WorkspaceInfrastructureError.configMalformed(
        rootPath.toString(),
        `JSON parse failure: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const result = PERSISTED_CONFIG_SCHEMA.safeParse(parsed);
    if (!result.success) {
      throw WorkspaceInfrastructureError.configMalformed(
        rootPath.toString(),
        result.error.message,
      );
    }
    return NodeWorkspaceFilesystem.fromRaw(result.data);
  }

  public async writeConfig(
    rootPath: WorkspacePath,
    config: PersistedWorkspaceConfig,
  ): Promise<void> {
    const configPath = NodeWorkspaceFilesystem.configFilePath(rootPath);
    const dir = path.dirname(configPath);
    const tempPath = path.join(
      dir,
      `.${CONFIG_FILE_NAME}.tmp-${String(process.pid)}-${String(Date.now())}`,
    );

    // Preserve unknown sub-slices (encryption, secrets, retrieval,
    // curator) when re-writing. Reading the existing file (when
    // present) gives us those untouched fields so we can merge the
    // workspace slice on top.
    let existing: Record<string, unknown> = {};
    try {
      const previous = await fs.readFile(configPath, "utf8");
      const parsed: unknown = JSON.parse(previous);
      if (parsed !== null && typeof parsed === "object") {
        existing = parsed as Record<string, unknown>;
      }
    } catch (err: unknown) {
      if (!NodeWorkspaceFilesystem.isEnoent(err)) {
        // Surface read-failures other than ENOENT loudly: an
        // unreadable config means we cannot safely overwrite it.
        throw WorkspaceInfrastructureError.configReadFailed(
          rootPath.toString(),
          err,
        );
      }
    }

    const merged: Record<string, unknown> = {
      ...existing,
      schema_version: config.schemaVersion,
      workspace_id: config.workspaceId,
      display_name: config.displayName,
      mode: config.mode,
      created_at_ms: config.createdAtMs,
      embedder: {
        provider: config.embedder.provider,
        model: config.embedder.model,
        dim: config.embedder.dim,
      },
    };

    const json = `${JSON.stringify(merged, null, 2)}\n`;
    try {
      await fs.writeFile(tempPath, json, {
        encoding: "utf8",
        mode: CONFIG_FILE_MODE,
      });
      await fs.chmod(tempPath, CONFIG_FILE_MODE);
      await fs.rename(tempPath, configPath);
    } catch (err: unknown) {
      // Best-effort cleanup of the temp file.
      await fs.unlink(tempPath).catch(() => undefined);
      throw WorkspaceInfrastructureError.configWriteFailed(
        rootPath.toString(),
        err,
      );
    }
  }

  public async removeWorkspaceDirectory(
    rootPath: WorkspacePath,
  ): Promise<void> {
    const dir = NodeWorkspaceFilesystem.workspaceDirPath(rootPath);
    // Defense-in-depth: ensure the resolved path STILL ends with the
    // workspace directory name. `workspaceDirPath` already constructs
    // `<root>/.mcp-memoria` and resolves it via `path.resolve`, but a
    // future change that lets callers pass a custom directory name (or
    // a buggy refactor) could route this method against an arbitrary
    // path. The guard rejects anything that does not end with the
    // canonical suffix so an `fs.rm` against `/`, `/home`, the
    // user's project root, etc., is impossible by construction.
    if (!NodeWorkspaceFilesystem.endsWithWorkspaceSegment(dir)) {
      throw WorkspaceInfrastructureError.directoryRemoveFailed(
        rootPath.toString(),
        new Error(
          `refused to remove path "${dir}" — does not end with the canonical "${WORKSPACE_DIRECTORY_NAME}" segment`,
        ),
      );
    }
    if (dir.includes("\0")) {
      throw WorkspaceInfrastructureError.directoryRemoveFailed(
        rootPath.toString(),
        new Error("workspace directory path contains a NUL byte"),
      );
    }
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err: unknown) {
      throw WorkspaceInfrastructureError.directoryRemoveFailed(
        rootPath.toString(),
        err,
      );
    }
  }

  public async ensureGitignore(
    rootPath: WorkspacePath,
    mode: WorkspaceMode,
  ): Promise<void> {
    const gitignorePath = NodeWorkspaceFilesystem.gitignoreFilePath(rootPath);
    let content: string | null = null;
    try {
      content = await fs.readFile(gitignorePath, "utf8");
    } catch (err: unknown) {
      if (!NodeWorkspaceFilesystem.isEnoent(err)) {
        throw WorkspaceInfrastructureError.gitignoreUpdateFailed(
          rootPath.toString(),
          err,
        );
      }
    }

    if (mode.isPrivate()) {
      const expected = NodeWorkspaceFilesystem.withGitignoreEntry(content);
      if (expected === content) return; // already consistent
      try {
        await fs.writeFile(gitignorePath, expected, "utf8");
      } catch (err: unknown) {
        throw WorkspaceInfrastructureError.gitignoreUpdateFailed(
          rootPath.toString(),
          err,
        );
      }
      return;
    }

    // shared / encrypted: ensure the entry is absent. Skip writing
    // when the file does not exist.
    if (content === null) return;
    const without = NodeWorkspaceFilesystem.withoutGitignoreEntry(content);
    if (without === content) return;
    try {
      if (without.length === 0) {
        // Avoid leaving a lingering empty `.gitignore` we created
        // earlier; remove it.
        await fs.unlink(gitignorePath);
      } else {
        await fs.writeFile(gitignorePath, without, "utf8");
      }
    } catch (err: unknown) {
      throw WorkspaceInfrastructureError.gitignoreUpdateFailed(
        rootPath.toString(),
        err,
      );
    }
  }

  // ── helpers ───────────────────────────────────────────────────────

  private static workspaceDirPath(rootPath: WorkspacePath): string {
    const joined = rootPath.join(WORKSPACE_DIRECTORY_NAME).toString();
    return path.resolve(joined);
  }

  private static configFilePath(rootPath: WorkspacePath): string {
    const joined = rootPath
      .join(WORKSPACE_DIRECTORY_NAME)
      .join(CONFIG_FILE_NAME)
      .toString();
    return path.resolve(joined);
  }

  private static gitignoreFilePath(rootPath: WorkspacePath): string {
    const joined = rootPath.join(GITIGNORE_FILE_NAME).toString();
    return path.resolve(joined);
  }

  /**
   * Returns true iff `candidate` ends with the canonical
   * `.mcp-memoria` segment (with or without a trailing path
   * separator). Cross-platform: matches both POSIX (`/foo/.mcp-memoria`)
   * and Windows (`C:\foo\.mcp-memoria`) shapes.
   *
   * Used as the path-canonicalisation guard for
   * `removeWorkspaceDirectory`.
   */
  private static endsWithWorkspaceSegment(candidate: string): boolean {
    const stripped =
      candidate.endsWith("/") || candidate.endsWith("\\")
        ? candidate.slice(0, -1)
        : candidate;
    if (stripped.endsWith(`/${WORKSPACE_DIRECTORY_NAME}`)) return true;
    if (stripped.endsWith(`\\${WORKSPACE_DIRECTORY_NAME}`)) return true;
    return false;
  }

  private static isEnoent(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const candidate = err as { readonly code?: unknown };
    return candidate.code === "ENOENT";
  }

  private static fromRaw(raw: RawConfig): PersistedWorkspaceConfig {
    return {
      schemaVersion: raw.schema_version,
      workspaceId: raw.workspace_id,
      displayName: raw.display_name,
      mode: raw.mode,
      createdAtMs: raw.created_at_ms,
      embedder: {
        provider: raw.embedder.provider,
        model: raw.embedder.model,
        dim: raw.embedder.dim,
      },
    };
  }

  private static withGitignoreEntry(existing: string | null): string {
    if (existing === null) {
      return `${GITIGNORE_LINE}${os.EOL}`;
    }
    const normalised = existing.endsWith("\n") ? existing : `${existing}\n`;
    if (NodeWorkspaceFilesystem.containsEntry(normalised)) {
      return normalised;
    }
    return `${normalised}${GITIGNORE_LINE}\n`;
  }

  private static withoutGitignoreEntry(existing: string): string {
    const lines = existing.split(/\r?\n/);
    const filtered: string[] = [];
    for (const line of lines) {
      if (line.trim() === GITIGNORE_LINE) continue;
      if (line.trim() === WORKSPACE_DIRECTORY_NAME) continue;
      filtered.push(line);
    }
    // Re-join, preserving the original trailing newline policy when
    // possible.
    return filtered.join("\n");
  }

  private static containsEntry(content: string): boolean {
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === GITIGNORE_LINE) return true;
      if (trimmed === WORKSPACE_DIRECTORY_NAME) return true;
    }
    return false;
  }
}
