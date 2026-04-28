import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import * as path from "node:path";

import type {
  WorkspaceDetectionResult,
  WorkspaceDetector,
} from "../../domain/services/workspace-detector.ts";
import { WorkspacePath } from "../../domain/value-objects/workspace-path.ts";
import { WorkspaceInfrastructureError } from "../errors/workspace-infrastructure-error.ts";

/**
 * Sub-directory whose presence indicates a `.recall/` workspace.
 * The detector treats any directory that contains it as a positive
 * hit, even when sibling project markers (`.git/`, `package.json`)
 * are missing.
 */
const WORKSPACE_DIRECTORY_NAME = ".recall";

/**
 * Project markers that bound the upward walk. The detector stops
 * when one of these is found WITHOUT a sibling `.recall/`: if
 * we have crossed a project root and there is still no workspace,
 * the user is outside any initialised tree.
 *
 * Mirrors the heuristic in `docs/01-arquitectura.md` §4.
 */
const PROJECT_ROOT_MARKERS: readonly string[] = [
  ".git",
  ".hg",
  ".svn",
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
];

/**
 * Implements `WorkspaceDetector` by walking the filesystem upwards
 * from `rootPath` until either:
 *
 *   - a directory containing `.recall/config.json` is found
 *     (success: returns its path);
 *   - a project-root marker is found WITHOUT a workspace directory
 *     (failure: stops, returns "not found");
 *   - the filesystem root is reached (failure).
 *
 * The walk is bounded to a maximum depth of 64 hops — well above
 * any plausible project nesting and a defensive cap against the
 * theoretical possibility of a symlink loop. The cap is documented
 * here rather than configured per-call because going beyond it
 * always indicates a pathological filesystem state.
 *
 * Symlinks: the detector follows them (the `node:fs` calls do by
 * default). Symlink loops are caught by the depth cap.
 *
 * Errors: filesystem failures unrelated to "not found" (permission
 * denied, broken symlinks) propagate as
 * `WorkspaceInfrastructureError.detectionFailed`.
 */
export class MarkerBasedWorkspaceDetector implements WorkspaceDetector {
  private static readonly MAX_DEPTH = 64;

  public async detect(
    rootPath: WorkspacePath,
  ): Promise<WorkspaceDetectionResult> {
    let current = path.resolve(rootPath.toString());
    for (let depth = 0; depth < MarkerBasedWorkspaceDetector.MAX_DEPTH; depth += 1) {
      try {
        const hit = await this.checkDirectory(current);
        if (hit !== null) {
          return {
            exists: true,
            configPath: WorkspacePath.create(hit),
          };
        }
        if (await this.hasProjectMarker(current)) {
          // We are at a project root without a workspace; stop.
          return { exists: false, configPath: null };
        }
      } catch (err: unknown) {
        throw WorkspaceInfrastructureError.detectionFailed(
          rootPath.toString(),
          err,
        );
      }

      const parent = path.dirname(current);
      if (parent === current) {
        // Reached `/` (POSIX) or `C:\` (Windows). Nothing more above.
        return { exists: false, configPath: null };
      }
      current = parent;
    }
    return { exists: false, configPath: null };
  }

  /**
   * Returns the canonical workspace root (the directory that owns
   * the `.recall/` sub-directory) when `dir` contains a valid
   * workspace, `null` otherwise. The valid workspace check is
   * "directory exists and contains a regular `config.json` file" —
   * shape validation is the filesystem adapter's job.
   */
  private async checkDirectory(dir: string): Promise<string | null> {
    const workspaceDir = path.join(dir, WORKSPACE_DIRECTORY_NAME);
    let stat: Stats;
    try {
      stat = await fs.stat(workspaceDir);
    } catch (err: unknown) {
      if (MarkerBasedWorkspaceDetector.isEnoent(err)) return null;
      throw err;
    }
    if (!stat.isDirectory()) return null;

    const configPath = path.join(workspaceDir, "config.json");
    try {
      const configStat = await fs.stat(configPath);
      if (!configStat.isFile()) return null;
    } catch (err: unknown) {
      if (MarkerBasedWorkspaceDetector.isEnoent(err)) return null;
      throw err;
    }
    return dir;
  }

  /**
   * `true` iff `dir` contains any of the project-root markers. Used
   * to bound the upward walk: once we hit a `.git` or `package.json`
   * without a workspace, the caller is not inside an initialised
   * project tree.
   */
  private async hasProjectMarker(dir: string): Promise<boolean> {
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        await fs.access(path.join(dir, marker));
        return true;
      } catch (err: unknown) {
        if (MarkerBasedWorkspaceDetector.isEnoent(err)) continue;
        throw err;
      }
    }
    return false;
  }

  private static isEnoent(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const candidate = err as { readonly code?: unknown };
    return candidate.code === "ENOENT" || candidate.code === "ENOTDIR";
  }
}
