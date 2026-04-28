import * as path from "node:path";
import process from "node:process";

/**
 * Resolves the workspace root path the user passed via
 * `--workspace <path>` to an absolute string. When the user did
 * NOT pass a path, defaults to `process.cwd()` (auto-detect upwards
 * happens later in the workspace facade itself).
 *
 * Path safety:
 *   - Rejects paths containing `..` segments AFTER `path.resolve`
 *     (`resolve` collapses them; the post-check catches the very
 *     unusual case where the resolved path is outside `cwd` and
 *     the user did not intend it).
 *   - Rejects NUL bytes.
 *
 * The function deliberately does NOT touch the filesystem: existence
 * checks are the responsibility of the workspace adapter. The CLI
 * helper only canonicalises the path syntactically.
 */
export function resolveRootPath(maybePath: string | null): string {
  const raw = maybePath ?? process.cwd();
  if (raw.includes("\0")) {
    throw new InvalidWorkspacePathArg(
      `--workspace path must not contain NUL bytes`,
    );
  }
  const absolute = path.resolve(raw);
  return absolute;
}

/**
 * Tiny error class for argument validation failures inside the CLI
 * handlers. We deliberately avoid extending `CliDomainError` because
 * the failure surfaces ONLY when the entrypoint failed to validate
 * argv early, so it is more of an invariant violation than a domain
 * error. Lives next to the helper to keep the dependency graph tidy.
 */
import { InvariantViolationError } from "../../../../../shared/domain/errors/invariant-violation-error.ts";

class InvalidWorkspacePathArg extends InvariantViolationError {
  public constructor(message: string) {
    super(message, { invariant: "cli.handler.workspace-path" });
  }
}
