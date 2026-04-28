import { z } from "zod";

/**
 * Zod schema for `mem.init` arguments — the wire payload validated
 * before reaching `InitWorkspaceUseCase`.
 *
 * Mirrors `docs/02-protocolo-mcp.md` §4.1 verbatim.
 *
 * Notes on `.strict()`:
 * - The schema rejects any unknown property. The MCP spec is
 *   versioned; a future client that sends a v0.5 field to a v0.4
 *   server should fail loud with `-32602 INVALID_PARAMS` so the
 *   operator can upgrade, not silently drop the field.
 *
 * Notes on `metadata`:
 * - `Record<string, unknown>` is permissive on purpose. The protocol
 *   says "libre: { language: 'rust', phase: '1' }" — the server has
 *   no business inspecting it. Downstream the workspace module may
 *   apply its own constraints; if it does, those errors flow back
 *   as domain errors, not as Zod issues.
 */
export const InitInputSchema = z
  .object({
    workspace_path: z.string().min(1).optional(),
    mode: z.enum(["shared", "encrypted", "private"]).optional(),
    display_name: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type InitInputZ = z.infer<typeof InitInputSchema>;
