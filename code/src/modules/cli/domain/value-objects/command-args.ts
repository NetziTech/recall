/**
 * Value object encapsulating the *raw, unparsed* arguments a CLI
 * sub-command was invoked with.
 *
 * Why `unknown` and not a richer type:
 *
 * The shape of the args is wildly heterogeneous across commands: `init`
 * takes optional `--workspace` and `--mode`; `unlock` takes `--workspace`
 * plus reads stdin for the key; `audit` takes `--check-secrets` and
 * `--strict`; `import-handoff` takes paths; `export`/`import` take
 * file paths plus options; etc. (See `docs/07-instalacion.md` §7.)
 *
 * Modelling each of those as a discriminated union in the domain would:
 *   - duplicate the parser's job (the parser already produces typed
 *     values for the use case to consume);
 *   - lock the domain to one specific argument syntax (commander.js,
 *     yargs, custom) — exactly the kind of infrastructure leakage the
 *     hexagonal architecture forbids;
 *   - require the domain to know the help text, default values, and
 *     option aliases of every command, which are concerns of the CLI
 *     framework adapter, not of the business model.
 *
 * Instead the domain treats the args as an opaque payload (`unknown`)
 * that travels with the `CommandExecution` for audit purposes only. The
 * application-layer parser is the ONLY layer that destructures it; that
 * parser receives `unknown` and produces strongly-typed use-case input
 * via Zod schemas (per the project type-safety rules in
 * `docs/12-lineamientos-arquitectura.md` §1.6).
 *
 * Invariants:
 * - The wrapped `payload` is whatever the application parser captured.
 *   The domain makes no claim about its shape.
 * - Instances are immutable from the domain's point of view: the
 *   factory does not freeze the payload (we cannot inspect its shape)
 *   but the VO never mutates it.
 *
 * Equality:
 * - Two `CommandArgs` are equal iff their underlying `payload` is
 *   reference-equal. We deliberately do not perform deep-equality:
 *   the domain has no schema to compare against, so a structural
 *   comparison would either be unreliable (custom `===` on `unknown`)
 *   or require a serialiser (out of scope for a domain VO). Reference
 *   equality is the only honest answer.
 */
export class CommandArgs {
  private constructor(private readonly payload: unknown) {}

  /**
   * Wraps an opaque parsed-args payload. The factory accepts `unknown`
   * because the domain genuinely does not know — and does not care
   * about — its shape; see the class docstring for the rationale.
   */
  public static of(payload: unknown): CommandArgs {
    return new CommandArgs(payload);
  }

  /**
   * Convenience factory for commands invoked without any arguments
   * (e.g. `mcp-memoria server`). The wrapped payload is `null` so
   * downstream consumers can branch on `raw() === null`.
   */
  public static empty(): CommandArgs {
    return new CommandArgs(null);
  }

  /**
   * Returns the wrapped payload as `unknown`. The caller (always the
   * application-layer parser) is responsible for narrowing it via Zod
   * before consumption.
   */
  public raw(): unknown {
    return this.payload;
  }

  public equals(other: CommandArgs): boolean {
    return this.payload === other.payload;
  }
}
