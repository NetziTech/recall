import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { DisplayName } from "./display-name.ts";
import type { EmbedderSpec } from "./embedder-spec.ts";
import type { WorkspaceMode } from "./workspace-mode.ts";

/**
 * Schema version this domain knows how to model. Persistence migrations
 * (`docs/03-modelo-datos.md` §6) bump the running config version
 * lazily; the domain only deals with the value at rest.
 *
 * Kept as a string (semver-shaped) to match the on-disk format documented
 * in `docs/03-modelo-datos.md` §2.
 */
const SCHEMA_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * Value object representing the immutable subset of a workspace's
 * configuration that the domain reasons about.
 *
 * Mirrors the relevant slice of `.mcp-memoria/config.json` documented in
 * `docs/03-modelo-datos.md` §2:
 * - `schema_version`
 * - `workspace_id`
 * - `display_name`
 * - `mode`
 * - `embedder` (provider/model/dim)
 * - `created_at_ms`
 *
 * Fields that are NOT modeled here on purpose:
 * - `metadata`: free-form bag, owned by the application layer.
 * - `secrets`, `retrieval`, `curator`: those belong to other bounded
 *   contexts (`secrets`, `retrieval`, `curator` modules) and live in
 *   their own domain VOs. Cross-module imports are forbidden, so this
 *   VO intentionally stops at the workspace boundary.
 * - Encryption-specific fields (`kdf`, `kdf_params`,
 *   `key_validator_blob_b64`, `key_envelopes`): those are the
 *   `encryption` module's concern.
 *
 * Invariants:
 * - `schemaVersion` matches the semver pattern `MAJOR.MINOR.PATCH`.
 * - All composite VOs have already enforced their own invariants by
 *   construction.
 * - `createdAt` is stable for the lifetime of the workspace; it is
 *   never re-derived (the file timestamp is irrelevant — what matters
 *   is the explicit `created_at_ms` written at init).
 *
 * Equality:
 * - Two configs are equal iff every field is equal (delegates to each
 *   VO's `equals`).
 */
export class WorkspaceConfig {
  private constructor(
    public readonly schemaVersion: string,
    public readonly workspaceId: WorkspaceId,
    public readonly displayName: DisplayName,
    public readonly mode: WorkspaceMode,
    public readonly embedder: EmbedderSpec,
    public readonly createdAt: Timestamp,
  ) {}

  /**
   * Builds a `WorkspaceConfig` from already-parsed value objects. This
   * is the canonical factory; the application layer is in charge of
   * constructing each VO from the raw JSON before delegating here.
   */
  public static create(input: {
    schemaVersion: string;
    workspaceId: WorkspaceId;
    displayName: DisplayName;
    mode: WorkspaceMode;
    embedder: EmbedderSpec;
    createdAt: Timestamp;
  }): WorkspaceConfig {
    WorkspaceConfig.validateSchemaVersion(input.schemaVersion);
    return new WorkspaceConfig(
      input.schemaVersion,
      input.workspaceId,
      input.displayName,
      input.mode,
      input.embedder,
      input.createdAt,
    );
  }

  /**
   * Returns a new `WorkspaceConfig` with the mode replaced. Used by the
   * aggregate when a legal mode transition has been validated. Every
   * other field is preserved.
   */
  public withMode(newMode: WorkspaceMode): WorkspaceConfig {
    if (this.mode.equals(newMode)) return this;
    return new WorkspaceConfig(
      this.schemaVersion,
      this.workspaceId,
      this.displayName,
      newMode,
      this.embedder,
      this.createdAt,
    );
  }

  /**
   * Returns a new `WorkspaceConfig` with the embedder replaced. Useful
   * when the user opts into a different model and the config has to be
   * persisted before the curator triggers re-embedding (see
   * `docs/03-modelo-datos.md` §6 — "Migracion del modelo embedder").
   */
  public withEmbedder(newEmbedder: EmbedderSpec): WorkspaceConfig {
    if (this.embedder.equals(newEmbedder)) return this;
    return new WorkspaceConfig(
      this.schemaVersion,
      this.workspaceId,
      this.displayName,
      this.mode,
      newEmbedder,
      this.createdAt,
    );
  }

  /**
   * Returns a new `WorkspaceConfig` with the display name replaced.
   */
  public withDisplayName(newDisplayName: DisplayName): WorkspaceConfig {
    if (this.displayName.equals(newDisplayName)) return this;
    return new WorkspaceConfig(
      this.schemaVersion,
      this.workspaceId,
      newDisplayName,
      this.mode,
      this.embedder,
      this.createdAt,
    );
  }

  public equals(other: WorkspaceConfig): boolean {
    if (this === other) return true;
    return (
      this.schemaVersion === other.schemaVersion &&
      this.workspaceId.equals(other.workspaceId) &&
      this.displayName.equals(other.displayName) &&
      this.mode.equals(other.mode) &&
      this.embedder.equals(other.embedder) &&
      this.createdAt.equals(other.createdAt)
    );
  }

  // -- internals ------------------------------------------------------------

  private static validateSchemaVersion(raw: string): void {
    if (typeof raw !== "string") {
      throw new InvalidInputError("schema_version must be a string", {
        field: "schema_version",
      });
    }
    if (!SCHEMA_VERSION_PATTERN.test(raw)) {
      throw new InvalidInputError(
        `schema_version must match MAJOR.MINOR.PATCH (got: "${raw}")`,
        { field: "schema_version" },
      );
    }
  }
}
