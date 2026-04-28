import type { OpenQuestion, OpenQuestionText } from "./open-question.ts";

/**
 * Value object wrapping the structured fields of a session's
 * `metadata_json` column.
 *
 * Mirrors the `sessions.metadata_json TEXT NOT NULL DEFAULT '{}'`
 * column documented in `docs/03-modelo-datos.md` §4.1. The persistence
 * layer serialises and deserialises the contents as JSON; the domain
 * exposes the fields as a typed VO so:
 *
 * - The Capa 7 (Open Questions) requirement
 *   (`docs/04-capas-contexto.md` §3.7 — "leyendo `metadata_json
 *   .open_questions`") is structurally satisfied: the curator can read
 *   the open questions of a closed session without poking at JSON.
 * - Adding new metadata fields in the future (e.g. token telemetry,
 *   model fingerprints) is a matter of extending this VO without
 *   touching the rest of the aggregate.
 *
 * Invariants:
 * - `openQuestions` is a frozen array, never mutated. Mutation produces
 *   a new `SessionMetadata` instance via `withOpenQuestionAdded` /
 *   `withOpenQuestionResolved`.
 * - The list is treated as a set keyed by `OpenQuestionText` (the
 *   curator must not record the same question twice with two different
 *   timestamps): `withOpenQuestionAdded` rejects duplicates and
 *   `withOpenQuestionResolved` removes by text match.
 *
 * Equality:
 * - Two `SessionMetadata` are equal iff their `openQuestions` lists are
 *   equal element-by-element (same order).
 */
export class SessionMetadata {
  private constructor(
    public readonly openQuestions: readonly OpenQuestion[],
  ) {}

  /**
   * Default empty metadata. Returned when the persistence layer
   * round-trips `'{}'` into the aggregate.
   */
  public static empty(): SessionMetadata {
    return new SessionMetadata(Object.freeze<OpenQuestion[]>([]));
  }

  /**
   * Builds a `SessionMetadata` from a raw open-question list. The
   * factory does NOT trim or deduplicate the supplied list — the
   * persistence adapter is expected to feed in already-normalised
   * data; the constructor merely freezes it.
   *
   * Use `withOpenQuestionAdded` / `withOpenQuestionResolved` for
   * curated mutation paths.
   */
  public static of(openQuestions: readonly OpenQuestion[]): SessionMetadata {
    return new SessionMetadata(Object.freeze([...openQuestions]));
  }

  /**
   * Returns true when the supplied text already corresponds to one of
   * the open questions tracked here.
   */
  public hasOpenQuestion(text: OpenQuestionText): boolean {
    for (const existing of this.openQuestions) {
      if (existing.text.equals(text)) return true;
    }
    return false;
  }

  /**
   * Returns a new `SessionMetadata` with `question` appended to the
   * open-questions list. If a question with the same text already
   * exists, returns this instance unchanged so the call is idempotent
   * (the curator may legitimately replay the same question; we do not
   * want a duplicate captured with a fresher timestamp).
   */
  public withOpenQuestionAdded(question: OpenQuestion): SessionMetadata {
    if (this.hasOpenQuestion(question.text)) {
      return this;
    }
    return new SessionMetadata(
      Object.freeze([...this.openQuestions, question]),
    );
  }

  /**
   * Returns a new `SessionMetadata` with the question matching `text`
   * removed. If the text is not present, returns this instance
   * unchanged so the call is idempotent.
   */
  public withOpenQuestionResolved(text: OpenQuestionText): SessionMetadata {
    if (!this.hasOpenQuestion(text)) {
      return this;
    }
    const filtered = this.openQuestions.filter(
      (existing) => !existing.text.equals(text),
    );
    return new SessionMetadata(Object.freeze(filtered));
  }

  public equals(other: SessionMetadata): boolean {
    if (this === other) return true;
    if (this.openQuestions.length !== other.openQuestions.length) return false;
    for (let i = 0; i < this.openQuestions.length; i += 1) {
      const a = this.openQuestions[i];
      const b = other.openQuestions[i];
      if (a === undefined || b === undefined) return false;
      if (!a.equals(b)) return false;
    }
    return true;
  }
}
