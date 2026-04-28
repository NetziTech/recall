import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Discriminated union representing the outcome of a tool invocation.
 *
 * - `success`: the handler ran to completion and produced a payload
 *   ready to ship in the JSON-RPC `result` envelope.
 * - `error`: the handler refused to run, or ran and failed in a
 *   business-meaningful way. Carries the JSON-RPC `code` + `message`
 *   pair (and the optional `data` slot) so the transport layer can
 *   serialize it directly.
 *
 * Why `payload` is `unknown` and `data` is `unknown`:
 * - The domain knows there is *some* payload but not its shape; each
 *   tool's output schema lives next to its handler in the
 *   application layer. The `unknown` is intentional and keeps the
 *   registry agnostic of every individual tool.
 *
 * Invariants:
 * - In the `error` variant, `code` is a finite integer and `message`
 *   is non-empty (the JSON-RPC spec forbids both an absent code and
 *   an empty message in §5.1).
 * - The `data` slot is OPTIONAL — when omitted, callers should not
 *   serialize an empty `data` field (`undefined` is dropped by the
 *   adapter).
 *
 * Equality:
 * - Conservative reference equality on the wrapped payload/data,
 *   following the same rule as `ToolArgs`. Two error results with the
 *   same `code` and `message` but different `data` references are
 *   considered distinct.
 */
export type ToolResultValue =
  | { readonly kind: "success"; readonly payload: unknown }
  | {
      readonly kind: "error";
      readonly code: number;
      readonly message: string;
      readonly data: unknown;
    };

export class ToolResult {
  private constructor(
    public readonly kind: "success" | "error",
    private readonly payload: unknown,
    private readonly errorCode: number | null,
    private readonly errorMessage: string | null,
    private readonly errorData: unknown,
    private readonly hasData: boolean,
  ) {}

  /**
   * Builds a successful result around a handler-produced payload. The
   * payload is `unknown` because the domain has no schema for it; the
   * application layer hands it over verbatim and the transport layer
   * serializes it.
   */
  public static success(payload: unknown): ToolResult {
    return new ToolResult("success", payload, null, null, undefined, false);
  }

  /**
   * Builds an error result. Validates the JSON-RPC `code`+`message`
   * invariants at the boundary so adapters never have to wonder
   * whether a `null`/empty pair would slip through.
   */
  public static error(input: {
    code: number;
    message: string;
    data?: unknown;
  }): ToolResult {
    if (!Number.isFinite(input.code) || !Number.isInteger(input.code)) {
      throw new InvalidInputError(
        "tool result error code must be a finite integer",
        { field: "code" },
      );
    }
    if (typeof input.message !== "string") {
      throw new InvalidInputError("tool result error message must be a string", {
        field: "message",
      });
    }
    const trimmed = input.message.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError(
        "tool result error message must contain at least one non-whitespace character",
        { field: "message" },
      );
    }
    return new ToolResult(
      "error",
      undefined,
      input.code,
      trimmed,
      input.data,
      input.data !== undefined,
    );
  }

  public isSuccess(): boolean {
    return this.kind === "success";
  }

  public isError(): boolean {
    return this.kind === "error";
  }

  /**
   * Returns the discriminated-union view. Pattern-match this in
   * adapters; do NOT poke at the class internals.
   */
  public toValue(): ToolResultValue {
    if (this.kind === "success") {
      return { kind: "success", payload: this.payload };
    }
    if (this.errorCode === null || this.errorMessage === null) {
      // Unreachable under the constructor invariants; the explicit
      // throw keeps the function total without a non-null assertion.
      throw new InvalidInputError(
        "tool result internal state is inconsistent (error variant missing code or message)",
        { field: "tool_result" },
      );
    }
    return {
      kind: "error",
      code: this.errorCode,
      message: this.errorMessage,
      data: this.hasData ? this.errorData : undefined,
    };
  }

  public equals(other: ToolResult): boolean {
    if (this === other) return true;
    if (this.kind !== other.kind) return false;
    if (this.kind === "success") {
      return this.payload === other.payload;
    }
    if (this.errorCode !== other.errorCode) return false;
    if (this.errorMessage !== other.errorMessage) return false;
    if (this.hasData !== other.hasData) return false;
    return this.errorData === other.errorData;
  }
}
