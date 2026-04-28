import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { InvalidRequestIdError } from "../errors/invalid-request-id-error.ts";

/**
 * Discriminated union of the legal payload shapes for a JSON-RPC 2.0
 * request id.
 *
 * Per the JSON-RPC 2.0 specification §4 ("An identifier established by
 * the Client that MUST contain a String, Number, or NULL value"):
 * - A `string` form is preferred by most modern clients (uuid, ulid,
 *   slug).
 * - A `number` form is allowed; the spec recommends NOT using
 *   fractional parts.
 * - A `NULL` value is reserved for *notifications* (which never
 *   correlate to a response) and is therefore NOT a valid id from the
 *   server's perspective when matching requests to responses; we model
 *   that exclusion at the factory boundary instead of carrying a third
 *   variant.
 *
 * Modelling decision (rationale):
 * - We keep the union explicit (`{kind: "string", value: string} |
 *   {kind: "number", value: number}`) instead of collapsing to a
 *   serialized string. Collapsing would force adapters to remember the
 *   original shape so the response echoes the *exact* same id
 *   (string-vs-number must round-trip per JSON-RPC §4.1). The
 *   discriminated union preserves that information directly in the
 *   domain and makes pattern-matching at the transport layer
 *   exhaustive.
 *
 * Invariants:
 * - When `kind === "string"`, `value` is non-empty (we trim leading
 *   and trailing whitespace; an all-whitespace id is rejected).
 * - When `kind === "number"`, `value` is a finite, integer-valued
 *   number (the spec allows fractions but recommends against them and
 *   no real-world client we target uses them; rejecting them avoids a
 *   class of equality bugs around `0.1 + 0.2 !== 0.3`).
 * - Instances are immutable.
 */
export type RequestIdValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number };

/**
 * Value object representing a JSON-RPC 2.0 request identifier.
 *
 * Used by the MCP server domain to:
 * - Correlate `tool-call` lifecycle events to the originating request.
 * - Echo the id verbatim in the response envelope (same kind and same
 *   value the client sent), as required by JSON-RPC 2.0 §5.
 *
 * The class wraps the discriminated union so the rest of the domain
 * works with a single type, and so `equals(other)` enforces both the
 * kind and the value match (a string `"42"` and a number `42` are NOT
 * equal — they would round-trip differently on the wire).
 */
export class RequestId {
  private constructor(
    public readonly kind: "string" | "number",
    public readonly value: string | number,
  ) {}

  /**
   * Builds a `RequestId` from a raw value. Accepts the two shapes
   * permitted by JSON-RPC 2.0 §4 (string and integer number) and
   * rejects everything else with `InvalidRequestIdError` so adapters
   * can map directly onto the wire-level `INVALID_REQUEST` (-32600).
   */
  public static from(raw: unknown): RequestId {
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        throw new InvalidRequestIdError(
          "request id (string) must contain at least one non-whitespace character",
        );
      }
      return new RequestId("string", trimmed);
    }
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) {
        throw new InvalidRequestIdError(
          "request id (number) must be a finite value",
        );
      }
      if (!Number.isInteger(raw)) {
        throw new InvalidRequestIdError(
          "request id (number) must be an integer (fractional ids are not supported)",
        );
      }
      return new RequestId("number", raw);
    }
    throw new InvalidRequestIdError(
      "request id must be a string or an integer number",
    );
  }

  /**
   * Strongly-typed factory for the string variant. Useful when the
   * caller already knows the shape and wants to skip the `from`
   * dispatch.
   */
  public static ofString(value: string): RequestId {
    if (typeof value !== "string") {
      throw new InvalidInputError("request id must be a string", {
        field: "request_id",
      });
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new InvalidRequestIdError(
        "request id (string) must contain at least one non-whitespace character",
      );
    }
    return new RequestId("string", trimmed);
  }

  /**
   * Strongly-typed factory for the integer variant.
   */
  public static ofNumber(value: number): RequestId {
    if (typeof value !== "number") {
      throw new InvalidInputError("request id must be a number", {
        field: "request_id",
      });
    }
    if (!Number.isFinite(value)) {
      throw new InvalidRequestIdError(
        "request id (number) must be a finite value",
      );
    }
    if (!Number.isInteger(value)) {
      throw new InvalidRequestIdError(
        "request id (number) must be an integer (fractional ids are not supported)",
      );
    }
    return new RequestId("number", value);
  }

  public isString(): boolean {
    return this.kind === "string";
  }

  public isNumber(): boolean {
    return this.kind === "number";
  }

  /**
   * Returns the discriminated-union view. Useful for adapters that need
   * to pattern-match without poking at the class internals.
   */
  public toValue(): RequestIdValue {
    if (this.kind === "string" && typeof this.value === "string") {
      return { kind: "string", value: this.value };
    }
    if (this.kind === "number" && typeof this.value === "number") {
      return { kind: "number", value: this.value };
    }
    // Unreachable under the constructor invariants; the explicit throw
    // keeps the function total without resorting to a non-null
    // assertion.
    throw new InvalidRequestIdError(
      "request id internal state is inconsistent",
    );
  }

  /**
   * Renders the id as a string for logging and for use as a map key.
   * Number ids are stringified with their canonical decimal form.
   * Adapters that need the original wire shape MUST use `toValue()`
   * instead so they preserve the type.
   */
  public toString(): string {
    if (typeof this.value === "string") return this.value;
    return String(this.value);
  }

  public equals(other: RequestId): boolean {
    if (this === other) return true;
    if (this.kind !== other.kind) return false;
    return this.value === other.value;
  }
}
