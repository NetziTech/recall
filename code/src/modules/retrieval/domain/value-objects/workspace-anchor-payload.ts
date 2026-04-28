import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionId } from "../../../memory/domain/value-objects/session-id.ts";
import type { SessionIntent } from "../../../memory/domain/value-objects/session-intent.ts";

/**
 * Catalogue of workspace privacy modes the bundle layer-1 may report.
 *
 * Mirrors the three modes documented in `docs/01-arquitectura.md` §2.3
 * and persisted in `.mcp-memoria/config.json`. The retrieval module
 * does NOT import the workspace module's `WorkspaceMode` VO (that
 * would be a cross-module import outside `shared/`); the catalogue is
 * duplicated here as the *projection* that lands in the bundle. The
 * application layer translates between the two representations.
 *
 * Drift policy: if the workspace module ever adds a new mode (e.g.
 * `air-gapped`), the same literal must be added here AND in the
 * mapping function in the application layer that builds the layer-1
 * payload. The duplication is intentional — the alternative (importing
 * the workspace mode) would create a cross-module coupling that
 * `docs/12-lineamientos-arquitectura.md` §1.5 Regla 2 forbids.
 */
const WORKSPACE_MODE_LABELS = ["shared", "encrypted", "private"] as const;

export type WorkspaceModeLabel = (typeof WORKSPACE_MODE_LABELS)[number];

/**
 * Value object representing the payload of the `workspace_anchor`
 * context layer (Capa 1 — System Identity, see
 * `docs/04-capas-contexto.md` §3.1).
 *
 * The payload captures the minimal information needed to answer
 * "which project am I in, and what was I doing?":
 * - `workspaceId` — stable id of the workspace.
 * - `displayName` — human-friendly name from `config.json`.
 * - `mode` — privacy mode label (`shared`, `encrypted`, `private`).
 * - `activeSessionId` — id of the current session, or `null` if no
 *   session is active (e.g. fresh start).
 * - `activeSessionIntent` — text of the current session's `intent`,
 *   or `null` if absent.
 * - `sessionStartedAt` — when the current session began, or `null`.
 *
 * The doc's example bundle in §3.1 also shows the metadata bag
 * (`{language: "rust", phase: "1"}`); that is a free-form dictionary
 * carried separately as `metadata`. Modelling it as a typed structure
 * here would force every workspace to declare the same shape, which is
 * the wrong constraint — the metadata is genuinely free-form and is
 * displayed verbatim.
 *
 * Invariants:
 * - `displayName` is a non-empty trimmed string.
 * - `mode` is one of the three known labels.
 * - `activeSessionId` is `null` iff there is no active session;
 *   `activeSessionIntent` and `sessionStartedAt` are independently
 *   nullable (a session may exist without an intent).
 * - `metadata` is a frozen `Record<string, string>` (only string
 *   values are accepted to keep the payload renderable as a single
 *   line per key).
 * - Instances are immutable.
 */
export class WorkspaceAnchorPayload {
  private constructor(
    public readonly workspaceId: WorkspaceId,
    public readonly displayName: NonEmptyString,
    public readonly mode: WorkspaceModeLabel,
    public readonly activeSessionId: SessionId | null,
    public readonly activeSessionIntent: SessionIntent | null,
    public readonly sessionStartedAt: Timestamp | null,
    public readonly metadata: Readonly<Record<string, string>>,
  ) {}

  public static of(input: {
    workspaceId: WorkspaceId;
    displayName: NonEmptyString;
    mode: WorkspaceModeLabel;
    activeSessionId: SessionId | null;
    activeSessionIntent: SessionIntent | null;
    sessionStartedAt: Timestamp | null;
    metadata: Readonly<Record<string, string>>;
  }): WorkspaceAnchorPayload {
    if (!WorkspaceAnchorPayload.isModeLabel(input.mode)) {
      throw new InvalidInputError(
        `workspace mode must be one of ${WORKSPACE_MODE_LABELS.map((m) => `"${m}"`).join(" | ")} (got: "${String(input.mode)}")`,
        { field: "mode" },
      );
    }
    if (
      (input.activeSessionId === null) !==
      (input.sessionStartedAt === null && input.activeSessionIntent === null)
    ) {
      // Soft check: it is legal to have a session without an intent or a
      // start timestamp (the persistence may not have written one yet),
      // but it is suspicious to have a `sessionStartedAt` or
      // `activeSessionIntent` *without* an `activeSessionId`. The
      // following predicate enforces only the second direction.
      if (
        input.activeSessionId === null &&
        (input.sessionStartedAt !== null || input.activeSessionIntent !== null)
      ) {
        throw new InvalidInputError(
          "activeSessionIntent and sessionStartedAt cannot be set when activeSessionId is null",
          { field: "active_session_id" },
        );
      }
    }
    const frozenMetadata = WorkspaceAnchorPayload.freezeMetadata(
      input.metadata,
    );
    return new WorkspaceAnchorPayload(
      input.workspaceId,
      input.displayName,
      input.mode,
      input.activeSessionId,
      input.activeSessionIntent,
      input.sessionStartedAt,
      frozenMetadata,
    );
  }

  public static isModeLabel(candidate: string): candidate is WorkspaceModeLabel {
    for (const known of WORKSPACE_MODE_LABELS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public equals(other: WorkspaceAnchorPayload): boolean {
    if (this === other) return true;
    if (!this.workspaceId.equals(other.workspaceId)) return false;
    if (!this.displayName.equals(other.displayName)) return false;
    if (this.mode !== other.mode) return false;
    if (
      (this.activeSessionId === null) !== (other.activeSessionId === null) ||
      (this.activeSessionId !== null &&
        other.activeSessionId !== null &&
        !this.activeSessionId.equals(other.activeSessionId))
    ) {
      return false;
    }
    if (
      (this.activeSessionIntent === null) !==
        (other.activeSessionIntent === null) ||
      (this.activeSessionIntent !== null &&
        other.activeSessionIntent !== null &&
        !this.activeSessionIntent.equals(other.activeSessionIntent))
    ) {
      return false;
    }
    if (
      (this.sessionStartedAt === null) !== (other.sessionStartedAt === null) ||
      (this.sessionStartedAt !== null &&
        other.sessionStartedAt !== null &&
        !this.sessionStartedAt.equals(other.sessionStartedAt))
    ) {
      return false;
    }
    return WorkspaceAnchorPayload.metadataEquals(this.metadata, other.metadata);
  }

  // -- internals -----------------------------------------------------------

  private static freezeMetadata(
    raw: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>> {
    const out: Record<string, string> = {};
    const keys = Object.keys(raw);
    for (const key of keys) {
      const value = raw[key];
      if (typeof value !== "string") {
        throw new InvalidInputError(
          `metadata value at "${key}" must be a string (got: ${typeof value})`,
          { field: `metadata.${key}` },
        );
      }
      out[key] = value;
    }
    return Object.freeze(out);
  }

  private static metadataEquals(
    a: Readonly<Record<string, string>>,
    b: Readonly<Record<string, string>>,
  ): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (a[key] !== b[key]) return false;
    }
    return true;
  }
}
