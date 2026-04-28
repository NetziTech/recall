import type {
  RecallInputWire,
  RecallOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driving (input) port for the `mem.recall` tool.
 *
 * Implements the wire contract documented in
 * `docs/02-protocolo-mcp.md` §4.3: hybrid lexical + semantic search
 * with optional filters. The protocol adapter calls this port after
 * Zod validation; the use case behind it forwards to the
 * `RecallMemoryFacade` output port and maps typed errors.
 *
 * Behaviour notes (from the spec):
 * - When `query` is omitted, the result set is sorted by `order_by`
 *   (default `recency`).
 * - When `query` is provided, hybrid scoring runs (BM25 + cosine +
 *   recency + usage + priority). Entries whose embeddings are not
 *   yet ready degrade to BM25 + recency, with `fallback_reason`
 *   surfacing the degradation.
 *
 * The protocol layer does NOT enforce these behaviours — they are
 * implemented downstream of the facade. This port simply commits to
 * the wire shape.
 */
export interface RecallMemory {
  recall(input: RecallInputWire): Promise<RecallOutputWire>;
}
