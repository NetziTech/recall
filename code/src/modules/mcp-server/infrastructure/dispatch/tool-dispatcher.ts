import type { z, ZodType, infer as ZInfer } from "zod";

import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { CheckHealth } from "../../application/ports/in/check-health.port.ts";
import type { GetContext } from "../../application/ports/in/get-context.port.ts";
import type { InitWorkspace } from "../../application/ports/in/init-workspace.port.ts";
import type { RecallMemory } from "../../application/ports/in/recall-memory.port.ts";
import type { Remember } from "../../application/ports/in/remember.port.ts";
import type { TrackTask } from "../../application/ports/in/track-task.port.ts";
import { ToolDisabledError } from "../../domain/errors/tool-disabled-error.ts";
import { UnknownToolError } from "../../domain/errors/unknown-tool-error.ts";
import type { ToolRegistry } from "../../domain/services/tool-registry.ts";
import {
  ToolName,
  type ToolNameKind,
} from "../../domain/value-objects/tool-name.ts";
import {
  InvalidParamsError,
  type InvalidParamsIssue,
} from "../errors/invalid-params-error.ts";
import {
  ContextInputSchema,
  HealthInputSchema,
  InitInputSchema,
  RecallInputSchema,
  RememberInputSchema,
  TaskInputSchema,
} from "../validation/index.ts";

/**
 * Bag of the six MVP input ports the dispatcher orchestrates.
 *
 * Each field corresponds 1:1 to one of the wire tool names listed in
 * `docs/02-protocolo-mcp.md` §2. The composition root populates the
 * bag with use-case instances; the dispatcher does not know how
 * those instances were built.
 */
export interface ToolUseCases {
  readonly init: InitWorkspace;
  readonly context: GetContext;
  readonly recall: RecallMemory;
  readonly remember: Remember;
  readonly task: TrackTask;
  readonly health: CheckHealth;
}

/**
 * Parsed shape of a successful dispatch — the JSON value the
 * adapter ships in the JSON-RPC `result` envelope.
 *
 * Typed as `unknown` because the result shape varies per tool; the
 * adapter does not need to inspect it before serialisation.
 * Use-case outputs are wire-shaped DTOs (see
 * `application/dtos/wire-types.dto.ts`); JSON serialisation produces
 * exactly the spec output without further translation.
 */
export type ToolDispatchResult = unknown;

/**
 * Adapter-tier dispatcher: turns a `(toolName, rawArgs)` pair into
 * the validated, routed, executed result.
 *
 * Steps:
 * 1. Validate the wire string `toolName` via the `ToolName` VO.
 *    Unknown shape → `UnknownToolError` (the VO factory raises an
 *    `InvalidInputError` which the JSON-RPC adapter translates).
 * 2. Look up the registration in the `ToolRegistry`. Missing
 *    registration → `UnknownToolError`. Disabled registration →
 *    `ToolDisabledError`.
 * 3. Look up the Zod schema for this tool and parse `rawArgs`.
 *    Failure → `InvalidParamsError` carrying the structured issues
 *    so the adapter can attach them to `error.data`.
 * 4. Cast the parsed value into the wire DTO and call the matching
 *    use case.
 * 5. Update the registry's invocation bookkeeping. Bookkeeping is
 *    side-channel: a failure here MUST NOT propagate as a tool-
 *    invocation failure (the call already succeeded), so we wrap
 *    it in a try/catch and let the error fall on the floor (the
 *    domain aggregate's `recordInvocation` is total under its
 *    preconditions so the catch is purely defensive).
 *
 * Why the dispatcher lives in `infrastructure/`:
 * - Zod is an infrastructure dependency; pulling it into
 *   `application/` would cross the layering boundary
 *   (`docs/12 §1.1`). The dispatcher is the seam where validation
 *   happens, so it belongs here.
 * - The schemas themselves live in `infrastructure/validation/`,
 *   which the dispatcher imports directly.
 *
 * Why exhaustive instead of registry-based dispatch:
 * - The dispatcher knows at compile time which six tools exist; a
 *   `Record<ToolNameKind, (args: unknown) => Promise<unknown>>`
 *   built once in the constructor reuses the type system to enforce
 *   that adding a new tool to the `ToolNameKind` union forces the
 *   dispatcher to grow a matching branch. This catches "added a
 *   tool to the protocol but forgot to wire it" failures at TS
 *   compile time rather than at runtime.
 */
export class ToolDispatcher {
  private readonly handlers: Readonly<
    Record<ToolNameKind, (args: unknown) => Promise<ToolDispatchResult>>
  >;

  public constructor(
    private readonly registry: ToolRegistry,
    useCases: ToolUseCases,
  ) {
    this.handlers = Object.freeze({
      "mem.init": async (args: unknown): Promise<ToolDispatchResult> => {
        const parsed = parseInput(InitInputSchema, args, "mem.init");
        return useCases.init.init(parsed);
      },
      "mem.context": async (args: unknown): Promise<ToolDispatchResult> => {
        const parsed = parseInput(ContextInputSchema, args, "mem.context");
        return useCases.context.getContext(parsed);
      },
      "mem.recall": async (args: unknown): Promise<ToolDispatchResult> => {
        const parsed = parseInput(RecallInputSchema, args, "mem.recall");
        return useCases.recall.recall(parsed);
      },
      "mem.remember": async (args: unknown): Promise<ToolDispatchResult> => {
        const parsed = parseInput(RememberInputSchema, args, "mem.remember");
        return useCases.remember.remember(parsed);
      },
      "mem.task": async (args: unknown): Promise<ToolDispatchResult> => {
        const parsed = parseInput(TaskInputSchema, args, "mem.task");
        return useCases.task.task(parsed);
      },
      "mem.health": async (args: unknown): Promise<ToolDispatchResult> => {
        const parsed = parseInput(HealthInputSchema, args, "mem.health");
        return useCases.health.health(parsed);
      },
    });
  }

  public async dispatch(
    toolNameRaw: string,
    rawArgs: unknown,
    occurredAtMs: number,
  ): Promise<ToolDispatchResult> {
    // 1. Validate tool name shape (raises `InvalidInputError` from
    //    the `ToolName` VO factory if the shape is wrong; the
    //    JSON-RPC adapter routes that case to `UnknownToolError`
    //    territory so the wire code stays `-32601`).
    let toolName: ToolName;
    try {
      toolName = ToolName.create(toolNameRaw);
    } catch (cause) {
      // The VO raised because the wire string is not one of the
      // six known literals. Same outcome as a missing registry
      // entry: `-32601 METHOD_NOT_FOUND`.
      throw new UnknownToolError(toolNameRaw, { cause });
    }

    // 2. Registry lookup.
    const registration = this.registry.findByName(toolName);
    if (registration === null) {
      throw new UnknownToolError(toolNameRaw);
    }
    if (registration.isDisabled()) {
      throw new ToolDisabledError(toolName);
    }

    // 3. Validate args against the per-tool Zod schema and
    //    dispatch.
    const handler = this.handlers[toolName.kind];
    const result = await handler(rawArgs);

    // 4. Bookkeeping. The aggregate's `recordInvocation` is total
    //    under its preconditions; we still wrap defensively so a
    //    bookkeeping bug never overrides a successful tool call.
    try {
      registration.recordInvocation({
        occurredAt: Timestamp.now(occurredAtMs),
      });
    } catch {
      // Intentionally swallowed: bookkeeping is best-effort.
    }

    return result;
  }
}

/**
 * Parses `args` against `schema` and re-throws Zod failures as
 * `InvalidParamsError` so the JSON-RPC adapter has the structured
 * issues at hand for `error.data`.
 */
function parseInput<TSchema extends ZodType>(
  schema: TSchema,
  args: unknown,
  toolName: string,
): ZInfer<TSchema> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new InvalidParamsError(
      `params for tool "${toolName}" failed validation`,
      { details: zodIssuesToInvalidParamsIssues(parsed.error.issues) },
    );
  }
  return parsed.data;
}

function zodIssuesToInvalidParamsIssues(
  issues: readonly z.core.$ZodIssue[],
): readonly InvalidParamsIssue[] {
  const out: InvalidParamsIssue[] = [];
  for (const issue of issues) {
    out.push({
      path: Object.freeze(stringifyPath(issue.path)),
      message: issue.message,
      code: issue.code,
    });
  }
  return Object.freeze(out);
}

/**
 * Coerces a Zod-issue path (whose elements are `PropertyKey =
 * string | number | symbol`) into the wire-friendly `string |
 * number` shape. Symbol keys are stringified via `String(...)`
 * because the wire envelope is JSON and JSON has no symbol type.
 * Symbol keys do not appear in any of our schemas (they target
 * plain JSON), so this branch is defensive but cheap.
 */
function stringifyPath(
  path: readonly PropertyKey[],
): readonly (string | number)[] {
  const out: (string | number)[] = [];
  for (const segment of path) {
    if (typeof segment === "string" || typeof segment === "number") {
      out.push(segment);
      continue;
    }
    out.push(String(segment));
  }
  return out;
}
