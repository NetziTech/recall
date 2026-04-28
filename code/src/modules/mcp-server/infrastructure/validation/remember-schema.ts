import { z } from "zod";

/**
 * Zod schema for `mem.remember` arguments.
 *
 * Mirrors `docs/02-protocolo-mcp.md` §4.4 verbatim, including the
 * per-`kind` extra fields. The schema does NOT branch on `kind` to
 * make different fields mandatory: the spec is intentionally lax
 * (the facade applies stronger per-kind validation when needed,
 * with secrets detection as the load-bearing check). Tightening
 * this schema beyond the spec would reject inputs the protocol
 * promises to accept.
 *
 * Two pieces of structural enforcement we DO apply at this tier:
 * 1. `kind` is mandatory and limited to the four wire literals
 *    (`decision`, `learning`, `entity`, `turn`). The recall-only
 *    `"any"` is rejected.
 * 2. `relations` (entity-only) requires its array entries to be
 *    `{ relation, target_name }` pairs with non-empty strings.
 *
 * The `id` slot is the upsert lever per the spec. We accept any
 * non-empty string here — the workspace/memory module decides
 * whether the value matches an existing entry's UUID v7 and the
 * protocol layer is the wrong place to bake in that domain rule.
 */
const EntityRelationSchema = z
  .object({
    relation: z.string().min(1),
    target_name: z.string().min(1),
  })
  .strict();

export const RememberInputSchema = z
  .object({
    workspace_id: z.string().min(1).optional(),
    kind: z.enum(["decision", "learning", "entity", "turn"]),
    content: z.string().min(1),
    id: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    scope: z.enum(["project", "module"]).optional(),
    module: z.string().min(1).optional(),

    // decision-specific
    title: z.string().min(1).optional(),
    rationale: z.string().min(1).optional(),
    alternatives_rejected: z.array(z.string().min(1)).optional(),
    superseded_by: z.string().min(1).optional(),

    // learning-specific
    trigger: z.string().min(1).optional(),
    severity: z.enum(["tip", "warning", "critical"]).optional(),

    // entity-specific
    name: z.string().min(1).optional(),
    entity_kind: z
      .enum(["struct", "module", "service", "agent", "file"])
      .optional(),
    location: z.string().min(1).optional(),
    relations: z.array(EntityRelationSchema).optional(),

    // turn-specific
    intent: z.string().min(1).optional(),
    outcome: z.string().min(1).optional(),
    files_touched: z.array(z.string().min(1)).optional(),
    decisions_made: z.array(z.string().min(1)).optional(),
    learnings_added: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type RememberInputZ = z.infer<typeof RememberInputSchema>;
