import { z } from "zod";

/**
 * Zod schema for `mem.task` arguments.
 *
 * Mirrors `docs/02-protocolo-mcp.md` §4.5 verbatim. The action
 * discriminator is mandatory; per-action required fields are NOT
 * enforced here — the facade dispatcher catches missing fields
 * with typed domain errors that map back to wire codes. Tightening
 * this schema across actions would force all five branches into one
 * `z.discriminatedUnion`, which buys little since each branch is a
 * superset of optional fields anyway.
 *
 * Two structural rules we DO apply:
 * 1. `priority` (only meaningful at create time) is a closed enum.
 * 2. `filter` (only meaningful at list time) accepts the `"any"`
 *    wildcard for `status` (matching `docs/02 §4.5`).
 */
const TaskListFilterSchema = z
  .object({
    status: z
      .enum(["pending", "in_progress", "done", "blocked", "any"])
      .optional(),
    tags: z.array(z.string().min(1)).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export const TaskInputSchema = z
  .object({
    workspace_id: z.string().min(1).optional(),
    action: z.enum(["create", "update", "list", "get", "delete"]),

    // create
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    blocked_by: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),

    // update / get / delete
    task_id: z.string().min(1).optional(),
    status: z.enum(["pending", "in_progress", "done", "blocked"]).optional(),
    notes: z.string().min(1).optional(),

    // list
    filter: TaskListFilterSchema.optional(),
  })
  .strict();

export type TaskInputZ = z.infer<typeof TaskInputSchema>;
