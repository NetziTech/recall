import type { Readable, Writable } from "node:stream";

import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { BufferOverflowError } from "../errors/buffer-overflow-error.ts";
import type {
  JsonRpcHandler,
  JsonRpcHandlerResult,
} from "./json-rpc-handler.ts";

/**
 * Default cap on the size of the line-delimited frame accumulator,
 * in JavaScript-string code units. Chosen at 10 MiB
 * (`10 * 1024 * 1024 = 10_485_760`). Rationale:
 * - Typical MCP JSON-RPC frames are well under 100 KB. Even a
 *   `mem.recall` response with the maximum `top_k` and verbose
 *   `summary`s sits under 1 MB once tokens are counted.
 * - 10 MiB is roughly 100x the realistic worst-case frame, leaving
 *   ample headroom for batched or unusually large `mem.remember`
 *   payloads while still catching unbounded streams in the
 *   second-to-low MB range.
 * - Configurable per-instance via
 *   {@link StdioJsonRpcServerOptions.maxBufferBytes} and overridable
 *   at the composition root via the `RECALL_MCP_MAX_BUFFER_BYTES`
 *   environment variable (see `composition-root.ts`).
 */
export const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * Options for {@link StdioJsonRpcServer}. All fields are optional
 * and have safe defaults; the bag exists so callers can opt in to
 * one knob without spelling out the others.
 */
export interface StdioJsonRpcServerOptions {
  /**
   * Maximum size of the in-memory frame accumulator before a
   * {@link BufferOverflowError} is raised and the transport is
   * closed. Defaults to {@link DEFAULT_MAX_BUFFER_BYTES} (10 MiB).
   *
   * MUST be a positive finite integer; any other value is rejected
   * at construction time. The unit is JavaScript-string code units
   * (UTF-16); see the {@link BufferOverflowError} docstring for the
   * mapping to UTF-8 bytes.
   */
  readonly maxBufferBytes?: number;
}

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
 * - The adapter enforces a configurable cap on the size of the
 *   frame accumulator (W-3.1-SEC-M1). When an adversarial client
 *   streams bytes without a newline delimiter, the accumulator
 *   would otherwise grow without bound — a memory-exhaustion DoS
 *   vector. On overflow, the transport is closed and the
 *   `start()` promise rejects with {@link BufferOverflowError};
 *   the buffer is dropped to release memory. See the
 *   `BufferOverflowError` docstring for the discard-vs-close
 *   policy rationale.
 *
 * Concurrency:
 * - Frames are processed sequentially. The MVP does not need
 *   pipelining; if a future workload demands it, the dispatcher
 *   is already async and could be wrapped in a queue.
 */
export class StdioJsonRpcServer {
  private buffer: string;
  private closed: boolean;
  private readonly maxBufferBytes: number;

  public constructor(
    private readonly handler: JsonRpcHandler,
    private readonly stdin: Readable,
    private readonly stdout: Writable,
    private readonly logger: Logger,
    options?: StdioJsonRpcServerOptions,
  ) {
    this.buffer = "";
    this.closed = false;
    this.maxBufferBytes = resolveMaxBufferBytes(options?.maxBufferBytes);
  }

  /**
   * Starts reading frames from stdin. Returns a promise that
   * resolves when stdin closes (or rejects if a fatal write
   * failure or buffer overflow happens).
   */
  public async start(): Promise<void> {
    this.stdin.setEncoding("utf8");
    return new Promise<void>((resolve, reject) => {
      const teardown = (): void => {
        this.stdin.removeListener("data", onData);
        this.stdin.removeListener("end", onEnd);
        this.stdin.removeListener("error", onError);
      };
      const onData = (chunk: string | Buffer): void => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        this.buffer += text;
        // Cap the accumulator BEFORE attempting to drain. If the
        // newest chunk did not contain a delimiter and the running
        // buffer is now over the cap, the client is either buggy or
        // adversarial; either way, refuse to grow further.
        if (
          !this.buffer.includes("\n") &&
          this.buffer.length > this.maxBufferBytes
        ) {
          const bufferedBytes = this.buffer.length;
          // Drop the buffer NOW so the rejection path doesn't keep
          // the oversized string alive on the closure.
          this.buffer = "";
          this.closed = true;
          const overflow = new BufferOverflowError({
            maxBufferBytes: this.maxBufferBytes,
            bufferedBytes,
          });
          this.logger.warn(
            {
              err: serialiseError(overflow),
              maxBufferBytes: this.maxBufferBytes,
              bufferedBytes,
            },
            "stdio frame accumulator exceeded cap; closing transport",
          );
          teardown();
          reject(overflow);
          return;
        }
        // Process every newline-terminated frame the buffer holds
        // right now. Anything trailing without a newline is left in
        // the buffer for the next chunk.
        void this.drainFrames().catch((err: unknown) => {
          this.logger.error(
            { err: serialiseError(err) },
            "stdio adapter frame loop failed",
          );
          this.closed = true;
          teardown();
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
        teardown();
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
 * Validates the constructor-supplied cap and falls back to
 * {@link DEFAULT_MAX_BUFFER_BYTES} when the option is absent. The
 * function is total: any non-positive, non-finite, or non-integer
 * supplied value is rejected with a `TypeError` at construction
 * time so the failure surfaces immediately and not on the first
 * adversarial chunk.
 */
function resolveMaxBufferBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_BUFFER_BYTES;
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(
      `StdioJsonRpcServer: maxBufferBytes must be a positive integer (received ${String(value)})`,
    );
  }
  return value;
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
