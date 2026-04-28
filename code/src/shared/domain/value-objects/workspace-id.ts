import { Id, type IdValue } from "./id.ts";

/**
 * Brand marker for workspace identifiers. Lives at the type level only.
 */
export type WorkspaceIdBrand = "workspace";

/**
 * Identifier of a workspace. A workspace is the top-level scope of
 * memory: every project on disk owns exactly one workspace, and every
 * persisted entry implicitly belongs to it (see
 * `docs/03-modelo-datos.md` §1).
 *
 * Invariants:
 * - Inherits all UUID v7 invariants from `Id<WorkspaceIdBrand>`.
 * - Cannot be confused with `DecisionId`, `LearningId`, etc., even
 *   though all are strings under the hood, because the brand lives in
 *   the type system.
 *
 * This subclass is intentionally thin: it exists so the rest of the
 * codebase can name the type clearly (`WorkspaceId`) and so the factory
 * pins the brand once.
 */
export class WorkspaceId extends Id<WorkspaceIdBrand> {
  /**
   * Builds a `WorkspaceId` from a raw string. Validates UUID v7 shape
   * via the inherited `normalize` helper.
   */
  public static from(raw: string): WorkspaceId {
    const normalised = Id.normalize(raw, "workspace_id");
    return new WorkspaceId(normalised as IdValue<WorkspaceIdBrand>);
  }
}
