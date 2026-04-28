import type { Workspace } from "../../../domain/aggregates/workspace.ts";
import type { DisplayName } from "../../../domain/value-objects/display-name.ts";
import type { EmbedderSpec } from "../../../domain/value-objects/embedder-spec.ts";
import type { WorkspaceMode } from "../../../domain/value-objects/workspace-mode.ts";
import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";

/**
 * Driving (input) port for the `recall init` flow documented in
 * `docs/07-instalacion.md` §7 ("Inicializacion / modos") and
 * `docs/11-seguridad-modos.md` §§2-4 (per-mode bootstrap).
 *
 * Wires the side effects required to bring a fresh `.recall/`
 * directory into existence on disk:
 *
 *   1. Validate that no workspace already lives at `rootPath` (or that
 *      one does and the call is idempotent — see contract below).
 *   2. Create the `.recall/` directory tree.
 *   3. For `encrypted` mode, delegate to the
 *      `InitializeEncryptionFacade` output port to mint the master
 *      key + first envelope and persist them into the encryption
 *      slice of `config.json`.
 *   4. Persist the `WorkspaceConfig` slice of `config.json` with
 *      permissions `0o600`.
 *   5. Write the per-mode `.gitignore` semantics
 *      (`docs/11-seguridad-modos.md` §2 / §4).
 *   6. Return the freshly minted `Workspace` aggregate so the caller
 *      (CLI or `mem.init` MCP tool) can continue with the bootstrap
 *      printout (see §3 — "Por que solo por stdout y no por canal MCP").
 *
 * Idempotency:
 *   The use case is idempotent under repeated invocation with the
 *   SAME `rootPath` and SAME `mode`: it reloads the existing
 *   workspace and returns it with `wasCreated === false`. Conflicting
 *   inputs (e.g. existing workspace in `shared` mode but caller asked
 *   for `encrypted`) raise `WorkspaceAlreadyInitializedError` so the
 *   caller can pick between rehydrating or wiping.
 */
export interface InitializeWorkspaceInput {
  /** Absolute root of the host project. */
  readonly rootPath: WorkspacePath;
  /** Privacy mode requested for the bootstrap. */
  readonly mode: WorkspaceMode;
  /** Human-readable label for the workspace (`config.json → display_name`). */
  readonly displayName: DisplayName;
  /** Embedder spec the workspace pins (`config.json → embedder`). */
  readonly embedder: EmbedderSpec;
  /**
   * Passphrase to seed the encryption when `mode === "encrypted"`.
   * The use case ignores this field for any other mode (the field is
   * still required at the type level so callers cannot forget it for
   * encrypted bootstraps; pass an empty token when irrelevant).
   *
   * Modeled as `string` rather than the encryption module's
   * `Passphrase` VO so the workspace module stays decoupled from the
   * encryption module's domain types. The `InitializeEncryptionFacade`
   * adapter constructs the VO at the boundary.
   */
  readonly passphrase: string | null;
}

export interface InitializeWorkspaceOutput {
  /** Aggregate ready to be handed to subsequent use cases. */
  readonly workspace: Workspace;
  /**
   * `true` iff the use case actually created the directory tree and
   * its `config.json`. `false` when an existing workspace was
   * rehydrated.
   */
  readonly wasCreated: boolean;
}

export interface InitializeWorkspace {
  initialize(
    input: InitializeWorkspaceInput,
  ): Promise<InitializeWorkspaceOutput>;
}
