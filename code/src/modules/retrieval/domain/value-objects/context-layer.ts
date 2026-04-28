import type { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import { ContextLayerKind } from "./context-layer-kind.ts";
import type { DecisionRef } from "./decision-ref.ts";
import type { EntityRef } from "./entity-ref.ts";
import type { MemoryRef } from "./memory-ref.ts";
import type { OpenQuestionRef } from "./open-question-ref.ts";
import type { TaskRef } from "./task-ref.ts";
import type { TurnRef } from "./turn-ref.ts";
import type { WorkspaceAnchorPayload } from "./workspace-anchor-payload.ts";

/**
 * Discriminated-union view over the seven possible payload shapes a
 * `ContextLayer` can carry. Exposed as a type alias so adapters can
 * pattern-match without poking at the class internals.
 *
 * Shape rules:
 * - `workspace_anchor` carries either exactly one
 *   `WorkspaceAnchorPayload` (the workspace and its active session) or
 *   `null` when the anchor is unavailable (fresh / pre-006 workspace).
 *   The `null` form represents the "always-emit, even when empty"
 *   contract documented in `docs/02 §4.2`: every wire response carries
 *   the seven canonical layers so MCP clients can rely on the keys
 *   being present.
 * - The other six layers carry a frozen, possibly empty array of refs
 *   of the appropriate type. Empty arrays are valid (e.g. no active
 *   tasks) and the wire boundary always emits them with
 *   `entries_count: 0`.
 */
export type ContextLayerValue =
  | {
      readonly kind: "workspace_anchor";
      readonly payload: WorkspaceAnchorPayload | null;
    }
  | {
      readonly kind: "active_decisions";
      readonly payload: readonly DecisionRef[];
    }
  | { readonly kind: "open_tasks"; readonly payload: readonly TaskRef[] }
  | { readonly kind: "recent_turns"; readonly payload: readonly TurnRef[] }
  | {
      readonly kind: "relevant_memory";
      readonly payload: readonly MemoryRef[];
    }
  | {
      readonly kind: "entities_in_focus";
      readonly payload: readonly EntityRef[];
    }
  | {
      readonly kind: "open_questions";
      readonly payload: readonly OpenQuestionRef[];
    };

/**
 * Composite value object representing one layer of a `ContextBundle`.
 *
 * Wraps the discriminated union together with the layer's metadata
 * (kind VO + token cost) so the bundle assembler can carry both the
 * payload and the budget bookkeeping in a single object. The wrapper
 * is what lets the bundle treat layers uniformly while preserving the
 * type of each payload.
 *
 * Modelling decision — class wrapper around a discriminated union:
 *
 * The plain DU (`ContextLayerValue`) is exported separately for
 * adapters that prefer pattern-matching. The class adds:
 *  1. a single `kindVO()` accessor (returns `ContextLayerKind`) so
 *     callers can use the priority/equals helpers without re-creating
 *     the VO from the literal;
 *  2. a `tokens()` accessor that reports the layer's token cost,
 *     stored alongside the payload so the budget arithmetic stays in
 *     one place;
 *  3. structural `equals(other)` that walks the payloads;
 *  4. exhaustive factories per kind so the type system catches any
 *     missing branch when a new layer is added.
 *
 * Invariants:
 * - The `kind` literal of the DU matches the `kindVO().value` accessor
 *   one-to-one (the factory pins both at construction).
 * - `tokens` is a `Tokens` VO (already non-negative).
 * - The `payload` array is frozen at construction.
 * - Instances are immutable.
 *
 * Equality:
 * - Two layers are equal iff they share the same kind, the same token
 *   count, and structurally-equal payloads. Equality on entry refs uses
 *   the refs' own `equals` (id-based for the typed refs).
 */
export class ContextLayer {
  private constructor(
    private readonly value: ContextLayerValue,
    private readonly tokensCost: Tokens,
  ) {}

  // -- factories per kind --------------------------------------------------

  public static workspaceAnchor(input: {
    payload: WorkspaceAnchorPayload | null;
    tokens: Tokens;
  }): ContextLayer {
    return new ContextLayer(
      { kind: "workspace_anchor", payload: input.payload },
      input.tokens,
    );
  }

  public static activeDecisions(input: {
    payload: readonly DecisionRef[];
    tokens: Tokens;
  }): ContextLayer {
    return new ContextLayer(
      { kind: "active_decisions", payload: Object.freeze([...input.payload]) },
      input.tokens,
    );
  }

  public static openTasks(input: {
    payload: readonly TaskRef[];
    tokens: Tokens;
  }): ContextLayer {
    return new ContextLayer(
      { kind: "open_tasks", payload: Object.freeze([...input.payload]) },
      input.tokens,
    );
  }

  public static recentTurns(input: {
    payload: readonly TurnRef[];
    tokens: Tokens;
  }): ContextLayer {
    return new ContextLayer(
      { kind: "recent_turns", payload: Object.freeze([...input.payload]) },
      input.tokens,
    );
  }

  public static relevantMemory(input: {
    payload: readonly MemoryRef[];
    tokens: Tokens;
  }): ContextLayer {
    return new ContextLayer(
      { kind: "relevant_memory", payload: Object.freeze([...input.payload]) },
      input.tokens,
    );
  }

  public static entitiesInFocus(input: {
    payload: readonly EntityRef[];
    tokens: Tokens;
  }): ContextLayer {
    return new ContextLayer(
      { kind: "entities_in_focus", payload: Object.freeze([...input.payload]) },
      input.tokens,
    );
  }

  public static openQuestions(input: {
    payload: readonly OpenQuestionRef[];
    tokens: Tokens;
  }): ContextLayer {
    return new ContextLayer(
      { kind: "open_questions", payload: Object.freeze([...input.payload]) },
      input.tokens,
    );
  }

  // -- accessors -----------------------------------------------------------

  /**
   * Returns the discriminated-union view. Useful for pattern-matching
   * when serialising the layer.
   */
  public toValue(): ContextLayerValue {
    return this.value;
  }

  /**
   * Returns the layer kind as a value object (carries the
   * `priority()` helper for the truncation logic).
   */
  public kindVO(): ContextLayerKind {
    return ContextLayerKind.create(this.value.kind);
  }

  /**
   * Returns the layer's literal kind (no allocation). Convenience for
   * fast comparisons.
   */
  public kind(): ContextLayerValue["kind"] {
    return this.value.kind;
  }

  public tokens(): Tokens {
    return this.tokensCost;
  }

  /**
   * Number of entries in the payload. For `workspace_anchor`, the
   * count is `1` when the payload is present and `0` when the anchor
   * is absent (the layer is still emitted to satisfy the wire
   * contract — see `docs/02 §4.2`). For the array-shaped layers, it
   * is the array length.
   */
  public entriesCount(): number {
    if (this.value.kind === "workspace_anchor") {
      return this.value.payload === null ? 0 : 1;
    }
    return this.value.payload.length;
  }

  public equals(other: ContextLayer): boolean {
    if (this === other) return true;
    if (this.value.kind !== other.value.kind) return false;
    if (!this.tokensCost.equals(other.tokensCost)) return false;
    return ContextLayer.payloadEquals(this.value, other.value);
  }

  // -- internals -----------------------------------------------------------

  private static payloadEquals(
    a: ContextLayerValue,
    b: ContextLayerValue,
  ): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "workspace_anchor" && b.kind === "workspace_anchor") {
      if (a.payload === null && b.payload === null) return true;
      if (a.payload === null || b.payload === null) return false;
      return a.payload.equals(b.payload);
    }
    if (a.kind === "active_decisions" && b.kind === "active_decisions") {
      return ContextLayer.refArrayEquals(a.payload, b.payload, (x, y) =>
        x.equals(y),
      );
    }
    if (a.kind === "open_tasks" && b.kind === "open_tasks") {
      return ContextLayer.refArrayEquals(a.payload, b.payload, (x, y) =>
        x.equals(y),
      );
    }
    if (a.kind === "recent_turns" && b.kind === "recent_turns") {
      return ContextLayer.refArrayEquals(a.payload, b.payload, (x, y) =>
        x.equals(y),
      );
    }
    if (a.kind === "relevant_memory" && b.kind === "relevant_memory") {
      return ContextLayer.refArrayEquals(a.payload, b.payload, (x, y) =>
        x.equals(y),
      );
    }
    if (a.kind === "entities_in_focus" && b.kind === "entities_in_focus") {
      return ContextLayer.refArrayEquals(a.payload, b.payload, (x, y) =>
        x.equals(y),
      );
    }
    if (a.kind === "open_questions" && b.kind === "open_questions") {
      return ContextLayer.refArrayEquals(a.payload, b.payload, (x, y) =>
        x.equals(y),
      );
    }
    return false;
  }

  private static refArrayEquals<T>(
    a: readonly T[],
    b: readonly T[],
    eq: (x: T, y: T) => boolean,
  ): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const x = a[i];
      const y = b[i];
      if (x === undefined || y === undefined) return false;
      if (!eq(x, y)) return false;
    }
    return true;
  }
}
