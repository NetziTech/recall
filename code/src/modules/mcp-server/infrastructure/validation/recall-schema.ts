import { z } from "zod";

/**
 * Zod schema for `mem.recall` arguments.
 *
 * Mirrors `docs/02-protocolo-mcp.md` §4.3 verbatim. The schema does
 * NOT apply the documented defaults (`top_k = 8`, `max_tokens =
 * 2000`, `order_by = "relevance" if query else "recency"`,
 * `include_superseded = false`) — those are facade-level concerns
 * and applying them at the boundary would obscure the difference
 * between "absent" and "explicitly default".
 *
 * The `kinds` filter accepts `"any"` as a wildcard that the facade
 * treats as "no filter" (`docs/02 §4.3`). The remember/track
 * schemas reject `"any"` explicitly because it's only meaningful in
 * recall.
 */
export const RecallInputSchema = z
  .object({
    workspace_id: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    kinds: z
      .array(
        z.enum(["decision", "learning", "turn", "entity", "task", "any"]),
      )
      .nonempty()
      .optional(),
    top_k: z.number().int().positive().optional(),
    max_tokens: z.number().int().positive().optional(),
    order_by: z.enum(["relevance", "recency", "score", "usage"]).optional(),
    since_ms: z.number().int().nonnegative().optional(),
    must_have_tags: z.array(z.string().min(1)).optional(),
    must_not_have_tags: z.array(z.string().min(1)).optional(),
    scope: z.enum(["project", "module"]).optional(),
    module: z.string().min(1).optional(),
    include_superseded: z.boolean().optional(),
  })
  .strict();

export type RecallInputZ = z.infer<typeof RecallInputSchema>;
