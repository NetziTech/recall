import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type {
  TaskInputWire,
  TaskOutputWire,
} from "../dtos/wire-types.dto.ts";
import type { TrackTask } from "../ports/in/track-task.port.ts";
import type { TrackTaskFacade } from "../ports/out/track-task-facade.port.ts";

/**
 * Use case implementing the `mem.task` driving port.
 *
 * Forwards the validated wire DTO to the `TrackTaskFacade` output
 * port. The facade dispatches on `input.action` and returns the
 * corresponding branch of the discriminated union.
 *
 * The use case logs the action and the affected `task_id` (when the
 * branch carries one). Action-conditional logging is encoded with a
 * type-safe switch so adding a new action surfaces as a TS error
 * rather than a silent log gap.
 */
export class TrackTaskUseCase implements TrackTask {
  public constructor(
    private readonly facade: TrackTaskFacade,
    private readonly logger: Logger,
  ) {}

  public async task(input: TaskInputWire): Promise<TaskOutputWire> {
    this.logger.debug(
      { tool: "mem.task", action: input.action },
      "tool invocation started",
    );
    const output = await this.facade.task(input);
    this.logger.info(
      {
        tool: "mem.task",
        action: output.action,
        ...this.contextFromOutput(output),
      },
      "tool invocation completed",
    );
    return output;
  }

  private contextFromOutput(
    output: TaskOutputWire,
  ): Readonly<Record<string, unknown>> {
    switch (output.action) {
      case "create":
      case "update":
        return { taskId: output.task_id };
      case "get":
        return { taskId: output.task.id };
      case "list":
        return { count: output.tasks.length };
      case "delete":
        return { deleted: output.deleted };
    }
  }
}
