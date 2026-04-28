import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for key envelope identifiers. Lives at the type level
 * only.
 */
export type KeyIdBrand = "key";

/**
 * Identifier of a `KeyEnvelope` inside an `EncryptionConfig`
 * aggregate.
 *
 * Mirrors `key_envelopes[].id` documented in
 * `docs/03-modelo-datos.md` §2 ("Campos especificos del modo
 * encrypted") and `docs/11-seguridad-modos.md` §7 ("Multi-key").
 * Inherits the UUID v7 invariants from `Id<KeyIdBrand>`; the brand
 * pins the type so the compiler refuses to mix it with
 * `WorkspaceId`, `DecisionId`, etc.
 *
 * The identifier is per-envelope, not per-user: a single user could
 * own several envelopes (e.g. one for their laptop, one for
 * recovery), and rotating an envelope produces a new id so audit
 * trails keep the history of which key opened the workspace at any
 * given moment.
 */
export class KeyId extends Id<KeyIdBrand> {
  /**
   * Builds a `KeyId` from a raw string. Validates UUID v7 shape via
   * the inherited `normalize` helper.
   */
  public static from(raw: string): KeyId {
    const normalised = Id.normalize(raw, "key_id");
    return new KeyId(normalised as IdValue<KeyIdBrand>);
  }
}
