import type { Logger } from "../../../../../shared/application/ports/logger.port.ts";
import type { CommandOutput } from "../../../domain/value-objects/command-output.ts";
import { CommandOutput as CommandOutputClass } from "../../../domain/value-objects/command-output.ts";
import type { CliResetQueueInvocation } from "../../dtos/cli-invocation.dto.ts";
import type { CommandHandler } from "../../ports/in/command-handler.port.ts";
import type { ResetQueueFacade } from "../../ports/out/embedding-queue-facade.port.ts";
import { resolveRootPath } from "./root-path.ts";

/**
 * Handler for `recall reset-queue [--threshold <n>]`.
 *
 * Recovery for B-MCP-7
 * ([issue #24](https://github.com/NetziTech/recall/issues/24)). The
 * worker prior to `0.1.2-beta.4` would mark items as permanent failure
 * during a fastembed cold-start; this command clears those items so the
 * fixed worker can re-try them.
 *
 * Output:
 *   - exit code 0 always (running on a healthy queue is a no-op).
 *   - stdout: a single human-readable line in Spanish summarising the
 *     row count and the threshold applied.
 */
export class ResetQueueCommandHandler
  implements CommandHandler<"reset-queue">
{
  public readonly command = "reset-queue" as const;

  public constructor(
    private readonly facade: ResetQueueFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(
    invocation: CliResetQueueInvocation,
  ): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.reset({
      rootPath,
      threshold: invocation.threshold,
    });

    this.logger.info(
      {
        rootPath,
        threshold: result.thresholdApplied,
        resetCount: result.resetCount,
      },
      "reset-queue command completed",
    );

    const lines = [
      `Cola de embeddings restablecida.`,
      `  Filas restablecidas: ${String(result.resetCount)}`,
      `  Umbral aplicado (attempts >=): ${String(result.thresholdApplied)}`,
    ];
    if (result.resetCount === 0) {
      lines.push(
        `  Nada que hacer: ninguna entrada superaba el umbral.`,
      );
    } else {
      lines.push(
        `  El worker re-intentara estas entradas en su proximo drain.`,
      );
    }
    return CommandOutputClass.stdoutOnly(`${lines.join("\n")}\n`);
  }
}
