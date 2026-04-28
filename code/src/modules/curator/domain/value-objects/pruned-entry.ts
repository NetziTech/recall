import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { AffectedEntryRef } from "./affected-entry-ref.ts";
import type { MemoryEntryKind } from "./memory-entry-kind.ts";
import type { PrunedReason } from "./pruned-reason.ts";

/**
 * Maximum length of the `contentSnapshot` field. Mirrors the soft
 * limits the schema imposes on `pruned.content_snapshot TEXT` (no
 * declared cap, but pruning a row with hundreds of MB of payload
 * defeats the purpose of the audit trail). 64 KiB is comfortably
 * above the longest legitimate memory entry (a `Decision` rationale
 * tops out at a couple of KB) while still bounding worst-case input.
 */
const MAX_SNAPSHOT_LENGTH = 64 * 1024;

/**
 * Value object representing a row in the `pruned` audit table.
 *
 * Mirrors the `pruned` table documented in
 * `docs/03-modelo-datos.md` §4.9. Pruned entries are immutable
 * snapshots: once an entry has been moved here, the only legitimate
 * operations are reading it for audit / recovery (within the 30-day
 * retention window) or letting the rolling deletion sweep drop it.
 *
 * Modelled as a VO (rather than an aggregate) because no in-memory
 * mutation ever happens — the lifecycle is purely "create on prune,
 * read on audit". The repository
 * (`PrunedEntryRepository`) is an append-only sink.
 *
 * Invariants:
 * - `entryRef` carries the kind + canonical id of the pruned entry
 *   (validated through `AffectedEntryRef`).
 * - `workspaceId` identifies the owning workspace; the `pruned`
 *   table is per-workspace because the entire DB is per-workspace
 *   (`docs/03-modelo-datos.md` §4.1 — "no hay `workspace_id`").
 *   The field is carried in memory anyway so cross-workspace tooling
 *   (export / wipe) can dispatch correctly.
 * - `contentSnapshot` is a non-empty string no longer than
 *   `MAX_SNAPSHOT_LENGTH`. The snapshot is the SERIALISED form of
 *   the entry at the moment of pruning (typically JSON), but the
 *   curator domain treats it opaquely.
 * - `reason` and `prunedAt` describe the why and when of the prune.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `PrunedEntry` are equal iff every field matches (workspaceId,
 *   kind, originalId, contentSnapshot, reason, prunedAt). Equality
 *   on the snapshot is structural string comparison.
 */
export class PrunedEntry {
  private constructor(
    public readonly workspaceId: WorkspaceId,
    public readonly entryRef: AffectedEntryRef,
    public readonly contentSnapshot: string,
    public readonly reason: PrunedReason,
    public readonly prunedAt: Timestamp,
  ) {}

  /**
   * Builds a `PrunedEntry`. Validates `contentSnapshot` (non-empty,
   * bounded length) and constructs the `AffectedEntryRef` from the
   * raw kind/id pair.
   */
  public static create(input: {
    workspaceId: WorkspaceId;
    kind: MemoryEntryKind;
    originalId: string;
    contentSnapshot: string;
    reason: PrunedReason;
    prunedAt: Timestamp;
  }): PrunedEntry {
    if (typeof input.contentSnapshot !== "string") {
      throw new InvalidInputError("pruned content snapshot must be a string", {
        field: "content_snapshot",
      });
    }
    if (input.contentSnapshot.length === 0) {
      throw new InvalidInputError("pruned content snapshot must not be empty", {
        field: "content_snapshot",
      });
    }
    if (input.contentSnapshot.length > MAX_SNAPSHOT_LENGTH) {
      throw new InvalidInputError(
        `pruned content snapshot must be at most ${String(MAX_SNAPSHOT_LENGTH)} characters (got: ${String(input.contentSnapshot.length)})`,
        { field: "content_snapshot" },
      );
    }
    const ref = AffectedEntryRef.of(input.kind, input.originalId);
    return new PrunedEntry(
      input.workspaceId,
      ref,
      input.contentSnapshot,
      input.reason,
      input.prunedAt,
    );
  }

  /**
   * Convenience accessor for the kind (forwarded from `entryRef`).
   */
  public getKind(): MemoryEntryKind {
    return this.entryRef.kind;
  }

  /**
   * Convenience accessor for the canonical id (forwarded from
   * `entryRef`).
   */
  public getOriginalId(): string {
    return this.entryRef.id;
  }

  public equals(other: PrunedEntry): boolean {
    if (this === other) return true;
    if (!this.workspaceId.equals(other.workspaceId)) return false;
    if (!this.entryRef.equals(other.entryRef)) return false;
    if (this.contentSnapshot !== other.contentSnapshot) return false;
    if (!this.reason.equals(other.reason)) return false;
    if (!this.prunedAt.equals(other.prunedAt)) return false;
    return true;
  }
}
