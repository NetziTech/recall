import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { InvalidModeTransitionError } from "../errors/invalid-mode-transition-error.ts";
import { WorkspaceAlreadyInitializedError } from "../errors/workspace-already-initialized-error.ts";
import { WorkspaceLockedError } from "../errors/workspace-locked-error.ts";
import { WorkspaceInitialized } from "../events/workspace-initialized.ts";
import { WorkspaceLocked } from "../events/workspace-locked.ts";
import { WorkspaceModeChanged } from "../events/workspace-mode-changed.ts";
import { WorkspaceUnlocked } from "../events/workspace-unlocked.ts";
import type { WorkspaceConfig } from "../value-objects/workspace-config.ts";
import type { WorkspaceMode } from "../value-objects/workspace-mode.ts";
import { InvariantViolationError } from "../../../../shared/domain/errors/invariant-violation-error.ts";

/**
 * Encapsulates the matrix of legal mode transitions in one place. The
 * design is intentionally conservative: every cell is either explicitly
 * allowed or forbidden, and the aggregate refuses anything not listed
 * here.
 *
 * The cells follow the table in `docs/11-seguridad-modos.md` §5
 * ("Cambios de modo") with one project-level extra restriction:
 *
 * - `encrypted -> shared` is NOT allowed directly. The docs list a
 *   warning row for that transition, but the operational risk is high
 *   (the git history would suddenly stop being encrypted with no
 *   intermediate commit the user agreed to). The conservative two-step
 *   protocol forces the operator to first move to `private`, then to
 *   `shared` — making the intent explicit and giving the chance to
 *   intervene between steps. This is documented as a deliberate domain
 *   decision in `InvalidModeTransitionError`.
 *
 * Self-transitions (e.g. `shared -> shared`) are rejected by the
 * aggregate before the table is consulted: there is no event to emit
 * and no work to do.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    shared: Object.freeze(["encrypted", "private"]),
    encrypted: Object.freeze(["private"]),
    private: Object.freeze(["shared", "encrypted"]),
  });

/**
 * Aggregate root for the `workspace` bounded context.
 *
 * A `Workspace` is the in-memory projection of one
 * `.mcp-memoria/config.json` (plus the runtime-only `unlocked` flag for
 * encrypted modes). It owns:
 *
 * - The workspace identity (`WorkspaceId`).
 * - The persistent configuration (`WorkspaceConfig`).
 * - The unlock state (`unlocked: boolean`), which is meaningful only
 *   when `config.mode.requiresKey()` is true.
 *
 * It enforces:
 *
 * - The mode-transition state machine
 *   (see `docs/11-seguridad-modos.md` §5).
 * - The "operations on encrypted workspaces require an unlock"
 *   invariant (see `docs/11-seguridad-modos.md` §3 and §8 — JSON-RPC
 *   `-32107 ENCRYPTED_LOCKED`).
 * - Idempotent emission of domain events: every successful mutation
 *   appends a single event to the internal buffer; the application
 *   layer drains them with `pullEvents()` after persistence.
 *
 * Invariants:
 * - Identity is immutable: `getId()` is stable for the entire lifetime.
 * - `unlocked === true` implies `config.mode.requiresKey() === true`.
 *   The aggregate refuses to set `unlocked` on non-encrypted modes.
 * - When the mode transitions away from `encrypted`, `unlocked` is
 *   reset to `false` (it is meaningless outside the encrypted mode).
 */
export class Workspace {
  private readonly id: WorkspaceId;
  private config: WorkspaceConfig;
  private unlocked: boolean;
  private readonly events: DomainEvent[];

  private constructor(
    id: WorkspaceId,
    config: WorkspaceConfig,
    unlocked: boolean,
    events: readonly DomainEvent[],
  ) {
    this.id = id;
    this.config = config;
    this.unlocked = unlocked;
    // Defensive copy: the constructor accepts a `readonly` view but
    // owns a mutable buffer internally so `pullEvents()` can drain it.
    // Copying here prevents external aliasing when a caller (test or
    // factory) later mutates the array they passed in.
    this.events = [...events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new `Workspace` into existence. Use this exactly
   * once per workspace, when the application layer has decided the
   * `.mcp-memoria/` directory does NOT exist yet on disk.
   *
   * Emits `WorkspaceInitialized`. The aggregate starts locked (in the
   * sense that `unlocked === false`); for `encrypted` mode the very
   * next step is typically a programmatic `unlock(...)` once the
   * caller has the freshly generated key in hand.
   */
  public static initialize(input: {
    config: WorkspaceConfig;
    occurredAt: Timestamp;
  }): Workspace {
    const events: DomainEvent[] = [
      new WorkspaceInitialized({
        workspaceId: input.config.workspaceId,
        mode: input.config.mode,
        occurredAt: input.occurredAt,
      }),
    ];
    return new Workspace(
      input.config.workspaceId,
      input.config,
      false,
      events,
    );
  }

  /**
   * Rehydrates a `Workspace` from previously-persisted state. Used by
   * the repository when reading `config.json`. Does NOT emit any event
   * (no business fact is happening: we are just observing existing
   * data).
   *
   * The aggregate starts in a locked state regardless of mode: the
   * application layer is responsible for calling `unlock(...)` if it
   * has the key cached in HOME (for encrypted workspaces).
   */
  public static rehydrate(config: WorkspaceConfig): Workspace {
    return new Workspace(config.workspaceId, config, false, []);
  }

  /**
   * Always throws `WorkspaceAlreadyInitializedError` carrying this
   * aggregate's id.
   *
   * This is NOT a conditional assert — the name is deliberate: the
   * caller has already detected (typically via `repository.findById`)
   * that a workspace exists at the target path, and the use case is
   * about to refuse a re-initialization request. Calling this method
   * spells out that semantic at the call site instead of having the
   * application layer instantiate the error directly.
   *
   * Equivalent to writing
   * `throw new WorkspaceAlreadyInitializedError(workspace.getId())`,
   * but kept as a method so the aggregate owns the policy ("how is
   * a re-initialization rejected?") rather than scattering that
   * decision across use cases.
   */
  public rejectReinitialization(): never {
    throw new WorkspaceAlreadyInitializedError(this.id);
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Transitions the workspace to a new privacy mode, after validating
   * the move against `ALLOWED_TRANSITIONS`.
   *
   * Special handling:
   * - Self-transitions are rejected as an invariant violation (the
   *   caller must not invent change events for no reason).
   * - When leaving `encrypted`, the `unlocked` flag is cleared so the
   *   aggregate re-establishes a sane lock state in the new mode.
   * - The transition does NOT require the workspace to be unlocked.
   *   The CLI flows (`docs/11-seguridad-modos.md` §5 "encrypted ->
   *   shared/private requires unlock previo") enforce that requirement
   *   at the application layer because it depends on infrastructure
   *   capabilities (key cache, prompt) that the domain has no access
   *   to.
   */
  public changeMode(input: {
    newMode: WorkspaceMode;
    occurredAt: Timestamp;
  }): void {
    const previousMode = this.config.mode;
    if (previousMode.equals(input.newMode)) {
      throw new InvariantViolationError(
        `workspace ${this.id.toString()} is already in mode "${previousMode.toString()}"`,
        { invariant: "workspace.mode.no-op-transition" },
      );
    }
    if (!Workspace.isTransitionAllowed(previousMode, input.newMode)) {
      throw new InvalidModeTransitionError(previousMode, input.newMode);
    }
    this.config = this.config.withMode(input.newMode);
    if (!this.config.mode.requiresKey()) {
      this.unlocked = false;
    }
    this.events.push(
      new WorkspaceModeChanged({
        workspaceId: this.id,
        previousMode,
        newMode: input.newMode,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Marks the workspace as unlocked in the current process. Only
   * meaningful for encrypted workspaces; calling it on any other mode
   * is an invariant violation.
   *
   * Idempotency: calling `unlock(...)` on an already-unlocked workspace
   * is rejected too. The application layer owns "is the key cached?"
   * detection and only invokes the aggregate when an actual transition
   * is happening, so silently succeeding would mask bugs.
   */
  public unlock(input: { occurredAt: Timestamp }): void {
    if (!this.config.mode.requiresKey()) {
      throw new InvariantViolationError(
        `workspace ${this.id.toString()} is in mode "${this.config.mode.toString()}" and does not support unlock`,
        { invariant: "workspace.unlock.requires-encrypted-mode" },
      );
    }
    if (this.unlocked) {
      throw new InvariantViolationError(
        `workspace ${this.id.toString()} is already unlocked`,
        { invariant: "workspace.unlock.already-unlocked" },
      );
    }
    this.unlocked = true;
    this.events.push(
      new WorkspaceUnlocked({
        workspaceId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Re-locks the workspace, mirroring `unlock(...)`. Same restrictions:
   * encrypted-only, refuses no-op transitions.
   */
  public lock(input: { occurredAt: Timestamp }): void {
    if (!this.config.mode.requiresKey()) {
      throw new InvariantViolationError(
        `workspace ${this.id.toString()} is in mode "${this.config.mode.toString()}" and cannot be locked`,
        { invariant: "workspace.lock.requires-encrypted-mode" },
      );
    }
    if (!this.unlocked) {
      throw new InvariantViolationError(
        `workspace ${this.id.toString()} is already locked`,
        { invariant: "workspace.lock.already-locked" },
      );
    }
    this.unlocked = false;
    this.events.push(
      new WorkspaceLocked({
        workspaceId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Verifies that the aggregate is in a state where data-touching
   * operations may proceed. Use cases call this at the boundary right
   * before delegating to the persistence layer.
   *
   * The check is positive (no return value) so callers cannot forget
   * to act on a "false" result. Failure raises `WorkspaceLockedError`
   * which carries the JSON-RPC `ENCRYPTED_LOCKED` code.
   */
  public assertReadyForUse(): void {
    if (this.config.mode.requiresKey() && !this.unlocked) {
      throw new WorkspaceLockedError(this.id);
    }
  }

  // -- queries -------------------------------------------------------------

  public getId(): WorkspaceId {
    return this.id;
  }

  public getConfig(): WorkspaceConfig {
    return this.config;
  }

  public getMode(): WorkspaceMode {
    return this.config.mode;
  }

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  /** True iff the workspace requires a key AND is not currently unlocked. */
  public isLocked(): boolean {
    return this.config.mode.requiresKey() && !this.unlocked;
  }

  /**
   * Drains and returns the buffered events. The internal buffer is
   * emptied so subsequent calls only return events emitted after the
   * pull. The application layer typically pulls right after a
   * successful repository write.
   */
  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }

  // -- internals -----------------------------------------------------------

  private static isTransitionAllowed(
    from: WorkspaceMode,
    to: WorkspaceMode,
  ): boolean {
    const allowed = ALLOWED_TRANSITIONS[from.toString()];
    if (allowed === undefined) return false;
    const target = to.toString();
    for (const candidate of allowed) {
      if (candidate === target) return true;
    }
    return false;
  }
}
