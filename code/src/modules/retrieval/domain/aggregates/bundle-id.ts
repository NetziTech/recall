import {
  Id,
  type IdValue,
} from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for `ContextBundle` identifiers. Lives at the type level
 * only.
 */
export type BundleIdBrand = "bundle";

/**
 * Identifier of a `ContextBundle` aggregate.
 *
 * Bundles are ephemeral (they are not persisted), but they still need
 * a stable id within the lifetime of a process so the audit log and
 * the telemetry tracer can correlate the assembly events
 * (`ContextBundleAssembled`, `ContextLayerAdded`, `ContextBundleTruncated`)
 * with each other and with the originating tool call.
 *
 * The id is a UUID v7 (matching the rest of the codebase — see
 * `docs/02-protocolo-mcp.md` §1: "Identificadores: uuid v7"). The
 * `IdGenerator` port supplies the value at the application boundary;
 * the domain only consumes the validated VO.
 *
 * Inherits all UUID v7 invariants from `Id<BundleIdBrand>`.
 */
export class BundleId extends Id<BundleIdBrand> {
  public static from(raw: string): BundleId {
    const normalised = Id.normalize(raw, "bundle_id");
    return new BundleId(normalised as IdValue<BundleIdBrand>);
  }
}
