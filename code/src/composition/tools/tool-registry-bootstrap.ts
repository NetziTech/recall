/**
 * Registers the six MVP tools (`docs/02-protocolo-mcp.md` §2) on the
 * `StaticToolRegistry`.
 *
 * Naming and descriptions are pinned to the Spanish + English text the
 * spec uses so `tools/list` returns a stable surface across releases.
 *
 * Idempotency:
 *   The registry rejects duplicate registrations. The bootstrap
 *   entrypoint MUST call this function exactly once at server start.
 */

import type { Clock } from "../../shared/application/ports/clock.port.ts";
import { ToolRegistration } from "../../modules/mcp-server/domain/aggregates/tool-registration.ts";
import { ToolDescription } from "../../modules/mcp-server/domain/value-objects/tool-description.ts";
import { ToolName } from "../../modules/mcp-server/domain/value-objects/tool-name.ts";
import type { StaticToolRegistry } from "../../modules/mcp-server/infrastructure/registry/static-tool-registry.ts";

/**
 * Per-tool description. Mirrors the wire spec's table verbatim so a
 * `tools/list` response renders the same sentence the docs publish.
 */
const TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  "mem.init":
    "Initialise or rehydrate the workspace at the given path. Creates `.mcp-memoria/` when absent.",
  "mem.context":
    "Assemble the seven-layer context bundle for the active session, optionally narrowed by a query.",
  "mem.recall":
    "Hybrid recall over the workspace's persistent memory (BM25 + cosine + recency + usage + priority).",
  "mem.remember":
    "Persist a new memory entry (decision, learning, entity, turn) and queue an embedding pass.",
  "mem.task":
    "Manage workspace tasks (create / update / list / get / delete).",
  "mem.health":
    "Diagnostic snapshot of the workspace (mode, encryption, FTS, vectors, embedder, queue depth).",
});

/**
 * Registers the six MVP tools on `registry`. The `clock` is used to
 * stamp the registration timestamp on each `ToolRegistration`
 * aggregate.
 */
export function registerMvpTools(input: {
  readonly registry: StaticToolRegistry;
  readonly clock: Clock;
}): void {
  const occurredAt = input.clock.now();

  for (const kind of [
    "mem.init",
    "mem.context",
    "mem.recall",
    "mem.remember",
    "mem.task",
    "mem.health",
  ] as const) {
    const description = TOOL_DESCRIPTIONS[kind];
    if (description === undefined) {
      // Catch-all defence: every entry of `ToolNameKind` should have
      // a description; missing one is a programming error caught at
      // boot. Throw plain `Error` because this is a precondition
      // failure of the host program, not a domain or transport
      // failure.
      throw new Error(`missing description for tool "${kind}"`);
    }
    const registration = ToolRegistration.register({
      name: ToolName.create(kind),
      description: ToolDescription.create(description),
      occurredAt,
    });
    input.registry.register(registration);
  }
}
