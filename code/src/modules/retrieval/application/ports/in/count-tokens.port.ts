import type { Tokens } from "../../../../../shared/domain/value-objects/tokens.ts";

/**
 * Driving (input) port: count tokens for an arbitrary text.
 *
 * Thin façade over the domain `TokenCounter` driven port
 * (`retrieval/domain/services/token-counter.ts`). The split is
 * intentional:
 *
 * - **`TokenCounter` (out)** is the contract every adapter
 *   (tiktoken, fallback heuristic) implements. Lives in `domain/`
 *   because the recall pipeline consumes it directly.
 * - **`CountTokens` (in)** is the use-case input port that callers
 *   reach for when they only need the count and not the rest of the
 *   recall pipeline (e.g. the MCP server pre-validating the
 *   `max_tokens` of an incoming request, or the CLI's `mcp-memoria
 *   count` sub-command).
 *
 * Encoding contract (mirrors `docs/04-capas-contexto.md` §10):
 * - The tiktoken adapter uses the `cl100k_base` encoding (GPT-4 /
 *   Claude approximation). The fallback heuristic uses `chars / 4`
 *   when tiktoken is unavailable. Implementations document their
 *   choice; callers MUST treat the count as advisory but accurate
 *   enough for budget enforcement.
 */
export interface CountTokens {
  /**
   * Returns the token count for `text`.
   */
  count(text: string): Promise<Tokens>;
}
