import type { WorkspacePath } from "../value-objects/workspace-path.ts";

/**
 * Result of inspecting a candidate root path for an existing
 * `.mcp-memoria/` workspace.
 *
 * - `exists` is `true` iff the adapter found a `config.json` it could
 *   read. The contents are NOT validated here — that is the
 *   `WorkspaceRepository`'s job once the path is known.
 * - `configPath`, when present, points to the directory that contains
 *   `config.json` (typically `<root>/.mcp-memoria/`). Adapters that do
 *   the upward walk described in `docs/01-arquitectura.md` §4 should
 *   return the directory they actually found, which may sit several
 *   levels above `rootPath`.
 *
 * The shape is a discriminated union: when `exists` is `false`,
 * `configPath` is forced to `null` so callers cannot accidentally
 * dereference a stale path.
 */
export type WorkspaceDetectionResult =
  | { readonly exists: true; readonly configPath: WorkspacePath }
  | { readonly exists: false; readonly configPath: null };

/**
 * Driven port (output port) responsible for telling the application
 * layer whether a host-project directory already hosts a workspace.
 *
 * The reference algorithm is in `docs/01-arquitectura.md` §4: walk
 * upwards from `cwd` searching for a `.mcp-memoria/` directory or for a
 * known project marker (`.git/`, `package.json`, ...). The adapter
 * encapsulates that filesystem walk; the domain only consumes the
 * result.
 *
 * Contract:
 * - `detect` is a *pure observation* of the filesystem. It MUST NOT
 *   create files, mutate `.gitignore`, or perform any side effect.
 *   Initialization is a separate use case driven by the application
 *   layer once the user has explicitly opted in.
 * - The adapter returns absolute paths (the input is already a
 *   `WorkspacePath`, which is itself absolute by construction).
 * - I/O failures (permission denied, broken symlinks) are NOT
 *   represented in `WorkspaceDetectionResult`. They are reported as
 *   thrown errors so the application layer can decide whether to
 *   retry, surface to the user, or treat as "not found". The contract
 *   for those errors lives in the adapter's documentation.
 */
export interface WorkspaceDetector {
  detect(rootPath: WorkspacePath): Promise<WorkspaceDetectionResult>;
}
