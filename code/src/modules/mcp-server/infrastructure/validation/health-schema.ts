import { z } from "zod";

/**
 * Zod schema for `mem.health` arguments.
 *
 * Mirrors `docs/02-protocolo-mcp.md` §4.6 verbatim. The schema is
 * intentionally tiny: `mem.health` is a diagnostic call, not a
 * mutating one, so its argument surface is narrow.
 */
export const HealthInputSchema = z
  .object({
    workspace_id: z.string().min(1).optional(),
    verbose: z.boolean().optional(),
  })
  .strict();

export type HealthInputZ = z.infer<typeof HealthInputSchema>;
