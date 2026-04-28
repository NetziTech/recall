import type { CommandOutput } from "../../../domain/value-objects/command-output.ts";
import type { CliInvocation } from "../../dtos/cli-invocation.dto.ts";

/**
 * Driving (input) port: run one parsed CLI invocation.
 *
 * Implements the discriminated-union dispatch documented in
 * `application/dtos/cli-invocation.dto.ts`. The implementation
 * (`RunCliCommandUseCase`) routes each variant to the matching
 * `CommandHandler` and returns the resulting `CommandOutput` VO.
 *
 * Why a single port and not 20 separate ones:
 *   - The CLI catalog is small and stable. A monolithic dispatch
 *     port keeps the application surface tidy and avoids 20 imports
 *     in the entrypoint adapter.
 *   - Each command is still implemented by its own `CommandHandler`
 *     class, so SOLID-SRP / SOLID-OCP are preserved at the handler
 *     level. Adding a new command means: (a) extending the
 *     `CliInvocation` union, (b) writing a new handler, (c)
 *     registering it in the use-case constructor.
 */
export interface RunCliCommand {
  run(invocation: CliInvocation): Promise<CommandOutput>;
}
