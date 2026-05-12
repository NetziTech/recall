import { EncryptionInfrastructureError } from "./encryption-infrastructure-error.ts";

/**
 * Set of legal `EncryptionConfigPersistenceKind` values.
 *
 * - `read-failed`: the host filesystem refused the read (I/O error
 *   other than "file does not exist"). The adapter MUST NOT classify
 *   `ENOENT` as `read-failed`: a missing config means the workspace
 *   has no encryption slice, which is a normal, expected outcome
 *   surfaced via `findByWorkspace(...)` returning `null`.
 * - `malformed`: the on-disk JSON parsed but the result does not
 *   match the expected schema (Zod validation failure, missing
 *   fields, base64 decoding failure, weak KDF params, etc.). The
 *   adapter MUST NOT silently fall back to `null`: malformed
 *   `config.json` is a hard error so the user notices early instead
 *   of bootstrapping with a partially decoded state.
 * - `write-failed`: the host filesystem refused the temporary write
 *   or the atomic rename. The adapter best-effort-cleans the temp
 *   file; the canonical `config.json` is left untouched.
 * - `path-traversal`: the supplied workspace root contained `..` or
 *   resolved outside its declared parent. Defensive guard against
 *   composition-root bugs that hand a malicious path to the
 *   adapter; never expected on a legitimate workflow.
 */
const ENCRYPTION_CONFIG_PERSISTENCE_KINDS = [
  "read-failed",
  "malformed",
  "write-failed",
  "path-traversal",
] as const;

export type EncryptionConfigPersistenceKind =
  (typeof ENCRYPTION_CONFIG_PERSISTENCE_KINDS)[number];

/**
 * Thrown by the `EncryptionConfigRepository` adapter when the
 * filesystem layer cannot satisfy a read or write of the encryption
 * slice of `config.json`.
 *
 * Distinct from the domain-level `EncryptionNotInitializedError`:
 * - `EncryptionNotInitializedError` is raised by the application
 *   layer when `findByWorkspace(...)` returns `null` and the use
 *   case decides that absence is a user-facing failure.
 * - This infrastructure error is raised when the I/O itself
 *   misbehaves: corrupted JSON, missing permissions, traversal
 *   attempts, etc.
 *
 * Security invariants (inherited from `EncryptionInfrastructureError`):
 * - The `message` MUST NOT include passphrase characters, derived
 *   key bytes, master key bytes, AEAD tags, validator plaintext, or
 *   any other secret material. The validator blob and envelopes are
 *   ALREADY base64-encoded on disk (public material in that form),
 *   so quoting decoded sizes (e.g. "envelope ciphertext is 31 bytes,
 *   expected 32") is acceptable.
 * - Workspace path strings are quoted verbatim. The composition
 *   root caller is responsible for canonicalising the path before
 *   handing it to the adapter; the adapter rejects traversal
 *   attempts as a defensive belt.
 *
 * Invariants:
 * - `code` is `crypto.encryption-config-persistence-failed`.
 * - `kind` is one of `ENCRYPTION_CONFIG_PERSISTENCE_KINDS`.
 */
export class EncryptionConfigPersistenceError extends EncryptionInfrastructureError {
  public readonly code = "crypto.encryption-config-persistence-failed";
  public readonly kind: EncryptionConfigPersistenceKind;

  private constructor(
    message: string,
    kind: EncryptionConfigPersistenceKind,
    cause?: unknown,
  ) {
    super(message, cause);
    this.kind = kind;
  }

  public static readFailed(
    workspaceRoot: string,
    cause: unknown,
  ): EncryptionConfigPersistenceError {
    return new EncryptionConfigPersistenceError(
      `failed to read encryption slice of config.json under "${workspaceRoot}"`,
      "read-failed",
      cause,
    );
  }

  public static malformed(
    workspaceRoot: string,
    detail: string,
  ): EncryptionConfigPersistenceError {
    return new EncryptionConfigPersistenceError(
      `encryption slice of config.json under "${workspaceRoot}" is malformed: ${detail}`,
      "malformed",
    );
  }

  public static writeFailed(
    workspaceRoot: string,
    cause: unknown,
  ): EncryptionConfigPersistenceError {
    return new EncryptionConfigPersistenceError(
      `failed to write encryption slice of config.json under "${workspaceRoot}"`,
      "write-failed",
      cause,
    );
  }

  public static pathTraversal(
    workspaceRoot: string,
  ): EncryptionConfigPersistenceError {
    return new EncryptionConfigPersistenceError(
      `workspace root "${workspaceRoot}" resolves outside its declared parent (path traversal rejected)`,
      "path-traversal",
    );
  }

  public static isKind(
    candidate: string,
  ): candidate is EncryptionConfigPersistenceKind {
    for (const known of ENCRYPTION_CONFIG_PERSISTENCE_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }
}
