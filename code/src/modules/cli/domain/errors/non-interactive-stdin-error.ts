import { CliDomainError } from "./cli-domain-error.ts";

/**
 * Raised when an interactive prompt is requested but stdin is not a
 * TTY (e.g. piped input, a closed `/dev/null`, or a wrapper that
 * detached the controlling terminal).
 *
 * Why a dedicated error type instead of letting `node:readline`'s
 * promise hang silently (B-CLI-4):
 *   - When stdin is `/dev/null` and no `--non-interactive` flag was
 *     passed, `rl.question(...)` never resolves: nothing pushes data
 *     to the readline buffer, and once stdin is fully drained the
 *     readline interface releases its hold on the event loop. Node
 *     then exits with code 0 leaving the promise pending forever.
 *   - The user sees only a partial prompt banner (`Nombre legible
 *     del workspace [Workspace]: `) and a clean exit, with no
 *     workspace created. This is the worst possible failure mode:
 *     silent, looks-like-success, no diagnostic.
 *
 * The fix detects the non-TTY case BEFORE awaiting readline and
 * raises this error so the entrypoint adapter maps it to
 * `usageError` (2) with a stderr message that tells the caller
 * exactly how to fix it (`--non-interactive` flag).
 *
 * Invariants:
 * - `code` is the stable identifier `cli.stdin-not-a-tty`.
 * - `jsonRpcCode` is `null` per `CliDomainError`'s contract — this
 *   error only ever surfaces from a `recall <command>` invocation
 *   on a terminal, never from an MCP JSON-RPC request.
 */
export class NonInteractiveStdinError extends CliDomainError {
  public readonly code = "cli.stdin-not-a-tty";
  public readonly jsonRpcCode: number | null = null;

  public constructor(promptText: string) {
    super(
      `stdin no es un TTY: no se puede pedir "${promptText.trim()}". ` +
        `Usa --non-interactive junto con las banderas requeridas ` +
        `(p. ej. --display-name, --mode) o ejecuta el comando desde una terminal interactiva.`,
    );
  }
}
