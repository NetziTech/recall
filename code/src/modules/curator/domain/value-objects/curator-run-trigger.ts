import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `CuratorRunTriggerKind` values. Single source of truth
 * for the union below — adding a new trigger is a one-line change here.
 *
 * Mirrors the three entry points documented in
 * `docs/05-memoria-decay.md` §6 ("Cuando corre"):
 *
 * - `scheduled`: time-based / turn-count auto run (every
 *   `auto_run_every_n_turns` calls or every 24h idle).
 * - `manual`: explicit `mem.curator_run` from the client.
 * - `session_close`: triggered by the session-rollup at idle timeout
 *   (`docs/05-memoria-decay.md` §7).
 */
const CURATOR_RUN_TRIGGERS = ["scheduled", "manual", "session_close"] as const;

export type CuratorRunTriggerKind = (typeof CURATOR_RUN_TRIGGERS)[number];

/**
 * Value object representing what caused a curator run to start.
 *
 * Carried on every `CuratorRun` aggregate so the `curator_runs` audit
 * trail can be filtered later ("how many of my recent runs were
 * triggered by `mem.curator_run` vs by the scheduler?"). The trigger
 * also influences subscriber behaviour: a `manual` run is allowed to
 * report findings synchronously via the JSON-RPC response, while a
 * `scheduled` run only logs them.
 *
 * Invariants:
 * - The wrapped `kind` is always one of the three known values.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `CuratorRunTrigger` are equal iff they share the same `kind`.
 */
export class CuratorRunTrigger {
  private constructor(public readonly kind: CuratorRunTriggerKind) {}

  public static scheduled(): CuratorRunTrigger {
    return new CuratorRunTrigger("scheduled");
  }

  public static manual(): CuratorRunTrigger {
    return new CuratorRunTrigger("manual");
  }

  public static sessionClose(): CuratorRunTrigger {
    return new CuratorRunTrigger("session_close");
  }

  /**
   * Builds a `CuratorRunTrigger` from a raw string. Used when reading
   * `curator_runs` rows that store the trigger as a TEXT column.
   */
  public static create(raw: string): CuratorRunTrigger {
    if (typeof raw !== "string") {
      throw new InvalidInputError("curator run trigger must be a string", {
        field: "trigger",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("curator run trigger must not be empty", {
        field: "trigger",
      });
    }
    if (!CuratorRunTrigger.isKind(trimmed)) {
      throw new InvalidInputError(
        `curator run trigger must be one of "scheduled" | "manual" | "session_close" (got: "${raw}")`,
        { field: "trigger" },
      );
    }
    return new CuratorRunTrigger(trimmed);
  }

  public static isKind(candidate: string): candidate is CuratorRunTriggerKind {
    for (const known of CURATOR_RUN_TRIGGERS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public isScheduled(): boolean {
    return this.kind === "scheduled";
  }

  public isManual(): boolean {
    return this.kind === "manual";
  }

  public isSessionClose(): boolean {
    return this.kind === "session_close";
  }

  public toString(): CuratorRunTriggerKind {
    return this.kind;
  }

  public equals(other: CuratorRunTrigger): boolean {
    return this.kind === other.kind;
  }
}
