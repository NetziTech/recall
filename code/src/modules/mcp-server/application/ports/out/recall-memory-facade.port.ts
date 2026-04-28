import type {
  RecallInputWire,
  RecallOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driven (output) port: protocol-facing facade over the retrieval
 * module's `mem.recall` use case.
 *
 * The composition root binds this facade to the retrieval module's
 * hybrid scorer + ranker. The adapter is responsible for hybrid
 * scoring (BM25 + cosine + recency + usage + priority) and for
 * surfacing the `fallback_reason` field when scoring degrades to
 * BM25-only because some entries lack embeddings.
 *
 * Wire shape note:
 * - `MemoryEntryWire.metadata` is `Readonly<Record<string,
 *   unknown>>` because the schema of metadata varies per kind and
 *   per-entry (`docs/03-modelo-datos.md`). The adapter is expected
 *   to populate it with the canonical projection per kind; the
 *   protocol layer does not enforce a stricter shape because the
 *   client is allowed to ignore it.
 */
export interface RecallMemoryFacade {
  recall(input: RecallInputWire): Promise<RecallOutputWire>;
}
