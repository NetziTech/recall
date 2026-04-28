import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { EncryptionNotInitializedError } from "../../../domain/errors/encryption-not-initialized-error.ts";

/**
 * Driving (input) port: lock the encrypted workspace by dropping the
 * in-memory master key.
 *
 * The use case loads the `EncryptionConfig` aggregate, calls
 * `lock(...)` on it (which emits `EncryptionLocked` and clears the
 * `unlockedKey` field), and persists the result. The caller is
 * responsible for closing any SQLCipher handles that depend on the
 * key — this port only mutates the in-memory aggregate; the wire-up
 * lives in the composition root.
 *
 * Failure modes:
 * - `EncryptionNotInitializedError`: the workspace is not in
 *   encrypted mode. Caller decides whether absence is a no-op or an
 *   error.
 *
 * Note on idempotency:
 * - The aggregate refuses `lock()` when already locked
 *   (`InvariantViolationError`). This use case mirrors that behaviour
 *   (lets the error propagate as a non-`Result` throw): "lock when
 *   already locked" is a caller bug, not a recoverable outcome.
 */
export interface LockEncryption {
  lock(input: {
    workspaceId: WorkspaceId;
  }): Promise<Result<void, EncryptionNotInitializedError>>;
}
