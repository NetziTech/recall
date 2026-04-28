import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { EncryptedMasterKey } from "./encrypted-master-key.ts";
import type { KdfParams } from "./kdf-params.ts";
import type { KeyId } from "./key-id.ts";
import type { KeyLabel } from "./key-label.ts";

/**
 * Composite value object representing one entry in the
 * `key_envelopes` array of an encrypted-mode workspace.
 *
 * Mirrors the wire shape documented in `docs/03-modelo-datos.md` §2:
 *
 * ```json
 * {
 *   "id": "envelope-1",
 *   "created_at_ms": 1745000000000,
 *   "ciphertext_b64": "<wrapped-master-key>"
 * }
 * ```
 *
 * — extended with the `kdfParams` (each envelope can in principle
 * use different params if the user rotates them) and the optional
 * `label` (a human-readable description so the multi-key flow in
 * `docs/11-seguridad-modos.md` §7 is operable).
 *
 * Each envelope wraps the SAME master key with a DIFFERENT user
 * passphrase. The envelope-cipher produces the (`ciphertext`, `iv`,
 * `tag`) tuple from `(masterKey, derivedKey)`, where `derivedKey =
 * KDF(passphrase, kdfParams)`. On unlock, the inverse is applied.
 *
 * Why per-envelope `kdfParams` instead of one global spec:
 * - Allows seamless rotation: an operator can add a new envelope
 *   with stronger params (e.g. higher memory budget) without forcing
 *   every existing envelope to be re-derived.
 * - Allows different envelopes to use different salts (the project
 *   convention is one salt per envelope, generated CSPRNG at
 *   `addEnvelope` time).
 * - Costs nothing in storage (the `kdfParams` block is ~50 bytes
 *   per envelope) and avoids a footgun where rotating params would
 *   silently invalidate every envelope.
 *
 * Invariants:
 * - All four mandatory fields are set; `label` is allowed to be
 *   `null` (envelopes created via the legacy CLI flow without
 *   a label still need to be representable).
 * - Instances are immutable. Updating an envelope means producing a
 *   new instance via the application layer, NOT mutating in place.
 *
 * Equality:
 * - Two envelopes are equal iff their identifiers are equal. The
 *   identifier IS the key into the multi-key array; two instances
 *   with the same id but different ciphertext represent the same
 *   logical envelope at different points in time. The aggregate
 *   ensures only one envelope per id exists at any moment.
 */
export class KeyEnvelope {
  private constructor(
    public readonly keyId: KeyId,
    public readonly encryptedMasterKey: EncryptedMasterKey,
    public readonly kdfParams: KdfParams,
    public readonly createdAt: Timestamp,
    public readonly label: KeyLabel | null,
  ) {}

  /**
   * Builds a `KeyEnvelope` from already-validated VOs. The
   * application layer is responsible for constructing each VO from
   * the raw JSON before delegating here.
   */
  public static create(input: {
    keyId: KeyId;
    encryptedMasterKey: EncryptedMasterKey;
    kdfParams: KdfParams;
    createdAt: Timestamp;
    label: KeyLabel | null;
  }): KeyEnvelope {
    return new KeyEnvelope(
      input.keyId,
      input.encryptedMasterKey,
      input.kdfParams,
      input.createdAt,
      input.label,
    );
  }

  /**
   * Returns a new `KeyEnvelope` with the label replaced. Useful
   * when the user renames an envelope (`mcp-memoria add-key
   * --rename ...`). Other fields are preserved by reference (they
   * are themselves immutable).
   */
  public withLabel(newLabel: KeyLabel | null): KeyEnvelope {
    if (newLabel === null && this.label === null) return this;
    if (
      newLabel !== null &&
      this.label !== null &&
      newLabel.equals(this.label)
    ) {
      return this;
    }
    return new KeyEnvelope(
      this.keyId,
      this.encryptedMasterKey,
      this.kdfParams,
      this.createdAt,
      newLabel,
    );
  }

  /**
   * Identity equality: two envelopes are equal iff they share the
   * same `keyId`. The aggregate guarantees uniqueness of ids.
   */
  public equals(other: KeyEnvelope): boolean {
    if (this === other) return true;
    return this.keyId.equals(other.keyId);
  }

  /**
   * Deep, content-based equality. Useful for tests that need to
   * assert "the persisted envelope matches the in-memory one
   * down to the bytes". Not used by the aggregate identity logic.
   */
  public deepEquals(other: KeyEnvelope): boolean {
    if (this === other) return true;
    if (!this.keyId.equals(other.keyId)) return false;
    if (!this.encryptedMasterKey.equals(other.encryptedMasterKey)) return false;
    if (!this.kdfParams.equals(other.kdfParams)) return false;
    if (!this.createdAt.equals(other.createdAt)) return false;
    if (this.label === null && other.label === null) return true;
    if (this.label === null || other.label === null) return false;
    return this.label.equals(other.label);
  }
}
