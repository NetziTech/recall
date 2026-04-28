import type { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";

/**
 * Driven port (interface) for the token-counter component (tiktoken in
 * the default infrastructure, see `docs/06-stack-tecnico.md` §10 and
 * the policy in `docs/04-capas-contexto.md` §10:
 *   - tiktoken (cl100k_base) preferred,
 *   - heuristic `chars / 4` fallback).
 *
 * The retrieval domain consumes token counts to enforce per-layer caps
 * and the bundle-wide `max_tokens` budget; the *how* of the count is
 * an infrastructure concern. The port abstracts both backends behind
 * the same shape.
 *
 * Contracts:
 * - `count(text)` is synchronous. The default tiktoken adapter is
 *   trivially fast (a few µs per call); the fallback heuristic is
 *   constant-time. Callers in the recall hot path use this method.
 * - `countBatch(texts)` returns the per-text counts in the same order.
 *   Async because some adapters (Voyage tokenisation API) are remote;
 *   the local tiktoken adapter implements `countBatch` as a `for`
 *   loop and resolves immediately.
 * - The returned `Tokens` are exact (not over-estimated): the protocol
 *   promise is a hard cap, not a soft one
 *   (`docs/02-protocolo-mcp.md` §1).
 */
export interface TokenCounter {
  /**
   * Counts the tokens in `text`.
   */
  count(text: string): Tokens;

  /**
   * Counts the tokens in each text of a batch. The output array has
   * the same length and order as the input.
   */
  countBatch(texts: readonly string[]): Promise<readonly Tokens[]>;
}
