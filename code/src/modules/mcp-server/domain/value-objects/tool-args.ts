/**
 * Value object that wraps the raw arguments payload of a JSON-RPC tool
 * call.
 *
 * Why `unknown` and not a typed shape:
 * - The MCP server domain knows *that* arguments exist for every tool
 *   invocation, but not *what* they look like — every tool has its own
 *   schema (defined with Zod) that lives in the `application/`
 *   handlers. Pulling those schemas into `domain/` would invert the
 *   dependency rule (domain must not import infrastructure libs like
 *   Zod) and would also force a recompile of the registry every time a
 *   handler tweaks its input shape.
 * - The contract is therefore "give the application layer the bytes
 *   verbatim, and let *its* validator turn them into a typed DTO". The
 *   `unknown` here is intentional and load-bearing: it forbids any
 *   property access in `domain/` and pushes validation to the layer
 *   that owns it.
 *
 * Invariants:
 * - The wrapped value is whatever the JSON parser produced from the
 *   request `params.arguments`. The domain does not normalise it.
 * - Instances are immutable (the wrapper itself is frozen at
 *   construction; the wrapped value is *not* deep-frozen because the
 *   domain never inspects its shape and an arbitrary deep-freeze pass
 *   would be both expensive and beyond the contract).
 *
 * Equality:
 * - We provide a deliberately conservative `equals(other)` based on
 *   referential equality of the wrapped value: the domain has no way
 *   to compare two `unknown`s structurally without making assumptions
 *   about their shape. Equality is therefore meaningful only for the
 *   case where the same parsed payload is shared between two
 *   `ToolArgs` instances (typical when the same call is logged twice).
 */
export class ToolArgs {
  private constructor(private readonly value: unknown) {}

  /**
   * Wraps a raw payload. Accepts `unknown` and *intentionally* does no
   * validation — the parsing/typing happens in the application layer
   * with Zod schemas owned by each handler.
   */
  public static from(raw: unknown): ToolArgs {
    return new ToolArgs(raw);
  }

  /**
   * Convenience factory for the empty-arguments case (some tools, e.g.
   * `mem.health` with no flags, accept `{}` as their payload). The
   * domain models this explicitly so callers don't have to spell
   * `ToolArgs.from({})`.
   */
  public static empty(): ToolArgs {
    return new ToolArgs({});
  }

  /**
   * Returns the wrapped payload as `unknown`. Callers in the
   * application layer MUST validate it against their schema before
   * accessing any property.
   */
  public raw(): unknown {
    return this.value;
  }

  /**
   * Conservative equality: true iff the wrapped values are the exact
   * same reference. Structural equality would require knowing the
   * shape, which the domain deliberately does not.
   */
  public equals(other: ToolArgs): boolean {
    if (this === other) return true;
    return this.value === other.value;
  }
}
