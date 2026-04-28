import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { JsonRpcErrorCodes } from "../../../../shared/domain/errors/json-rpc-error-codes.ts";

/**
 * Lower bound (inclusive) of the JSON-RPC 2.0 server-error reserved
 * range, defined in §5.1 of the spec ("Reserved for implementation
 * defined server-errors. -32099 to -32000").
 *
 * Used to gate the standard server-error block.
 */
const STANDARD_SERVER_ERROR_MIN = -32099;
/**
 * Upper bound (inclusive) of the JSON-RPC 2.0 server-error reserved
 * range. The block goes from -32099 (lowest absolute number) up to
 * -32000 (highest, closest to zero).
 */
const STANDARD_SERVER_ERROR_MAX = -32000;

/**
 * Lower bound (inclusive) of the standard JSON-RPC 2.0 pre-defined
 * error block (§5.1: -32700 ParseError, -32600 InvalidRequest,
 * -32601 MethodNotFound, -32602 InvalidParams, -32603 InternalError).
 *
 * The bound is `-32700` (ParseError, the lowest absolute number).
 */
const STANDARD_PROTOCOL_ERROR_MIN = -32700;
/**
 * Upper bound (inclusive) of the standard pre-defined error block.
 */
const STANDARD_PROTOCOL_ERROR_MAX = -32600;

/**
 * Whitelist of MCP-Memoria custom codes documented in
 * `docs/02-protocolo-mcp.md` §6 (-32100..-32109). The set is built
 * once from the shared `JsonRpcErrorCodes` catalog so the two stay in
 * sync automatically: the day a new code is added to the catalog, the
 * VO accepts it without further edits here.
 */
const CUSTOM_CODES: ReadonlySet<number> = new Set<number>(
  Object.values(JsonRpcErrorCodes),
);

/**
 * Value object wrapping a JSON-RPC error code.
 *
 * The wrapper exists for two reasons:
 * 1. **Validation**: rejects integers that fall outside any allowed
 *    range. The accepted ranges are:
 *      - Standard JSON-RPC pre-defined errors: -32700..-32600.
 *      - Standard JSON-RPC server-error block: -32099..-32000.
 *      - MCP-Memoria custom codes: every value present in
 *        `JsonRpcErrorCodes` (currently -32100..-32109, see
 *        `docs/02-protocolo-mcp.md` §6).
 * 2. **Type-safety**: `JsonRpcErrorCode` (the wrapper) is not
 *    interchangeable with a plain `number`, so domain code can pass
 *    it around without accidentally mixing it with other numeric
 *    fields (HTTP status, exit codes, ...).
 *
 * Invariants:
 * - The wrapped value is a finite, integer number.
 * - The value belongs to one of the three accepted ranges above.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `JsonRpcErrorCode` are equal iff their wrapped numbers match.
 */
export class JsonRpcErrorCode {
  private constructor(public readonly value: number) {}

  /**
   * Builds a `JsonRpcErrorCode` from a raw number. Validates range
   * membership.
   */
  public static of(value: number): JsonRpcErrorCode {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("json-rpc error code must be a finite number", {
        field: "code",
      });
    }
    if (!Number.isInteger(value)) {
      throw new InvalidInputError("json-rpc error code must be an integer", {
        field: "code",
      });
    }
    if (!JsonRpcErrorCode.isAllowed(value)) {
      throw new InvalidInputError(
        `json-rpc error code ${String(value)} is outside the allowed ranges (-32700..-32600 standard, -32099..-32000 server, ${JsonRpcErrorCode.formatCustomCodes()} custom)`,
        { field: "code" },
      );
    }
    return new JsonRpcErrorCode(value);
  }

  /**
   * Type guard exposed for callers that want to validate raw numbers
   * without instantiating the VO.
   */
  public static isAllowed(value: number): boolean {
    if (!Number.isInteger(value)) return false;
    if (CUSTOM_CODES.has(value)) return true;
    if (
      value >= STANDARD_SERVER_ERROR_MIN &&
      value <= STANDARD_SERVER_ERROR_MAX
    ) {
      return true;
    }
    if (
      value >= STANDARD_PROTOCOL_ERROR_MIN &&
      value <= STANDARD_PROTOCOL_ERROR_MAX
    ) {
      return true;
    }
    return false;
  }

  /**
   * True iff this code belongs to the MCP-Memoria custom range
   * (`docs/02-protocolo-mcp.md` §6).
   */
  public isCustom(): boolean {
    return CUSTOM_CODES.has(this.value);
  }

  /**
   * True iff this code is one of the JSON-RPC 2.0 pre-defined errors
   * (-32700..-32600).
   */
  public isStandardProtocol(): boolean {
    return (
      this.value >= STANDARD_PROTOCOL_ERROR_MIN &&
      this.value <= STANDARD_PROTOCOL_ERROR_MAX
    );
  }

  /**
   * True iff this code is in the JSON-RPC 2.0 server-error block
   * (-32099..-32000).
   */
  public isStandardServerError(): boolean {
    return (
      this.value >= STANDARD_SERVER_ERROR_MIN &&
      this.value <= STANDARD_SERVER_ERROR_MAX
    );
  }

  public toNumber(): number {
    return this.value;
  }

  public equals(other: JsonRpcErrorCode): boolean {
    return this.value === other.value;
  }

  // -- internals -----------------------------------------------------------

  private static formatCustomCodes(): string {
    const sorted = Array.from(CUSTOM_CODES.values()).sort((a, b) => a - b);
    return sorted.map((code) => String(code)).join(", ");
  }
}
