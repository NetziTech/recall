import { InvalidProtocolVersionError } from "../errors/invalid-protocol-version-error.ts";

/**
 * Pattern matching the canonical `MAJOR.MINOR.PATCH` semver shape used
 * by the MCP protocol version field.
 *
 * The MCP transport (stdio JSON-RPC) advertises its protocol version
 * during the `initialize` handshake. Mirroring the same semver shape
 * already used by `WorkspaceConfig.schemaVersion` keeps every
 * version-like string in the codebase consistent.
 */
const PROTOCOL_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * Value object representing a Model Context Protocol version negotiated
 * during the `initialize` handshake (or pinned by client metadata).
 *
 * Why model it as a VO instead of a raw string:
 * - The handshake compares versions with `equals` and (eventually) with
 *   `isCompatibleWith`. Centralising the semver parse / compare in a
 *   single class prevents skew between callers.
 * - The factory rejects anything that is not `MAJOR.MINOR.PATCH`,
 *   stopping malformed versions at the domain boundary.
 *
 * Invariants:
 * - `major`, `minor`, `patch` are non-negative finite integers.
 * - `toString()` round-trips the original wire format
 *   (`"<major>.<minor>.<patch>"`).
 *
 * Equality:
 * - Two `ProtocolVersion` instances are equal iff every component
 *   matches. Pre-release tags are NOT supported on purpose; the MCP
 *   stable releases use plain semver.
 */
export class ProtocolVersion {
  private constructor(
    public readonly major: number,
    public readonly minor: number,
    public readonly patch: number,
  ) {}

  /**
   * Builds a `ProtocolVersion` from a raw string. Whitespace is
   * tolerated (trimmed). The factory raises
   * `InvalidProtocolVersionError` so adapters can map directly onto a
   * JSON-RPC error.
   */
  public static create(raw: string): ProtocolVersion {
    if (typeof raw !== "string") {
      throw new InvalidProtocolVersionError(
        "protocol version must be a string",
      );
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidProtocolVersionError(
        "protocol version must not be empty",
      );
    }
    if (!PROTOCOL_VERSION_PATTERN.test(trimmed)) {
      throw new InvalidProtocolVersionError(
        `protocol version must match MAJOR.MINOR.PATCH (got: "${raw}")`,
      );
    }
    const parts = trimmed.split(".");
    if (parts.length !== 3) {
      // Defensive: the regex already enforces three parts, but keeping
      // the explicit check here makes the parse total without resorting
      // to non-null assertions.
      throw new InvalidProtocolVersionError(
        `protocol version must have exactly three components (got: "${raw}")`,
      );
    }
    const major = ProtocolVersion.parseComponent(parts[0], "major", raw);
    const minor = ProtocolVersion.parseComponent(parts[1], "minor", raw);
    const patch = ProtocolVersion.parseComponent(parts[2], "patch", raw);
    return new ProtocolVersion(major, minor, patch);
  }

  /**
   * Strongly-typed factory for callers that already have the parsed
   * components (used by tests and by repositories that keep the
   * components split). Validates non-negative integers.
   */
  public static of(major: number, minor: number, patch: number): ProtocolVersion {
    ProtocolVersion.assertComponent(major, "major");
    ProtocolVersion.assertComponent(minor, "minor");
    ProtocolVersion.assertComponent(patch, "patch");
    return new ProtocolVersion(major, minor, patch);
  }

  public toString(): string {
    return `${String(this.major)}.${String(this.minor)}.${String(this.patch)}`;
  }

  public equals(other: ProtocolVersion): boolean {
    return (
      this.major === other.major &&
      this.minor === other.minor &&
      this.patch === other.patch
    );
  }

  // -- internals -----------------------------------------------------------

  private static parseComponent(
    candidate: string | undefined,
    label: string,
    raw: string,
  ): number {
    if (candidate === undefined) {
      throw new InvalidProtocolVersionError(
        `protocol version is missing the ${label} component (got: "${raw}")`,
      );
    }
    const parsed = Number.parseInt(candidate, 10);
    ProtocolVersion.assertComponent(parsed, label);
    return parsed;
  }

  private static assertComponent(value: number, label: string): void {
    if (!Number.isFinite(value)) {
      throw new InvalidProtocolVersionError(
        `protocol version ${label} component must be a finite number`,
      );
    }
    if (!Number.isInteger(value)) {
      throw new InvalidProtocolVersionError(
        `protocol version ${label} component must be an integer`,
      );
    }
    if (value < 0) {
      throw new InvalidProtocolVersionError(
        `protocol version ${label} component must be non-negative`,
      );
    }
  }
}
