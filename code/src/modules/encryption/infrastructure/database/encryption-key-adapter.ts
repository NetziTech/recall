import type { EncryptionKeyBytes } from "../../../../shared/infrastructure/database/sqlite-database.ts";
import type { MasterKey } from "../../domain/value-objects/master-key.ts";

/**
 * Anti-corruption layer between the encryption module's `MasterKey`
 * value object and the SQLite adapter's `EncryptionKeyBytes`
 * structural type.
 *
 * Why a dedicated adapter (per HANDOFF.md §6.6 D-020):
 * - `shared/infrastructure/database/sqlite-database.ts` declares a
 *   minimal local interface
 *   ```typescript
 *   export interface EncryptionKeyBytes {
 *     readonly bytes: Uint8Array;
 *   }
 *   ```
 *   precisely so it can stay free of any `modules/encryption/`
 *   import (the modularity rules of `docs/12 §1.5` Regla 1 forbid
 *   `shared` from depending on a module).
 * - The encryption module is the OWNER of `MasterKey`; this adapter
 *   is the only place where `MasterKey.withBytes(...)` is mapped
 *   into the structural type. Concentrating the bridge in one
 *   reviewable file keeps the dependency-graph boundary visible and
 *   the secret-handling discipline auditable.
 *
 * Lifecycle:
 * 1. The composition root unlocks the workspace and obtains a
 *    `MasterKey` (via `UnlockEncryptionUseCase` or
 *    `InitializeEncryptionUseCase`).
 * 2. The composition root calls
 *    `EncryptionKeyAdapter.toEncryptionKeyBytes(masterKey)` to
 *    produce a one-shot value compatible with
 *    `SqliteDatabase.open({ encryptionKey })`.
 * 3. The SQLite adapter consumes the bytes during PRAGMA setup and
 *    never retains the reference (per the `EncryptionKeyBytes` JSDoc
 *    invariant: "MUST NOT escape the call stack of
 *    `SqliteDatabase.open()`").
 * 4. The composition root immediately zero-fills the buffer this
 *    helper returned.
 *
 * Security:
 * - The function returns a FRESHLY allocated `Uint8Array` so the
 *   `MasterKey`'s internal buffer never escapes the VO. The caller
 *   is responsible for zeroing the returned buffer once SQLCipher
 *   has consumed it.
 * - The returned shape is `{ readonly bytes }` matching the
 *   structural type expected by `SqliteDatabase`, so type-checking
 *   confirms the adapter cannot accidentally produce a different
 *   shape.
 */
export const EncryptionKeyAdapter = {
  /**
   * Projects a `MasterKey` value object onto the structural
   * `EncryptionKeyBytes` shape consumed by `SqliteDatabase.open(...)`.
   *
   * The returned object holds a fresh defensive copy of the master
   * key bytes. Callers MUST zero-fill the buffer (`bytes.fill(0)`)
   * after `SqliteDatabase.open(...)` returns; the adapter cannot
   * do it on the caller's behalf because the SQLite driver retains
   * the buffer until the PRAGMA chain completes.
   */
  toEncryptionKeyBytes(masterKey: MasterKey): EncryptionKeyBytes {
    return {
      bytes: masterKey.withBytes((bytes) => new Uint8Array(bytes)),
    };
  },
} as const;
