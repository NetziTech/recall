import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import {
  err,
  ok,
  type Result,
} from "../../../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EncryptionNotInitializedError } from "../../domain/errors/encryption-not-initialized-error.ts";
import type { EncryptionConfigRepository } from "../../domain/repositories/encryption-config-repository.ts";
import type { LockEncryption } from "../ports/in/lock-encryption.port.ts";

/**
 * Use case: lock the encryption for a workspace.
 *
 * Loads the `EncryptionConfig` aggregate, calls `lock(...)` on it
 * (which emits `EncryptionLocked` and clears the in-memory master
 * key), and persists the aggregate so the `updatedAt` timestamp
 * advances. Note that the aggregate's `unlockedKey` field is NOT
 * persisted; the lock flow is therefore process-local. Callers that
 * need to drop a SQLCipher handle do so separately in the composition
 * root.
 *
 * Failure modes:
 * - `EncryptionNotInitializedError` (Result channel): the workspace
 *   is not in encrypted mode. Caller decides whether to ignore or
 *   surface the message.
 * - `InvariantViolationError` (THROWN): the aggregate refuses to
 *   lock when already locked. The use case lets the error propagate
 *   because "lock when already locked" is a caller bug, not a
 *   recoverable outcome.
 */
export class LockEncryptionUseCase implements LockEncryption {
  public constructor(
    private readonly repository: EncryptionConfigRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async lock(input: {
    workspaceId: WorkspaceId;
  }): Promise<Result<void, EncryptionNotInitializedError>> {
    const config = await this.repository.findByWorkspace(input.workspaceId);
    if (config === null) {
      return err(new EncryptionNotInitializedError(input.workspaceId));
    }
    config.lock({ occurredAt: this.clock.now() });
    await this.repository.save(config);
    this.logger.info(
      { workspaceId: input.workspaceId.toString() },
      "encryption locked",
    );
    return ok(undefined);
  }
}
