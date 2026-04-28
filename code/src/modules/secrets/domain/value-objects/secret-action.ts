import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `SecretActionKind` values. Single source of truth for
 * the union below — adding a new action is a one-line change here and
 * exhaustive `switch` blocks immediately surface the gap.
 *
 * The actions reflect the three terminal states a finding can land in
 * after the application layer reacts to it (`docs/11-seguridad-modos.md`
 * §6 — "Capa 1 — Pre-write detection" lists "Rechaza" and "Warning +
 * log" as the two documented behaviours; the domain adds an explicit
 * `redacted` state for the post-hoc sanitisation flow):
 *
 * - `blocked`: the input was rejected outright; the calling tool got a
 *   `-32105 SECRET_DETECTED` response. Pairs with `SecretBlocked`.
 * - `redacted`: the input was rewritten to replace the secret with a
 *   placeholder; the surrounding payload continued downstream. Pairs
 *   with `SecretRedacted`.
 * - `warned_user`: the scanner only emitted a warning (typical for
 *   `high_entropy_blob`); the input flowed through unchanged. No
 *   payload-mutating event accompanies the audit row.
 */
const SECRET_ACTION_KINDS = ["blocked", "redacted", "warned_user"] as const;

export type SecretActionKind = (typeof SECRET_ACTION_KINDS)[number];

/**
 * Discriminated union representing the action the application layer
 * took in response to a finding.
 *
 * The shape is uniform (`{kind}`) because no action carries
 * variant-specific payload today; modelling it as a DU keeps the door
 * open for future actions that need extra fields (e.g. a `quarantined`
 * action carrying the quarantine bucket name) without a breaking
 * refactor of consumers.
 */
export type SecretAction =
  | { readonly kind: "blocked" }
  | { readonly kind: "redacted" }
  | { readonly kind: "warned_user" };

/**
 * Factory namespace for `SecretAction` values.
 *
 * Mirrors the `SecretSources` pattern: the discriminated union is
 * exposed as a `type` for destructuring, and this namespace centralises
 * construction so every call-site builds a well-formed action.
 */
export const SecretActions = {
  blocked(): SecretAction {
    return Object.freeze({ kind: "blocked" });
  },

  redacted(): SecretAction {
    return Object.freeze({ kind: "redacted" });
  },

  warnedUser(): SecretAction {
    return Object.freeze({ kind: "warned_user" });
  },

  /**
   * Builds a `SecretAction` from a raw kind string. Used when reading
   * audit-log rows or decoding JSON-RPC payloads.
   */
  fromKind(raw: string): SecretAction {
    if (typeof raw !== "string") {
      throw new InvalidInputError("secret action must be a string", {
        field: "action",
      });
    }
    const trimmed = raw.trim();
    switch (trimmed) {
      case "blocked":
        return SecretActions.blocked();
      case "redacted":
        return SecretActions.redacted();
      case "warned_user":
        return SecretActions.warnedUser();
      default:
        throw new InvalidInputError(
          `secret action must be one of "blocked" | "redacted" | "warned_user" (got: "${raw}")`,
          { field: "action" },
        );
    }
  },

  /**
   * Type guard exposed for callers that need to validate raw strings
   * without instantiating the action.
   */
  isKind(candidate: string): candidate is SecretActionKind {
    for (const known of SECRET_ACTION_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  },

  /**
   * Value-based equality across the discriminated variants. Returns
   * `true` iff the two actions share the same `kind`.
   */
  equals(left: SecretAction, right: SecretAction): boolean {
    return left.kind === right.kind;
  },
} as const;
