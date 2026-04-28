import type { ToolRegistration } from "../aggregates/tool-registration.ts";
import type { ToolName } from "../value-objects/tool-name.ts";

/**
 * Driven port (output port) for the in-memory catalog of tools the
 * MCP server exposes.
 *
 * The registry sits between the JSON-RPC dispatcher (which receives
 * `tools/call` requests) and the per-tool handlers (which live in the
 * application layer): it answers "do you know this name?" and
 * "what's its bookkeeping?" without ever touching the handler
 * implementation.
 *
 * Modelling notes:
 * - The MVP keeps the registry entirely in memory. The composition
 *   root populates it at server boot by calling `register(...)` for
 *   every `ToolRegistration` it builds, and the in-memory state
 *   lives for the duration of the process. There is intentionally
 *   NO `delete(...)` method — the catalog is fixed at boot for the
 *   MVP. Future flows that hot-swap tools at runtime will add a
 *   sibling port (`MutableToolRegistry`) instead of widening this
 *   interface; ISP wins over reuse here
 *   (`docs/12-lineamientos-arquitectura.md` §1.4).
 * - There is also intentionally NO repository in this module. A
 *   repository implies persistence; the registry is purely
 *   in-process. If a future schema persists tool bookkeeping (e.g.
 *   for cross-process telemetry), it will live as a separate
 *   `ToolRegistrationRepository` interface in `domain/repositories/`.
 *
 * Contract:
 * - `register(...)` is idempotent on the *name*: calling it twice
 *   with the same `ToolName` is a programming error and the
 *   adapter MAY raise. The aggregate itself enforces single-source
 *   identity via `register(...)` factories, so duplicate-register is
 *   typically caught by the composition root before reaching the
 *   port.
 * - `findByName(name)` returns `null` (not a thrown error) when the
 *   tool is not registered. The application layer decides whether to
 *   surface that as `UnknownToolError` (typical) or to log-and-skip
 *   (rare, e.g. for optional handlers).
 * - `listAll()` returns the tools in *registration order* — the
 *   order in which `register(...)` was called. Adapters MUST NOT
 *   reorder; the composition root relies on this invariant when it
 *   builds the `tools/list` response (the order matters for clients
 *   that pin to the first match in a tie).
 */
export interface ToolRegistry {
  /**
   * Adds a new `ToolRegistration` to the catalog. Implementations
   * MAY raise if a registration with the same name already exists.
   */
  register(tool: ToolRegistration): void;

  /**
   * Looks up a registration by name. Returns `null` if not present.
   */
  findByName(name: ToolName): ToolRegistration | null;

  /**
   * Returns every registered tool in registration order.
   */
  listAll(): readonly ToolRegistration[];
}
