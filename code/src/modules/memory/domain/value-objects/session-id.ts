import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for session identifiers.
 */
export type SessionIdBrand = "session";

/**
 * Identifier of a `Session` aggregate.
 *
 * Mirrors `sessions.id TEXT PRIMARY KEY` (`docs/03-modelo-datos.md`
 * §4.1). A session is the implicit grouping of turns within a 30-minute
 * idle window (`docs/01-arquitectura.md` §2.5).
 */
export class SessionId extends Id<SessionIdBrand> {
  public static from(raw: string): SessionId {
    const normalised = Id.normalize(raw, "session_id");
    return new SessionId(normalised as IdValue<SessionIdBrand>);
  }
}
