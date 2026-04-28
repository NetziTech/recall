import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Catalogue of legal `ContextLayerKindValue` values.
 *
 * Mirrors the seven layers documented in `docs/04-capas-contexto.md`
 * §2 plus their renderable names from `docs/02-protocolo-mcp.md` §4.2:
 *
 * | # | Layer name (this catalogue) | Doc reference |
 * |---|---|---|
 * | 1 | `workspace_anchor`    | Capa 1 — System Identity        |
 * | 2 | `active_decisions`    | Capa 2 — Project Constitution   |
 * | 3 | `open_tasks`          | Capa 3 — Active Tasks           |
 * | 4 | `recent_turns`        | Capa 4 — Recent Turns           |
 * | 5 | `relevant_memory`     | Capa 5 — Relevant Memory        |
 * | 6 | `entities_in_focus`   | Capa 6 — Code Map               |
 * | 7 | `open_questions`      | Capa 7 — Open Questions         |
 *
 * Naming choice — the catalogue uses domain-flavoured names rather than
 * the on-the-wire `system_identity` / `project_constitution` /
 * `code_map` literals from §4.2:
 *
 * - `workspace_anchor` reads like a domain concept (the layer fixes the
 *   workspace identity at the top of the bundle), where
 *   `system_identity` reads like a transport-level field.
 * - `active_decisions` says directly what the layer holds (only
 *   non-superseded decisions); `project_constitution` is metaphor.
 * - `open_tasks` says "non-done tasks", which is the actual filter.
 * - `entities_in_focus` says "entities relevant to the current
 *   conversation", where `code_map` overcommits to a code-only
 *   interpretation that the §3.6 doc itself contradicts (entities can
 *   be services, agents, files, ...).
 *
 * The application layer translates between the wire literals and these
 * domain literals when serialising the bundle for `mem.context`.
 *
 * The catalogue is the single source of truth for the discriminator of
 * `ContextLayer`; adding a new layer means adding an entry here AND a
 * branch in `ContextLayer`.
 */
const CONTEXT_LAYER_KINDS = [
  "workspace_anchor",
  "active_decisions",
  "open_tasks",
  "recent_turns",
  "relevant_memory",
  "entities_in_focus",
  "open_questions",
] as const;

export type ContextLayerKindValue = (typeof CONTEXT_LAYER_KINDS)[number];

/**
 * Stable assembly order. Matches the priority order documented in
 * `docs/04-capas-contexto.md` §2 (1 → 7). Used by the `ContextBundle`
 * truncation logic when the budget is too tight: lower-numbered layers
 * are preserved first because they carry the project's identity and
 * constitution, which is the information the assistant needs even
 * when context is scarce.
 */
const LAYER_ORDER: Readonly<Record<ContextLayerKindValue, number>> =
  Object.freeze({
    workspace_anchor: 1,
    active_decisions: 2,
    open_tasks: 3,
    recent_turns: 4,
    relevant_memory: 5,
    entities_in_focus: 6,
    open_questions: 7,
  });

/**
 * Value object representing one of the seven context layers of a
 * `ContextBundle`.
 *
 * The VO is intentionally a thin wrapper over the literal — the rich
 * payload of each layer lives in `ContextLayer` (the discriminated
 * union). This kind VO exists so callers can pass "the layer kind" as
 * a first-class type without juggling raw strings, and so the
 * truncation logic can compare layers by their canonical priority via
 * `priority()`.
 *
 * Invariants:
 * - The wrapped value is one of the seven known literals.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `ContextLayerKind` are equal iff their wrapped literals match.
 */
export class ContextLayerKind {
  private constructor(public readonly value: ContextLayerKindValue) {}

  public static workspaceAnchor(): ContextLayerKind {
    return new ContextLayerKind("workspace_anchor");
  }

  public static activeDecisions(): ContextLayerKind {
    return new ContextLayerKind("active_decisions");
  }

  public static openTasks(): ContextLayerKind {
    return new ContextLayerKind("open_tasks");
  }

  public static recentTurns(): ContextLayerKind {
    return new ContextLayerKind("recent_turns");
  }

  public static relevantMemory(): ContextLayerKind {
    return new ContextLayerKind("relevant_memory");
  }

  public static entitiesInFocus(): ContextLayerKind {
    return new ContextLayerKind("entities_in_focus");
  }

  public static openQuestions(): ContextLayerKind {
    return new ContextLayerKind("open_questions");
  }

  public static create(raw: string): ContextLayerKind {
    if (typeof raw !== "string") {
      throw new InvalidInputError("context layer kind must be a string", {
        field: "layer",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("context layer kind must not be empty", {
        field: "layer",
      });
    }
    if (!ContextLayerKind.isValue(trimmed)) {
      throw new InvalidInputError(
        `context layer kind must be one of ${CONTEXT_LAYER_KINDS.map((k) => `"${k}"`).join(" | ")} (got: "${raw}")`,
        { field: "layer" },
      );
    }
    return new ContextLayerKind(trimmed);
  }

  public static isValue(
    candidate: string,
  ): candidate is ContextLayerKindValue {
    for (const known of CONTEXT_LAYER_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * Returns the catalogue in canonical priority order (1 → 7).
   */
  public static all(): readonly ContextLayerKindValue[] {
    return CONTEXT_LAYER_KINDS;
  }

  /**
   * 1-based priority of the layer in the bundle. Lower numbers are
   * preserved first when truncating — this matches the doc's "anchor
   * first, code map last" intuition.
   */
  public priority(): number {
    return LAYER_ORDER[this.value];
  }

  public toString(): ContextLayerKindValue {
    return this.value;
  }

  public equals(other: ContextLayerKind): boolean {
    return this.value === other.value;
  }
}
