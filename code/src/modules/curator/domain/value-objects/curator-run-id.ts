import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for curator-run identifiers. Lives at the type level only.
 */
export type CuratorRunIdBrand = "curator-run";

/**
 * Identifier of a `CuratorRun` aggregate.
 *
 * Mirrors the `curator_runs.id TEXT PRIMARY KEY` column documented in
 * `docs/03-modelo-datos.md` §4.11. Inherits UUID v7 invariants from
 * `Id<CuratorRunIdBrand>`; the brand pins the type so the compiler
 * refuses to mix it with `WorkspaceId`, `DecisionId`, etc.
 */
export class CuratorRunId extends Id<CuratorRunIdBrand> {
  public static from(raw: string): CuratorRunId {
    const normalised = Id.normalize(raw, "curator_run_id");
    return new CuratorRunId(normalised as IdValue<CuratorRunIdBrand>);
  }
}
