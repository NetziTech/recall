import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { OpenQuestion } from "../../../memory/domain/value-objects/open-question.ts";
import type { SessionId } from "../../../memory/domain/value-objects/session-id.ts";

/**
 * Lightweight reference to an open question carried over from a closed
 * session, suitable for inclusion in the `open_questions` layer of a
 * `ContextBundle`.
 *
 * Open questions are a per-session concept (see
 * `docs/04-capas-contexto.md` §3.7 — "preguntas abiertas" stored on
 * `sessions.metadata_json.open_questions`). The retrieval pipeline
 * surfaces the most recent ones so the next session can revisit them;
 * the ref captures:
 * - `sessionId` — origin of the question (so the renderer can group
 *   questions by session if needed).
 * - `question` — the actual prompt, wrapped in the canonical VO from
 *   the memory module.
 * - `recordedAt` — when the question was raised; used to sort the
 *   layer DESC and to mark "very old" questions as candidates for
 *   pruning.
 *
 * Modelling decision — no relevance score:
 * - The `open_questions` layer is not a search result; it is a
 *   chronological window over the last N closed sessions. Adding a
 *   relevance score would suggest the layer is rankable by query
 *   relevance, which it is not (the doc says "ultimas 5 sesiones
 *   cerradas, todas las preguntas abiertas"). If the future spec
 *   adds query-driven ranking on this layer, the ref grows a score
 *   field; until then, the absence is documentation.
 *
 * Invariants:
 * - All fields are validated VOs.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `OpenQuestionRef` are equal iff their `sessionId` AND
 *   `question` match — there is no synthetic id for an open question
 *   in `sessions.metadata_json`, so the (session, question) pair is
 *   the natural identity.
 */
export class OpenQuestionRef {
  private constructor(
    public readonly sessionId: SessionId,
    public readonly question: OpenQuestion,
    public readonly recordedAt: Timestamp,
  ) {}

  public static of(input: {
    sessionId: SessionId;
    question: OpenQuestion;
    recordedAt: Timestamp;
  }): OpenQuestionRef {
    return new OpenQuestionRef(
      input.sessionId,
      input.question,
      input.recordedAt,
    );
  }

  public equals(other: OpenQuestionRef): boolean {
    if (this === other) return true;
    return (
      this.sessionId.equals(other.sessionId) &&
      this.question.equals(other.question)
    );
  }
}
