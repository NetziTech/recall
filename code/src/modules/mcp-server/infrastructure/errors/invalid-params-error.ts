import { McpServerInfrastructureError } from "./mcp-server-infrastructure-error.ts";

/**
 * Standard JSON-RPC 2.0 code for "Invalid params" (§5.1).
 */
const INVALID_PARAMS = -32602;

/**
 * Raised when the request envelope is well-formed but the `params`
 * payload fails Zod validation against the tool's input schema.
 *
 * The `details` slot carries the structured Zod issues so the
 * client can pinpoint each failing field. The transport layer
 * serialises them under `error.data` per JSON-RPC 2.0 §5.1.
 *
 * Invariants:
 * - `code` is the stable identifier `mcp-server.invalid-params`.
 * - `jsonRpcCode` is the JSON-RPC 2.0 standard `-32602`.
 * - `details` is a frozen, defensively-copied array.
 */
export interface InvalidParamsIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly code: string;
}

export class InvalidParamsError extends McpServerInfrastructureError {
  public readonly code = "mcp-server.invalid-params";
  public override readonly jsonRpcCode: number = INVALID_PARAMS;
  public readonly details: readonly InvalidParamsIssue[];

  public constructor(
    message: string,
    options: { details: readonly InvalidParamsIssue[] },
    cause?: unknown,
  ) {
    super(message, cause);
    // Defensive copy + freeze: the consumer (the JSON serialiser)
    // must not be able to mutate the issue list after construction.
    this.details = Object.freeze(options.details.slice());
  }
}
