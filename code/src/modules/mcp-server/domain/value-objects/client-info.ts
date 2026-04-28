import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import type { ProtocolVersion } from "./protocol-version.ts";

/**
 * Maximum number of characters allowed in a client name. Prevents a
 * misbehaving client from polluting audit logs with megabyte-long
 * banners.
 */
const CLIENT_NAME_MAX_LENGTH = 200;

/**
 * Maximum number of capability strings a client may advertise.
 * Capabilities are coarse-grained tags (`"sampling"`, `"prompts"`,
 * `"resources"`, ...) so the cap is generous; it exists to bound
 * memory usage of the registry, not to fence in legitimate clients.
 */
const CLIENT_CAPABILITIES_MAX_COUNT = 64;

/**
 * Maximum length of an individual capability string.
 */
const CAPABILITY_MAX_LENGTH = 128;

/**
 * Value object representing the metadata block a client advertises
 * during the `initialize` handshake of the Model Context Protocol.
 *
 * The MCP wire shape carries (at minimum) the client `name`, the
 * `version` it speaks of the protocol, and an optional `capabilities`
 * list. The domain captures those three slots with strong types so
 * the rest of the server can reason about the connection without
 * re-parsing JSON.
 *
 * Invariants:
 * - `name` is a `NonEmptyString` capped at
 *   `CLIENT_NAME_MAX_LENGTH` characters and free of newline characters
 *   (audit logs and CLI banners want a single line).
 * - `protocolVersion` is a validated `ProtocolVersion` (semver shape).
 * - `capabilities` is a frozen, deduplicated list of `NonEmptyString`s,
 *   each at most `CAPABILITY_MAX_LENGTH` characters and stripped of
 *   surrounding whitespace. Order is preserved as the client sent it
 *   so subscribers that care about precedence (rare, but possible)
 *   can rely on the original ranking.
 *
 * Equality:
 * - Two `ClientInfo` instances are equal iff `name`, `protocolVersion`
 *   and the full capability list (same order, same values) match.
 */
export class ClientInfo {
  private constructor(
    public readonly name: ClientName,
    public readonly protocolVersion: ProtocolVersion,
    public readonly capabilities: readonly string[],
  ) {}

  /**
   * Builds a `ClientInfo` from already-parsed value objects plus the
   * raw capabilities list. The raw list is normalised here so callers
   * can hand over whatever the JSON parser produced without first
   * trimming and deduplicating.
   */
  public static create(input: {
    name: ClientName;
    protocolVersion: ProtocolVersion;
    capabilities?: readonly string[];
  }): ClientInfo {
    const capabilities = ClientInfo.normaliseCapabilities(
      input.capabilities ?? [],
    );
    return new ClientInfo(input.name, input.protocolVersion, capabilities);
  }

  public hasCapability(capability: string): boolean {
    if (typeof capability !== "string") return false;
    const trimmed = capability.trim();
    if (trimmed.length === 0) return false;
    for (const cap of this.capabilities) {
      if (cap === trimmed) return true;
    }
    return false;
  }

  public equals(other: ClientInfo): boolean {
    if (this === other) return true;
    if (!this.name.equals(other.name)) return false;
    if (!this.protocolVersion.equals(other.protocolVersion)) return false;
    if (this.capabilities.length !== other.capabilities.length) return false;
    for (let i = 0; i < this.capabilities.length; i += 1) {
      if (this.capabilities[i] !== other.capabilities[i]) return false;
    }
    return true;
  }

  // -- internals -----------------------------------------------------------

  private static normaliseCapabilities(
    raw: readonly string[],
  ): readonly string[] {
    if (raw.length > CLIENT_CAPABILITIES_MAX_COUNT) {
      throw new InvalidInputError(
        `client capabilities must have at most ${String(CLIENT_CAPABILITIES_MAX_COUNT)} entries (got: ${String(raw.length)})`,
        { field: "capabilities" },
      );
    }
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const candidate of raw) {
      if (typeof candidate !== "string") {
        throw new InvalidInputError(
          "every client capability must be a string",
          { field: "capabilities" },
        );
      }
      const trimmed = candidate.trim();
      if (trimmed.length === 0) {
        throw new InvalidInputError(
          "client capabilities must contain at least one non-whitespace character",
          { field: "capabilities" },
        );
      }
      if (trimmed.length > CAPABILITY_MAX_LENGTH) {
        throw new InvalidInputError(
          `client capability must be at most ${String(CAPABILITY_MAX_LENGTH)} characters (got: ${String(trimmed.length)})`,
          { field: "capabilities" },
        );
      }
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      cleaned.push(trimmed);
    }
    return Object.freeze(cleaned);
  }
}

/**
 * Value object for the human-readable name a client advertises during
 * the `initialize` handshake.
 *
 * Modelled as a sibling subclass of `NonEmptyString` (rather than as a
 * plain string field of `ClientInfo`) so the equality contract picks
 * up the per-subclass narrowing inherited from `NonEmptyString`: a
 * `ClientName` is never equal to a `DisplayName` even when their
 * trimmed text is identical.
 *
 * Invariants:
 * - `NonEmptyString` invariants apply (trimmed, non-empty).
 * - At most `CLIENT_NAME_MAX_LENGTH` characters.
 * - No `\n` or `\r` (single-line context).
 */
export class ClientName extends NonEmptyString {
  private constructor(value: string) {
    super(value);
  }

  public static override create(raw: string): ClientName {
    if (typeof raw !== "string") {
      throw new InvalidInputError("client name must be a string", {
        field: "client_name",
      });
    }
    if (raw.includes("\n") || raw.includes("\r")) {
      throw new InvalidInputError("client name must not contain line breaks", {
        field: "client_name",
      });
    }
    const trimmed = NonEmptyString.normalize(raw, "client_name");
    if (trimmed.length > CLIENT_NAME_MAX_LENGTH) {
      throw new InvalidInputError(
        `client name must be at most ${String(CLIENT_NAME_MAX_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "client_name" },
      );
    }
    return new ClientName(trimmed);
  }

  /** Exposes the configured maximum length for documentation/tests. */
  public static maxLength(): number {
    return CLIENT_NAME_MAX_LENGTH;
  }
}
