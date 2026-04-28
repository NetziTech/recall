import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum number of characters allowed in a tool description.
 *
 * The number is an ergonomic cap, not a protocol limit: the JSON-RPC
 * spec does not bound the `description` field. Two thousand characters
 * give enough room for the multi-paragraph "cuando lo llama Claude"
 * blurbs documented in `docs/02-protocolo-mcp.md` §4 while keeping the
 * tools/list response payload small enough to fit comfortably in a
 * client's context window when it enumerates the registry on startup.
 */
const TOOL_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * Value object representing the human-readable description of an MCP
 * tool — the prose Claude reads when deciding whether to call the tool.
 *
 * Mirrors the descriptive text shown alongside each tool in
 * `docs/02-protocolo-mcp.md` §4. The description is the *single most
 * important text* in the protocol after the tool name itself: it is
 * what nudges the model towards the right tool at the right moment, so
 * the domain owns the invariants that keep it usable (non-empty,
 * single-line-friendly bound).
 *
 * Invariants (in addition to those of `NonEmptyString`):
 * - The trimmed length is at most `TOOL_DESCRIPTION_MAX_LENGTH`.
 *
 * Equality:
 * - Inherited from `NonEmptyString`: same trimmed text, same concrete
 *   subclass.
 */
export class ToolDescription extends NonEmptyString {
  private constructor(value: string) {
    super(value);
  }

  /**
   * Builds a `ToolDescription` from a raw string. Performs the
   * `NonEmptyString` checks plus the length cap.
   */
  public static override create(raw: string): ToolDescription {
    if (typeof raw !== "string") {
      throw new InvalidInputError("tool description must be a string", {
        field: "tool_description",
      });
    }
    const trimmed = NonEmptyString.normalize(raw, "tool_description");
    if (trimmed.length > TOOL_DESCRIPTION_MAX_LENGTH) {
      throw new InvalidInputError(
        `tool description must be at most ${String(TOOL_DESCRIPTION_MAX_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "tool_description" },
      );
    }
    return new ToolDescription(trimmed);
  }

  /** Exposes the configured maximum length for documentation/tests. */
  public static maxLength(): number {
    return TOOL_DESCRIPTION_MAX_LENGTH;
  }
}
