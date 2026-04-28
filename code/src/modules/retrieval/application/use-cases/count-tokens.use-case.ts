import type { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { TokenCounter } from "../../domain/services/token-counter.ts";
import type { CountTokens } from "../ports/in/count-tokens.port.ts";

/**
 * Use case: count tokens for an arbitrary text.
 *
 * Thin pass-through over the domain `TokenCounter` adapter. The split
 * exists so the application layer can grow concerns later (per-
 * workspace encoding overrides loaded from `.mcp-memoria/config.json`,
 * caching of the most-recent N counts) without rippling through the
 * input-port consumers.
 *
 * Why a class (not a free function):
 * - The composition root injects the `TokenCounter` adapter exactly
 *   once at server start-up. A function would force every caller to
 *   plumb the adapter argument.
 *
 * Why the result is awaited even though the underlying
 * `TokenCounter.count(...)` is sync:
 * - Some adapters (Voyage tokenisation API) are remote. The input
 *   port is `async` so callers do not have to switch shape if the
 *   composition root swaps adapters.
 */
export class CountTokensUseCase implements CountTokens {
  public constructor(private readonly counter: TokenCounter) {}

  public count(text: string): Promise<Tokens> {
    return Promise.resolve(this.counter.count(text));
  }
}
