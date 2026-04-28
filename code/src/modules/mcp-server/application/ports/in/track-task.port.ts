import type {
  TaskInputWire,
  TaskOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driving (input) port for the `mem.task` tool.
 *
 * Implements the wire contract documented in
 * `docs/02-protocolo-mcp.md` §4.5: a unified CRUD facade for tasks,
 * dispatched on the `action` discriminator (`create | update | get |
 * list | delete`). The Zod schema in `infrastructure/validation/`
 * narrows the input per action and the output union is exhaustive,
 * so adapters never deal with `unknown` shapes.
 *
 * Why one port (and not five):
 * - The protocol describes a single tool name (`mem.task`) and
 *   adapters dispatch on `action` at parse time. Splitting into
 *   five ports here would push the dispatch back into the JSON-RPC
 *   adapter without any architectural benefit; the use case behind
 *   the facade does the action-routing.
 */
export interface TrackTask {
  task(input: TaskInputWire): Promise<TaskOutputWire>;
}
