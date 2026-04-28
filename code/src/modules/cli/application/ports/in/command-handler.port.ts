import type { CommandOutput } from "../../../domain/value-objects/command-output.ts";
import type { CliInvocation } from "../../dtos/cli-invocation.dto.ts";

/**
 * Internal (intra-application) port that every command-specific
 * handler implements. The `RunCliCommandUseCase` keeps a registry
 * keyed on `CommandNameValue` and dispatches each invocation to the
 * matching handler.
 *
 * Generic in the variant so handlers can narrow `invocation` to
 * their specific `Cli<Name>Invocation` shape without an unsafe cast:
 *
 * ```typescript
 * class HealthCommandHandler implements CommandHandler<"health"> {
 *   public handle(invocation: Cli HealthInvocation): Promise<CommandOutput> {
 *     // ...
 *   }
 * }
 * ```
 *
 * Why this is a *port* and not just an interface:
 *   - The CLI use case injects the handlers via constructor; the
 *     adapter (`CliEntrypoint`) wires concrete handlers to facades
 *     in the composition root. Without a port, the use case would
 *     have to instantiate handlers itself, breaking DIP.
 */
export interface CommandHandler<TCommand extends CliInvocation["command"]> {
  readonly command: TCommand;
  handle(
    invocation: Extract<CliInvocation, { readonly command: TCommand }>,
  ): Promise<CommandOutput>;
}

/**
 * Type-erased view of a `CommandHandler`. The use case stores
 * handlers in a `Map<CommandName, ErasedCommandHandler>` because
 * TypeScript cannot express "a heterogeneous map of `CommandHandler<T>`
 * indexed by `T`" without ceremony.
 */
export interface ErasedCommandHandler {
  readonly command: CliInvocation["command"];
  handle(invocation: CliInvocation): Promise<CommandOutput>;
}
