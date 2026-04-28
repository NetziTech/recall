import type {
  TaskInputWire,
  TaskOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driven (output) port: protocol-facing facade over the memory
 * module's task lifecycle use cases (create / update / get / list /
 * delete).
 *
 * The composition root binds this facade to a discriminator-aware
 * adapter that dispatches on `input.action`. The wire output union
 * tag matches the input `action` exactly so the JSON serializer
 * does not need any conditional logic.
 *
 * Contract:
 * - The action discriminator is mandatory (validated by Zod at the
 *   adapter boundary). The facade trusts it.
 * - The action MUST be reflected verbatim in the output union tag.
 *   This invariant is asserted at the type level by the structure of
 *   `TaskOutputWire` (the `action` field of each branch literally
 *   names the action it answers to).
 */
export interface TrackTaskFacade {
  task(input: TaskInputWire): Promise<TaskOutputWire>;
}
