import type { ToolRegistration } from "../../domain/aggregates/tool-registration.ts";
import type { ToolRegistry } from "../../domain/services/tool-registry.ts";
import type { ToolName } from "../../domain/value-objects/tool-name.ts";

/**
 * In-memory adapter for the domain `ToolRegistry` port.
 *
 * The MVP keeps the registry entirely in-process: the composition
 * root populates it once at server boot and the contents do not
 * change for the duration of the run (cf
 * `modules/mcp-server/domain/services/tool-registry.ts` JSDoc). This
 * adapter is therefore a thin wrapper over a `Map` keyed by the
 * tool's wire string.
 *
 * Why a `Map<string, ToolRegistration>` and not
 * `Map<ToolName, ToolRegistration>`:
 * - JavaScript `Map`s use SameValueZero equality, which on object
 *   keys means *referential* equality. Two `ToolName` instances
 *   produced by separate `ToolName.create("mem.recall")` calls are
 *   value-equal (per the VO contract) but reference-unequal, so a
 *   `Map<ToolName, _>` would treat them as distinct keys and
 *   `findByName` would always return `null`. Keying on the wire
 *   string sidesteps the issue and matches how lookups happen on
 *   the wire (the JSON-RPC adapter receives a string, not a VO).
 *
 * Invariants honoured (per the port contract):
 * - `register(...)` is idempotent on the *name*. The adapter throws
 *   on a duplicate-register attempt because that is a programming
 *   error at the composition root — the registry is fixed at boot
 *   and re-registering the same name would silently shadow the
 *   first entry.
 * - `findByName(name)` returns `null` (not throws) for an unknown
 *   name. Translation to `UnknownToolError` is the application
 *   layer's job (it has the necessary context to decide whether
 *   "not found" is fatal).
 * - `listAll()` returns the registrations in *registration order* —
 *   the same order as the underlying `Map`'s insertion order, which
 *   ECMAScript guarantees per spec.
 *
 * Concurrency:
 * - Single-threaded by design. The MVP runs on Node 20 which is
 *   single-threaded for application code, and the registry is
 *   populated synchronously at boot. No locks required.
 */
export class StaticToolRegistry implements ToolRegistry {
  private readonly entries: Map<string, ToolRegistration>;

  public constructor() {
    this.entries = new Map<string, ToolRegistration>();
  }

  public register(tool: ToolRegistration): void {
    const key = tool.getName().toString();
    if (this.entries.has(key)) {
      // Composition-root programming error: the registry should be
      // populated exactly once per name at server boot. Throw plain
      // `Error` here is acceptable because this is a precondition
      // failure of the host program, not a domain or transport
      // failure.
      throw new Error(
        `static tool registry already contains a registration for "${key}"`,
      );
    }
    this.entries.set(key, tool);
  }

  public findByName(name: ToolName): ToolRegistration | null {
    return this.entries.get(name.toString()) ?? null;
  }

  public listAll(): readonly ToolRegistration[] {
    // Snapshot the values into a plain array. Returning the iterator
    // directly would expose the live registry to the caller, which
    // could mutate it indirectly (e.g. by holding a stale snapshot
    // across a future `register` that we want to reserve for the
    // composition root). Snapshotting is cheap (≤ a few entries in
    // the MVP) and keeps the contract clean.
    return Object.freeze(Array.from(this.entries.values()));
  }
}
