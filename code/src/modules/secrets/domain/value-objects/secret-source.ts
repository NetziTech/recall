import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `SecretSourceKind` values. Single source of truth for the
 * union below — adding a new source category is a one-line change here.
 *
 * The kinds reflect the three places the scanner can be invoked from
 * (matching the defence-in-depth layers documented in
 * `docs/11-seguridad-modos.md` §6):
 *
 * - `text`: free-form payload received via a tool argument (e.g. the
 *   `rationale` of `mem.record_decision`). The accompanying `field`
 *   names the JSON path so the audit log can pinpoint the input slot.
 * - `filePath`: a path string the scanner is asked to canonicalise
 *   (Capa 2 — Path sanitizer). The `path` carries the verbatim input
 *   for diagnostics; downstream consumers MUST treat it as untrusted
 *   text (it has not yet been canonicalised when the source is built).
 * - `logLine`: a line emitted by the host process being audited (Capa 4
 *   pre-commit hook walks log files). The `line` is a 1-based index
 *   into the file; combined with the file context kept by the adapter,
 *   it lets operators jump to the offending line.
 */
const SECRET_SOURCE_KINDS = ["text", "filePath", "logLine"] as const;

export type SecretSourceKind = (typeof SECRET_SOURCE_KINDS)[number];

/**
 * Discriminated union describing the *origin* of the text the scanner
 * inspected. The shape varies by kind so each variant only carries the
 * fields meaningful in its context — the compiler narrows on `kind` and
 * downstream consumers can branch with `default: never` exhaustiveness.
 */
export type SecretSource =
  | { readonly kind: "text"; readonly field: string }
  | { readonly kind: "filePath"; readonly path: string }
  | { readonly kind: "logLine"; readonly line: number };

/**
 * Maximum length, in characters, of the descriptive `field` slot on a
 * `text` source. Field names look like `"rationale"` or
 * `"context.0.summary"` — bounded to keep audit-log payloads small.
 */
const MAX_FIELD_NAME_LENGTH = 200;

/**
 * Maximum length, in characters, of the verbatim `path` slot on a
 * `filePath` source. The cap is intentionally larger than the typical
 * filesystem maximum (4 KiB) to absorb pathological inputs without
 * truncating them silently.
 */
const MAX_PATH_LENGTH = 4096;

/**
 * Factory namespace for `SecretSource` values.
 *
 * The discriminated union is exposed as a plain `type` so consumers can
 * destructure on `kind`. The `SecretSources` namespace centralises the
 * validation rules in one place so every call-site builds a well-formed
 * source.
 *
 * Equality is value-based and lives on the helper `equals` method below.
 */
export const SecretSources = {
  text(field: string): SecretSource {
    if (typeof field !== "string") {
      throw new InvalidInputError("source field must be a string", {
        field: "source.field",
      });
    }
    const trimmed = field.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("source field must not be empty", {
        field: "source.field",
      });
    }
    if (trimmed.length > MAX_FIELD_NAME_LENGTH) {
      throw new InvalidInputError(
        `source field must be at most ${String(MAX_FIELD_NAME_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "source.field" },
      );
    }
    return Object.freeze({ kind: "text", field: trimmed });
  },

  filePath(path: string): SecretSource {
    if (typeof path !== "string") {
      throw new InvalidInputError("source path must be a string", {
        field: "source.path",
      });
    }
    if (path.length === 0) {
      throw new InvalidInputError("source path must not be empty", {
        field: "source.path",
      });
    }
    if (path.length > MAX_PATH_LENGTH) {
      throw new InvalidInputError(
        `source path must be at most ${String(MAX_PATH_LENGTH)} characters (got: ${String(path.length)})`,
        { field: "source.path" },
      );
    }
    if (path.includes("\0")) {
      throw new InvalidInputError(
        "source path must not contain NUL bytes",
        { field: "source.path" },
      );
    }
    return Object.freeze({ kind: "filePath", path });
  },

  logLine(line: number): SecretSource {
    if (!Number.isFinite(line)) {
      throw new InvalidInputError("source log line must be a finite number", {
        field: "source.line",
      });
    }
    if (!Number.isInteger(line)) {
      throw new InvalidInputError("source log line must be an integer", {
        field: "source.line",
      });
    }
    if (line < 1) {
      throw new InvalidInputError(
        "source log line must be 1-based (got: 0 or negative)",
        { field: "source.line" },
      );
    }
    return Object.freeze({ kind: "logLine", line });
  },

  /**
   * Type guard for raw strings against the source kind union.
   */
  isKind(candidate: string): candidate is SecretSourceKind {
    for (const known of SECRET_SOURCE_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  },

  /**
   * Value-based equality across the discriminated variants. Returns
   * `true` iff the two sources share the same `kind` AND the same
   * variant-specific payload.
   */
  equals(left: SecretSource, right: SecretSource): boolean {
    if (left.kind !== right.kind) return false;
    switch (left.kind) {
      case "text":
        // `right.kind` is narrowed to `"text"` by the equality check
        // above; TypeScript needs the explicit assertion through the
        // switch to track that.
        return right.kind === "text" && left.field === right.field;
      case "filePath":
        return right.kind === "filePath" && left.path === right.path;
      case "logLine":
        return right.kind === "logLine" && left.line === right.line;
      default: {
        const exhaustive: never = left;
        return exhaustive;
      }
    }
  },
} as const;
