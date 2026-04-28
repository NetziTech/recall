import type {
  HealthInputWire,
  HealthOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driving (input) port for the `mem.health` tool.
 *
 * Implements the wire contract documented in
 * `docs/02-protocolo-mcp.md` §4.6: returns the diagnostic snapshot
 * of the workspace (mode, encryption status, entry counts, embedding
 * queue, FTS / vector index health, warnings). The protocol adapter
 * calls this port after Zod validation; the use case behind it
 * forwards to the `CheckHealthFacade` output port.
 *
 * The use case is intentionally read-only: it never mutates state
 * and never emits domain events.
 */
export interface CheckHealth {
  health(input: HealthInputWire): Promise<HealthOutputWire>;
}
