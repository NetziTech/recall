import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `PathStalenessKindKind` values. Single source of truth.
 *
 * Mirrors the three states the path checker can report after probing
 * an `Entity.location` against the workspace's filesystem (per
 * `docs/05-memoria-decay.md` §5 Caso 1):
 *
 * - `present`: the path resolved successfully and the file/dir
 *   exists. No remediation needed.
 * - `missing`: the path resolved but the target no longer exists. The
 *   curator marks the owning entry as `stale` (confidence /= 2, tag
 *   "stale").
 * - `unresolvable`: the path could not even be resolved (malformed,
 *   pointing outside the workspace, ...). The curator surfaces this
 *   as a higher-severity finding because the issue is structural.
 */
const PATH_STALENESS_KINDS = ["present", "missing", "unresolvable"] as const;

export type PathStalenessKindKind = (typeof PATH_STALENESS_KINDS)[number];

/**
 * Value object pairing a probed path with the result of the probe.
 *
 * Returned by the `PathChecker` driven port; consumed by the curator
 * application layer when running the Caso 1 self-healing pass.
 *
 * Invariants:
 * - `path` is the original (workspace-relative or absolute) string
 *   the caller asked about. Stored verbatim so the application layer
 *   can pair the result back to the originating entry.
 * - `kind` is one of the three known states.
 * - Instances are immutable.
 */
export class PathStaleness {
  private constructor(
    public readonly path: string,
    public readonly kind: PathStalenessKindKind,
  ) {}

  public static present(path: string): PathStaleness {
    return new PathStaleness(PathStaleness.normalize(path), "present");
  }

  public static missing(path: string): PathStaleness {
    return new PathStaleness(PathStaleness.normalize(path), "missing");
  }

  public static unresolvable(path: string): PathStaleness {
    return new PathStaleness(PathStaleness.normalize(path), "unresolvable");
  }

  public static isKind(candidate: string): candidate is PathStalenessKindKind {
    for (const known of PATH_STALENESS_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public isPresent(): boolean {
    return this.kind === "present";
  }

  public isMissing(): boolean {
    return this.kind === "missing";
  }

  public isUnresolvable(): boolean {
    return this.kind === "unresolvable";
  }

  /**
   * True iff the entry owning this path needs remediation (anything
   * other than `present`).
   */
  public requiresAttention(): boolean {
    return this.kind !== "present";
  }

  public equals(other: PathStaleness): boolean {
    if (this === other) return true;
    return this.path === other.path && this.kind === other.kind;
  }

  // -- internals ----------------------------------------------------------

  private static normalize(path: string): string {
    if (typeof path !== "string") {
      throw new InvalidInputError("path must be a string", {
        field: "path",
      });
    }
    if (path.length === 0) {
      throw new InvalidInputError("path must not be empty", {
        field: "path",
      });
    }
    return path;
  }
}
