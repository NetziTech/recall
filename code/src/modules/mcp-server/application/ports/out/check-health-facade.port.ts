import type {
  HealthInputWire,
  HealthOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driven (output) port: protocol-facing facade over the diagnostic
 * snapshot of a workspace.
 *
 * The composition root binds this facade to a multi-source aggregator:
 * - Workspace module: `workspace_id`, `workspace_path`, `mode`,
 *   `encryption_status`.
 * - Memory module: `total_entries`, `entries_by_kind`,
 *   `active_session`.
 * - Curator module: `last_curator_run`.
 * - Retrieval / shared infra: `embedding_model`,
 *   `embedding_queue_pending`, `fts_health`, `vector_index_health`,
 *   `size_bytes`.
 *
 * The protocol layer does NOT know about any of those modules — the
 * facade is the single output port and the composition root
 * orchestrates the underlying calls.
 *
 * Read-only by contract: the facade MUST NOT mutate any persistent
 * state. The wired adapter may run lightweight integrity checks (FTS
 * sanity, vector index probe) but those are read paths.
 */
export interface CheckHealthFacade {
  health(input: HealthInputWire): Promise<HealthOutputWire>;
}
