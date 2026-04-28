import type { Readable, Writable } from "node:stream";

import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type {
  JsonRpcHandler,
  JsonRpcHandlerResult,
} from "./json-rpc-handler.ts";

/**
 * Line-delimited JSON-RPC adapter for the MCP server.
 *
 * Wire format:
 * - Each request is a single line of UTF-8 JSON terminated by `\n`.
 * - Responses are written back to stdout, also as single lines.
 * - The exact framing matches the JSON-RPC line protocol used by
 *   the MCP stdio transport. The MCP SDK uses the same framing.
 *
 * Why this adapter is hand-rolled (and not delegated to the SDK):
 * - The SDK is a transport-level convenience; the dispatcher and
 *   handler in this module are already the protocol implementation.
 *   Wrapping the SDK on top would force a second translation step
 *   between SDK request types and our dispatcher contract.
 * - The hand-rolled adapter stays tiny: one frame parser, one
 *   error frame, one writer. Every concern not directly tied to
 *   the byte stream lives in `JsonRpcHandler`.
 *
 * Design constraints:
 * - The stdio adapter MUST NOT write anything to stdout that is
 *   not a JSON-RPC response. Logging routes via the injected
 *   `Logger` (the canonical adapter is `PinoLogger`, which sends
 *   warn/error/fatal to stderr per the port contract).
 * - The adapter does NOT enforce a max frame size; the caller
 *   (Node.js stdin) buffers and chunks reasonably for the small
 *   request sizes typical of MCP traffic.
 *
 * Concurrency:
 * - Frames are processed sequentially. The MVP does not need
 *   pipelining; if a future workload demands it, the dispatcher
 *   is already async and could be wrapped in a queue.
 */
export class StdioJsonRpcServer {
  private buffer: string;
  private closed: boolean;

  public constructor(
    private readonly handler: JsonRpcHandler,
    private readonly stdin: Readable,
    private readonly stdout: Writable,
    private readonly logger: Logger,
  ) {
    this.buffer = "";
    this.closed = false;
  }

  /**
   * Starts reading frames from stdin. Returns a promise that
   * resolves when stdin closes (or rejects if a fatal write
   * failure happens).
   */
  public async start(): Promise<void> {
    this.stdin.setEncoding("utf8");
    return new Promise<void>((resolve, reject) => {
      const onData = (chunk: string | Buffer): void => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        this.buffer += text;
        // Process every newline-terminated frame the buffer holds
        // right now. Anything trailing without a newline is left in
        // the buffer for the next chunk.
        void this.drainFrames().catch((err: unknown) => {
          this.logger.error(
            { err: serialiseError(err) },
            "stdio adapter frame loop failed",
          );
          this.closed = true;
          this.stdin.removeListener("data", onData);
          this.stdin.removeListener("end", onEnd);
          this.stdin.removeListener("error", onError);
          reject(toError(err));
        });
      };
      const onEnd = (): void => {
        // Process whatever remains in the buffer as a final frame
        // if it is non-empty. The wire spec terminates each frame
        // with a newline; an unterminated trailing chunk is treated
        // as an extra frame for robustness, mirroring how typical
        // line-protocol clients flush before close.
        void this.flushOnEnd()
          .then(() => {
            this.closed = true;
            resolve();
          })
          .catch((err: unknown) => {
            this.closed = true;
            reject(toError(err));
          });
      };
      const onError = (err: unknown): void => {
        this.closed = true;
        this.stdin.removeListener("data", onData);
        this.stdin.removeListener("end", onEnd);
        this.stdin.removeListener("error", onError);
        reject(toError(err));
      };
      this.stdin.on("data", onData);
      this.stdin.on("end", onEnd);
      this.stdin.on("error", onError);
    });
  }

  /**
   * Stops reading frames and unbinds the stdin listeners. Idempotent.
   * Useful for tests that drive the adapter through an ephemeral
   * `Readable.from(...)` source.
   */
  public stop(): void {
    if (this.closed) return;
    this.closed = true;
    this.stdin.removeAllListeners("data");
    this.stdin.removeAllListeners("end");
    this.stdin.removeAllListeners("error");
  }

  private async drainFrames(): Promise<void> {
    // Newline-delimited extraction. We loop until the buffer no
    // longer contains a `\n` boundary so multiple frames in a
    // single chunk are processed in order.
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1 && !this.closed) {
      const rawFrame = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const trimmed = rawFrame.trim();
      if (trimmed.length > 0) {
        await this.processFrame(trimmed);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private async flushOnEnd(): Promise<void> {
    if (this.closed) return;
    if (this.buffer.length === 0) return;
    const trimmed = this.buffer.trim();
    this.buffer = "";
    if (trimmed.length === 0) return;
    await this.processFrame(trimmed);
  }

  private async processFrame(rawFrame: string): Promise<void> {
    let result: JsonRpcHandlerResult;
    try {
      result = await this.handler.handle(rawFrame);
    } catch (err) {
      // The handler is supposed to convert every internal failure
      // into a wire envelope. Reaching this branch means the
      // handler itself blew up (a programming error). Log loudly
      // and skip; never crash the server because of one bad frame.
      this.logger.error(
        { err: serialiseError(err) },
        "json-rpc handler raised an unexpected exception",
      );
      return;
    }
    if (result.kind === "no-response") return;
    await this.writeResponseFrame(result);
  }

  private async writeResponseFrame(result: {
    readonly kind: "response";
    readonly response: unknown;
  }): Promise<void> {
    let serialised: string;
    try {
      serialised = JSON.stringify(result.response);
    } catch (err) {
      this.logger.error(
        { err: serialiseError(err) },
        "failed to serialise json-rpc response",
      );
      return;
    }
    if (typeof serialised !== "string") {
      this.logger.error("json-rpc response serialised to a non-string value");
      return;
    }
    return new Promise<void>((resolve, reject) => {
      this.stdout.write(`${serialised}\n`, (err) => {
        if (err !== undefined && err !== null) {
          reject(toError(err));
          return;
        }
        resolve();
      });
    });
  }
}

/**
 * Defensive `unknown → Error` widening for callbacks that surface
 * `unknown`. Keeps the rejection chain typed.
 */
function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(String(value));
}

/**
 * Best-effort error serialisation for log payloads. The `PinoLogger`
 * adapter already redacts sensitive keys; this function only
 * extracts the public shape (`name`, `message`, optional `code`)
 * without leaking `cause`, `stack` or arbitrary properties that
 * library errors may carry.
 */
function serialiseError(value: unknown): Readonly<Record<string, unknown>> {
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };
    const codeCandidate = (value as { readonly code?: unknown }).code;
    if (typeof codeCandidate === "string") out["code"] = codeCandidate;
    return Object.freeze(out);
  }
  return Object.freeze({ value: String(value) });
}
