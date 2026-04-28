import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { EncryptionConfig } from "../aggregates/encryption-config.ts";

/**
 * Driven port (output port) for persisting and reloading the
 * `EncryptionConfig` aggregate.
 *
 * Implementations live in `infrastructure/persistence/` and translate
 * between the in-memory aggregate and the on-disk representation
 * documented in `docs/03-modelo-datos.md` §2 ("Campos especificos
 * del modo encrypted") — the `kdf`, `kdf_params`,
 * `key_validator_blob_b64` and `key_envelopes` slice of
 * `.recall/config.json`.
 *
 * Contract:
 * - The repository works with the **whole aggregate**. Adapters
 *   MUST NOT expose partial-update methods (e.g.
 *   `updateValidatorBlob`) or expose internal envelope arrays. If
 *   a use case wants to mutate the config, it loads the aggregate,
 *   calls a domain method, then `save`s it back.
 * - `findByWorkspace` returns `null` (not a thrown error) when the
 *   workspace exists but has no encryption config (typical case:
 *   the workspace is in `shared` or `private` mode). Callers
 *   decide whether absence is recoverable or warrants raising
 *   `EncryptionNotInitializedError`.
 * - `save` is responsible for writing the persistent slice
 *   atomically. The runtime-only `unlockedKey` field is NOT
 *   persisted (it lives in the process for the duration of the
 *   session). Adapters MUST NOT serialize it under any
 *   circumstance.
 * - Events buffered in the aggregate are NOT consumed by the
 *   repository. The application layer drains them via
 *   `pullEvents()` after `save` succeeds and dispatches them to
 *   the subscribers.
 *
 * Why "find by workspace" instead of "find by id":
 * - The aggregate's identity IS the workspace id. Modelling the
 *   query as `findByWorkspace(workspaceId)` keeps that explicit at
 *   the call site: no use case has to invent an `EncryptionConfigId`
 *   that would just shadow the workspace one.
 */
export interface EncryptionConfigRepository {
  /**
   * Loads the encryption config of the workspace identified by
   * `workspaceId`. Returns `null` if the workspace has no
   * encryption config (mode `shared` or `private`).
   */
  findByWorkspace(workspaceId: WorkspaceId): Promise<EncryptionConfig | null>;

  /**
   * Persists the encryption config. Implementations are free to
   * perform an upsert (the aggregate carries its own identity) but
   * MUST be atomic: a partial write that leaves `config.json`
   * corrupted is a contract violation.
   */
  save(config: EncryptionConfig): Promise<void>;

  /**
   * Removes the encryption slice (kdf / kdf_params /
   * key_validator_blob / key_envelopes) for the workspace identified
   * by `workspaceId`. After a successful `delete`, a subsequent
   * `findByWorkspace(workspaceId)` MUST return `null`.
   *
   * Contract:
   * - `delete` is idempotent at the repository boundary: deleting
   *   when no encryption slice exists is a no-op (no error, no
   *   side effect). Application-layer use cases that want to
   *   reject "destroy when not encrypted" do so BEFORE invoking
   *   the repository, by checking the result of `findByWorkspace`.
   * - The operation MUST be atomic: a partial write that leaves
   *   `config.json` corrupted is a contract violation. The
   *   non-encryption slice of `config.json` (workspace identity,
   *   embedder spec, etc.) MUST be preserved verbatim.
   * - Implementations MUST NOT touch the SQLCipher database files
   *   themselves. Re-keying / decrypting the actual data is the
   *   workspace module's responsibility.
   *
   * Why a dedicated method (and not "save with empty envelopes"):
   * - The aggregate's invariant `envelopes.length >= 1` makes it
   *   impossible to construct an `EncryptionConfig` with zero
   *   envelopes. Modeling destruction as a separate repository
   *   verb keeps the aggregate's invariants intact and gives the
   *   adapter a clean entry point for "remove the on-disk slice
   *   entirely".
   */
  delete(workspaceId: WorkspaceId): Promise<void>;
}
