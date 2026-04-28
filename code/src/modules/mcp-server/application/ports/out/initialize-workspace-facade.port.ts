import type {
  InitInputWire,
  InitOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driven (output) port: protocol-facing facade over the workspace
 * module's `mem.init` use case.
 *
 * Why this port lives here (and not as an import of the workspace
 * module):
 * - The strict modularity rule (`docs/12-lineamientos-arquitectura.md`
 *   §1.5 Regla 2) forbids `mcp-server` from importing types from
 *   `modules/workspace/`. The composition root wires this facade to
 *   the workspace use case (`InitializeWorkspaceUseCase` or its
 *   eventual public input port), translating between the wire DTOs
 *   defined here and the workspace value objects there.
 * - Keeping the facade here means the `mcp-server` module stays
 *   self-contained: every external dependency is an interface this
 *   module owns.
 *
 * Contract:
 * - Idempotent: calling `init` on an existing workspace returns the
 *   stored metadata with `is_new: false` (cf §4.1 spec text).
 * - Failures are propagated as typed domain errors. The most common
 *   business failure is "encrypted workspace, key not in HOME"
 *   which surfaces as a domain error mapped by the protocol layer
 *   to wire code `-32107 ENCRYPTED_LOCKED`.
 *
 * Why the facade speaks wire DTOs (not domain objects):
 * - The translation between wire and domain happens once, at the
 *   composition root. The mcp-server adapter never sees workspace
 *   value objects; the workspace module's adapter never sees JSON
 *   wire shapes. Both modules stay pure.
 */
export interface InitializeWorkspaceFacade {
  initialize(input: InitInputWire): Promise<InitOutputWire>;
}
