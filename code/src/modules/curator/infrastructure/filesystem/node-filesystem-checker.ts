import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { FilesystemChecker } from "../../application/ports/out/filesystem-checker.port.ts";
import type { PathChecker } from "../../domain/services/path-checker.ts";
import { PathStaleness } from "../../domain/value-objects/path-staleness.ts";
import { CuratorInfrastructureError } from "../errors/curator-infrastructure-error.ts";

/**
 * Adapter that fulfils both the application-layer `FilesystemChecker`
 * and the domain-layer `PathChecker` ports using Node's `fs.stat`.
 *
 * Why both interfaces:
 * - The domain port (`PathChecker` in `modules/curator/domain/services/`)
 *   exists so the curator's domain services can declare the contract
 *   they need without crossing the application boundary.
 * - The `FilesystemChecker` port (in `application/ports/out/`) makes
 *   the same contract visible from the application layer for
 *   composition-root convenience and the `.port.ts` convention sweep
 *   (`docs/12 §3.1`).
 * - This single adapter implements both so the composition root binds
 *   ONE instance to BOTH names.
 *
 * Path resolution rules (mirror `docs/05-memoria-decay.md` §5 Caso 1):
 * 1. Absolute paths (`startsWith("/")`) are used verbatim.
 * 2. Home-relative paths (`startsWith("~")`) are expanded against
 *    `os.homedir()`.
 * 3. Workspace-relative paths are joined with the canonicalised
 *    workspace root.
 *
 * Error handling:
 * - The adapter NEVER throws on a per-path failure: missing files map
 *   to `PathStaleness.missing(...)`, malformed paths map to
 *   `PathStaleness.unresolvable(...)`. The caller paired the
 *   resulting `PathStaleness` with the originating entity in
 *   `SelfHealUseCase`.
 * - The adapter MAY throw if the underlying `fs.stat` raises with an
 *   error other than `ENOENT` (e.g. permission denied for the entire
 *   scan); `CuratorInfrastructureError.scanFailed(...)` carries the
 *   workspace root and the original cause.
 *
 * Determinism: results are returned in the same order as the inputs;
 * a missing path is reported (not skipped) so the caller can pair
 * each result back to its originating entry without a lookup table.
 */
export class NodeFilesystemChecker implements FilesystemChecker, PathChecker {
  public constructor(
    private readonly workspaceRoot: string,
    private readonly logger: Logger,
  ) {}

  public async checkPaths(
    paths: readonly string[],
  ): Promise<readonly PathStaleness[]> {
    const out: PathStaleness[] = [];
    for (const original of paths) {
      const resolved = this.resolve(original);
      if (resolved === null) {
        // The adapter is the boundary that converts external (untrusted)
        // input into a domain VO. `PathStaleness` enforces a non-empty
        // `path` invariant, so we substitute a sentinel for empty/null
        // raw inputs. The original is preserved in the sentinel so the
        // caller can still distinguish "I asked about an empty path"
        // from "I asked about literally `<empty>`".
        const safeOriginal =
          typeof original === "string" && original.length > 0
            ? original
            : "<empty>";
        out.push(PathStaleness.unresolvable(safeOriginal));
        continue;
      }
      try {
        await fs.stat(resolved);
        out.push(PathStaleness.present(original));
      } catch (cause: unknown) {
        if (NodeFilesystemChecker.isMissingFileError(cause)) {
          out.push(PathStaleness.missing(original));
          continue;
        }
        // Permission denied / IO error: surface as a fatal scan error.
        this.logger.warn(
          {
            workspaceRoot: this.workspaceRoot,
            path: original,
            resolved,
            err: cause instanceof Error ? cause.message : String(cause),
          },
          "curator: filesystem probe failed unexpectedly; aborting path-stale pass",
        );
        throw CuratorInfrastructureError.scanFailed(this.workspaceRoot, cause);
      }
    }
    return Object.freeze(out);
  }

  /**
   * Resolves a raw location against the workspace's filesystem.
   * Returns `null` when the path is patently malformed (empty,
   * contains a NUL byte) — the curator surfaces these as
   * `unresolvable`.
   */
  private resolve(raw: string): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.includes("\0")) return null;

    if (path.isAbsolute(trimmed)) return trimmed;
    if (trimmed.startsWith("~")) {
      const home = os.homedir();
      // `~` alone or `~/relative` — the substring `trimmed.slice(1)`
      // captures the rest (or empty string for plain `~`).
      const tail = trimmed.slice(1);
      if (tail.length === 0) return home;
      // We accept `~/foo` and `~foo`; the latter is unusual but
      // legitimate when the location was authored in a shell that
      // does not require the slash. `path.join` collapses both.
      const lead = tail.startsWith("/") ? tail.slice(1) : tail;
      return path.join(home, lead);
    }
    return path.join(this.workspaceRoot, trimmed);
  }

  /**
   * Returns true when `cause` is a Node `fs.stat` error caused by a
   * missing entry (`ENOENT` / `ENOTDIR`).
   */
  private static isMissingFileError(cause: unknown): boolean {
    if (cause === null || typeof cause !== "object") return false;
    const code = (cause as { code?: unknown }).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}
