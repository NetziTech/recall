import { z } from "zod";

/**
 * Zod schema for `mem.context` arguments.
 *
 * Mirrors `docs/02-protocolo-mcp.md` §4.2 verbatim. Wire literals
 * are used (`system_identity`, `project_constitution`, `code_map`,
 * ...), NOT the retrieval module's domain-flavoured names. The
 * `GetContextFacade` adapter wired in the composition root
 * translates between the two.
 *
 * Token defaults are NOT applied here — the use case forwards the
 * raw input to the facade, and the facade defaults `max_tokens` to
 * 4800 if absent (per the spec). Pushing defaults into the schema
 * would obscure "client did not send" vs "client sent the default
 * value" in audit logs.
 */
const LayerNameSchema = z.enum([
  "system_identity",
  "project_constitution",
  "active_tasks",
  "recent_turns",
  "relevant_memory",
  "code_map",
  "open_questions",
]);

export const ContextInputSchema = z
  .object({
    workspace_id: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    max_tokens: z.number().int().positive().optional(),
    layer_overrides: z
      .record(LayerNameSchema, z.number().int().nonnegative())
      .optional(),
    include_layers: z.array(LayerNameSchema).nonempty().optional(),
    exclude_layers: z.array(LayerNameSchema).nonempty().optional(),
  })
  .strict();

export type ContextInputZ = z.infer<typeof ContextInputSchema>;
