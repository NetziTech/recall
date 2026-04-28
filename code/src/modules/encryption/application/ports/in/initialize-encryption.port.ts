import type { EncryptionConfig } from "../../../domain/aggregates/encryption-config.ts";
import type { Passphrase } from "../../../domain/value-objects/passphrase.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Driving (input) port: initialise encryption for a workspace.
 *
 * Implements the `mem.init({ mode: "encrypted" })` server-side
 * bootstrap documented in `docs/11-seguridad-modos.md` §3:
 * 1. Generates a 32-byte master key from the CSPRNG.
 * 2. Generates a 16-byte salt from the CSPRNG.
 * 3. Generates a 12-byte IV for the validator blob from the CSPRNG.
 * 4. Generates a 12-byte IV for the first envelope from the CSPRNG.
 * 5. Derives the user passphrase against the salt with the canonical
 *    argon2id defaults (memory ≥ 64 MiB, iterations ≥ 3, parallelism
 *    ≥ 4 — see `KdfParams.defaults`).
 * 6. Wraps the master key with the derived key (AEAD) → first envelope.
 * 7. AEAD-encrypts the canonical sentinel `"VALID-WORKSPACE-V1"` with
 *    the master key → key validator blob.
 * 8. Constructs the `EncryptionConfig` aggregate via `initialize(...)`,
 *    which emits `EncryptionInitialized` and starts UNLOCKED.
 * 9. Persists the aggregate.
 * 10. Returns the aggregate so the caller can immediately hand the
 *     master key to the SQLCipher adapter and print the passphrase
 *     once on stdout (out-of-band — see §3 "Por que solo por stdout
 *     y no por canal MCP").
 *
 * The caller (composition root) is responsible for choosing the
 * passphrase representation. The MVP path uses the
 * `Passphrase` VO directly; future flows that print a
 * grouped recovery key (`M3-ZK7L-Q4WV-...`) on stdout build the
 * `Passphrase` from the printed value.
 *
 * Failure modes:
 * - All failures are operational (KDF primitive failure, AEAD
 *   failure, CSPRNG unavailable). They propagate as `InfrastructureError`
 *   exceptions, NOT through a `Result`: there is no recoverable
 *   user-facing outcome at init time — either the workspace was
 *   created or the operation aborts and the caller surfaces a fatal
 *   message. Returning a `Result` here would force the caller to
 *   handle a "void error" channel that is always treated as fatal
 *   anyway.
 */
export interface InitializeEncryption {
  initialize(input: {
    workspaceId: WorkspaceId;
    passphrase: Passphrase;
  }): Promise<EncryptionConfig>;
}
