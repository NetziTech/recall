import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `SecretKindValue` values. Single source of truth for the
 * union below — adding a new kind is a one-line change here. Mirrors the
 * `as const` pattern used across the codebase (`WorkspaceModeKind`,
 * `DecisionStatusKind`, ...).
 *
 * The kinds reflect the canonical taxonomy documented in
 * `docs/11-seguridad-modos.md` §6 ("Capa 1 — Pre-write detection") plus
 * a generic fall-through bucket for entropy-only matches:
 *
 * - `api_key`: provider-specific API key (AWS access key, generic
 *   `[a-z_]*key[a-z_]*` patterns, ...).
 * - `oauth_token`: JWTs (`eyJ...`), GitHub bearer tokens (`ghp_`,
 *   `ghs_`), Bearer headers, etc.
 * - `private_key`: PEM-formatted private keys (`-----BEGIN ... PRIVATE
 *   KEY-----`).
 * - `password`: passwords embedded in URLs, `password=...` literals.
 * - `credential`: generic credential blobs that do not fit the other
 *   buckets (e.g. database connection strings carrying inline auth).
 * - `high_entropy_blob`: entropy-only match (Shannon > threshold). The
 *   detector cannot identify the *kind* of secret, only that the string
 *   is suspiciously dense; the docs flag this as warning-only because
 *   it is prone to false positives.
 */
const SECRET_KIND_VALUES = [
  "api_key",
  "oauth_token",
  "private_key",
  "password",
  "credential",
  "high_entropy_blob",
] as const;

export type SecretKindValue = (typeof SECRET_KIND_VALUES)[number];

/**
 * Value object representing the kind of secret a detector identified.
 *
 * The kind is the primary axis adapters use to decide the response
 * action: `private_key` and `oauth_token` always trigger a hard
 * rejection (`docs/11-seguridad-modos.md` §6 — "Accion: Rechaza"),
 * whereas `high_entropy_blob` only emits a warning. The aggregate
 * `SecretAuditEntry.action` carries the actual decision; the kind is the
 * input to that decision.
 *
 * Invariants:
 * - The wrapped `kind` is always one of the values in
 *   `SECRET_KIND_VALUES`. Anything else is rejected at the factory
 *   boundary.
 * - Instances are immutable: there is no scenario where an existing
 *   finding's kind should change in place.
 *
 * Equality:
 * - Two `SecretKind` instances are equal iff they share the same `kind`.
 */
export class SecretKind {
  private constructor(public readonly kind: SecretKindValue) {}

  /**
   * Builds a `SecretKind` from an arbitrary string. Used when reading
   * audit-log rows or decoding JSON-RPC payloads. Whitespace is
   * tolerated (trimmed) but case is significant: the canonical form is
   * lowercase to match the storage format.
   */
  public static create(raw: string): SecretKind {
    if (typeof raw !== "string") {
      throw new InvalidInputError("secret kind must be a string", {
        field: "kind",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("secret kind must not be empty", {
        field: "kind",
      });
    }
    if (!SecretKind.isKindValue(trimmed)) {
      throw new InvalidInputError(
        `secret kind must be one of ${SecretKind.knownKindsDescriptor()} (got: "${raw}")`,
        { field: "kind" },
      );
    }
    return new SecretKind(trimmed);
  }

  public static apiKey(): SecretKind {
    return new SecretKind("api_key");
  }

  public static oauthToken(): SecretKind {
    return new SecretKind("oauth_token");
  }

  public static privateKey(): SecretKind {
    return new SecretKind("private_key");
  }

  public static password(): SecretKind {
    return new SecretKind("password");
  }

  public static credential(): SecretKind {
    return new SecretKind("credential");
  }

  public static highEntropyBlob(): SecretKind {
    return new SecretKind("high_entropy_blob");
  }

  /**
   * Type guard exposed for callers that need to validate raw strings
   * without instantiating the VO.
   */
  public static isKindValue(candidate: string): candidate is SecretKindValue {
    for (const known of SECRET_KIND_VALUES) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * True for kinds that the docs (`docs/11-seguridad-modos.md` §6,
   * "Pre-write detection" table) flag as MUST-reject. Used by the
   * application layer to decide whether to short-circuit a `record_*`
   * call.
   *
   * The current rule: every kind except `high_entropy_blob` is a hard
   * rejection. `high_entropy_blob` is warning-only because the docs
   * acknowledge "muchos falsos positivos posibles".
   */
  public isHardReject(): boolean {
    return this.kind !== "high_entropy_blob";
  }

  public toString(): SecretKindValue {
    return this.kind;
  }

  public equals(other: SecretKind): boolean {
    return this.kind === other.kind;
  }

  /**
   * Builds the human-readable list of legal values for error messages.
   * Kept private and small to avoid duplicating the union literal in
   * multiple places.
   */
  private static knownKindsDescriptor(): string {
    const quoted: string[] = [];
    for (const value of SECRET_KIND_VALUES) {
      quoted.push(`"${value}"`);
    }
    return quoted.join(" | ");
  }
}
