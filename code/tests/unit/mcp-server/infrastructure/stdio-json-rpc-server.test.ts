import { describe, it, expect } from "vitest";
import { PassThrough, Readable } from "node:stream";

import {
  DEFAULT_MAX_BUFFER_BYTES,
  StdioJsonRpcServer,
  type StdioJsonRpcServerOptions,
} from "../../../../src/modules/mcp-server/infrastructure/transport/stdio-json-rpc-server.ts";
import { BufferOverflowError } from "../../../../src/modules/mcp-server/infrastructure/errors/buffer-overflow-error.ts";
import type {
  JsonRpcHandler,
  JsonRpcHandlerResult,
} from "../../../../src/modules/mcp-server/infrastructure/transport/json-rpc-handler.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";
import type { JsonRpcResponse } from "../../../../src/modules/mcp-server/infrastructure/transport/json-rpc-types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────

interface CapturedFrame {
  readonly raw: string;
}

class StubHandler implements JsonRpcHandler {
  public readonly received: string[] = [];

  public constructor(
    private readonly responder: (raw: string) => JsonRpcHandlerResult,
  ) {}

  public handle(raw: string): Promise<JsonRpcHandlerResult> {
    this.received.push(raw);
    return Promise.resolve(this.responder(raw));
  }
}

function makeSuccessFrame(id: number | string): JsonRpcHandlerResult {
  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    result: { ok: true, echo: id },
    id,
  };
  return { kind: "response", response };
}

function makeErrorFrame(code: number, id: number | string | null = null): JsonRpcHandlerResult {
  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    error: { code, message: "wire error" },
    id,
  };
  return { kind: "response", response };
}

function collectStdoutFrames(stream: PassThrough): {
  readonly frames: readonly CapturedFrame[];
  readonly drain: () => readonly CapturedFrame[];
} {
  const frames: CapturedFrame[] = [];
  let buffer = "";
  stream.on("data", (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const raw = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (raw.length > 0) frames.push({ raw });
      nl = buffer.indexOf("\n");
    }
  });
  return {
    frames,
    drain: (): readonly CapturedFrame[] => {
      if (buffer.length > 0) {
        frames.push({ raw: buffer });
        buffer = "";
      }
      return frames;
    },
  };
}

interface ServerHarness {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly logger: RecordingLogger;
  readonly server: StdioJsonRpcServer;
  readonly handler: StubHandler;
  readonly drainFrames: () => readonly CapturedFrame[];
}

function makeHarness(
  responder: (raw: string) => JsonRpcHandlerResult,
  options?: StdioJsonRpcServerOptions,
): ServerHarness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const logger = new RecordingLogger();
  const handler = new StubHandler(responder);
  const server = new StdioJsonRpcServer(handler, stdin, stdout, logger, options);
  const collector = collectStdoutFrames(stdout);
  return {
    stdin,
    stdout,
    logger,
    server,
    handler,
    drainFrames: collector.drain,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("StdioJsonRpcServer — single-frame round-trip", () => {
  it("dispatches a well-formed frame and writes the response", async () => {
    const harness = makeHarness((raw) => {
      // Stub handler echoes a success
      return makeSuccessFrame(JSON.parse(raw).id);
    });
    const startPromise = harness.server.start();
    const frame = JSON.stringify({ jsonrpc: "2.0", method: "x", id: 1 });
    harness.stdin.write(`${frame}\n`);
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(1);
    const parsed = JSON.parse(frames[0]?.raw ?? "{}") as { id: number };
    expect(parsed.id).toBe(1);
    expect(harness.handler.received[0]).toBe(frame);
  });

  it("writes parse-error frame when handler returns -32700", async () => {
    const harness = makeHarness(() => makeErrorFrame(-32700, null));
    const startPromise = harness.server.start();
    harness.stdin.write("garbage\n");
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(1);
    const parsed = JSON.parse(frames[0]?.raw ?? "{}") as {
      error: { code: number };
    };
    expect(parsed.error.code).toBe(-32700);
  });

  it("writes invalid-request frame when handler returns -32600", async () => {
    const harness = makeHarness(() => makeErrorFrame(-32600, null));
    const startPromise = harness.server.start();
    harness.stdin.write('{"jsonrpc":"2.0"}\n');
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(1);
    const parsed = JSON.parse(frames[0]?.raw ?? "{}") as {
      error: { code: number };
    };
    expect(parsed.error.code).toBe(-32600);
  });
});

describe("StdioJsonRpcServer — framing", () => {
  it("processes multiple NDJSON frames in order", async () => {
    let counter = 0;
    const harness = makeHarness(() => {
      counter += 1;
      return makeSuccessFrame(counter);
    });
    const startPromise = harness.server.start();
    harness.stdin.write('{"jsonrpc":"2.0","method":"a","id":1}\n');
    harness.stdin.write('{"jsonrpc":"2.0","method":"b","id":2}\n');
    harness.stdin.write('{"jsonrpc":"2.0","method":"c","id":3}\n');
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(3);
    const ids = frames.map((f) => (JSON.parse(f.raw) as { result: { echo: number } }).result.echo);
    expect(ids).toEqual([1, 2, 3]);
  });

  it("processes multiple frames in a single chunk", async () => {
    let counter = 0;
    const harness = makeHarness(() => {
      counter += 1;
      return makeSuccessFrame(counter);
    });
    const startPromise = harness.server.start();
    const combined = [
      '{"jsonrpc":"2.0","method":"a","id":1}',
      '{"jsonrpc":"2.0","method":"b","id":2}',
    ].join("\n");
    harness.stdin.write(`${combined}\n`);
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(2);
  });

  it("buffers a partial chunk until newline arrives", async () => {
    let counter = 0;
    const harness = makeHarness(() => {
      counter += 1;
      return makeSuccessFrame(counter);
    });
    const startPromise = harness.server.start();
    harness.stdin.write('{"jsonrpc":"2.0",');
    // No newline yet → handler must NOT have been called
    await new Promise((r) => setImmediate(r));
    expect(harness.handler.received.length).toBe(0);
    harness.stdin.write('"method":"x","id":1}\n');
    harness.stdin.end();
    await startPromise;
    expect(harness.handler.received.length).toBe(1);
  });

  it("processes trailing frame at end-of-stream without newline", async () => {
    const harness = makeHarness((raw) => makeSuccessFrame(JSON.parse(raw).id));
    const startPromise = harness.server.start();
    // No trailing newline; .end() should still flush
    harness.stdin.write('{"jsonrpc":"2.0","method":"x","id":99}');
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(1);
    expect(harness.handler.received.length).toBe(1);
  });

  it("ignores empty lines between frames", async () => {
    let counter = 0;
    const harness = makeHarness(() => {
      counter += 1;
      return makeSuccessFrame(counter);
    });
    const startPromise = harness.server.start();
    harness.stdin.write('\n\n{"jsonrpc":"2.0","method":"a","id":1}\n\n');
    harness.stdin.end();
    await startPromise;
    expect(harness.handler.received.length).toBe(1);
  });

  it("handles empty stdin (no frames at all)", async () => {
    const harness = makeHarness(() => makeSuccessFrame(0));
    const startPromise = harness.server.start();
    harness.stdin.end();
    await startPromise;
    expect(harness.handler.received.length).toBe(0);
    const frames = harness.drainFrames();
    expect(frames.length).toBe(0);
  });
});

describe("StdioJsonRpcServer — notifications", () => {
  it("does not write a frame when handler returns no-response", async () => {
    const harness = makeHarness(() => ({ kind: "no-response" }));
    const startPromise = harness.server.start();
    harness.stdin.write('{"jsonrpc":"2.0","method":"x"}\n');
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(0);
    expect(harness.handler.received.length).toBe(1);
  });
});

describe("StdioJsonRpcServer — robustness", () => {
  it("does not crash if handler throws (logs and continues)", async () => {
    let calls = 0;
    const harness = makeHarness(() => {
      calls += 1;
      if (calls === 1) {
        throw new Error("handler defect");
      }
      return makeSuccessFrame(2);
    });
    const startPromise = harness.server.start();
    harness.stdin.write('{"jsonrpc":"2.0","method":"a","id":1}\n');
    harness.stdin.write('{"jsonrpc":"2.0","method":"b","id":2}\n');
    harness.stdin.end();
    await startPromise;
    // Frame 1 swallowed (handler defect logged), Frame 2 succeeded
    const frames = harness.drainFrames();
    expect(frames.length).toBe(1);
    const errEntries = harness.logger.entries.filter((e) => e.level === "error");
    expect(errEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("does not crash when handler throws a non-Error value", async () => {
    let calls = 0;
    const harness = makeHarness(() => {
      calls += 1;
      if (calls === 1) {
        // Throw a non-Error throwable to exercise serialiseError's
        // fallback branch.
        throw "string-throwable";
      }
      return makeSuccessFrame(2);
    });
    const startPromise = harness.server.start();
    harness.stdin.write('{"jsonrpc":"2.0","method":"a","id":1}\n');
    harness.stdin.write('{"jsonrpc":"2.0","method":"b","id":2}\n');
    harness.stdin.end();
    await startPromise;
    const errEntries = harness.logger.entries.filter((e) => e.level === "error");
    expect(errEntries.length).toBeGreaterThanOrEqual(1);
    // Verify the serialisation captured the non-Error fallback shape.
    const payload = errEntries[0]?.payload;
    if (typeof payload === "object" && payload !== null && "err" in payload) {
      const err = (payload as { err: unknown }).err;
      // serialiseError returns `{ value: String(value) }` for non-Errors.
      expect(typeof err).toBe("object");
    }
  });

  it("logs and skips frame whose response is not JSON-serialisable", async () => {
    // Build a response with a circular ref that JSON.stringify rejects
    const circular: { self?: unknown; jsonrpc: string; result: unknown; id: number } = {
      jsonrpc: "2.0",
      result: null,
      id: 1,
    };
    circular.self = circular;
    const harness = makeHarness(() => ({
      kind: "response",
      response: circular as unknown as JsonRpcResponse,
    }));
    const startPromise = harness.server.start();
    harness.stdin.write('{"jsonrpc":"2.0","method":"x","id":1}\n');
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(0);
    const errEntries = harness.logger.entries.filter((e) => e.level === "error");
    expect(errEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects the start promise on stdin error", async () => {
    const harness = makeHarness(() => makeSuccessFrame(0));
    const startPromise = harness.server.start();
    harness.stdin.emit("error", new Error("stdin lost"));
    await expect(startPromise).rejects.toThrow("stdin lost");
  });

  it("rejects with unwrapped Error when stdin error is non-Error", async () => {
    const harness = makeHarness(() => makeSuccessFrame(0));
    const startPromise = harness.server.start();
    // Emit a non-Error throwable; toError should widen to Error
    harness.stdin.emit("error", "string failure");
    await expect(startPromise).rejects.toThrow("string failure");
  });
});

describe("StdioJsonRpcServer — stop / lifecycle", () => {
  it("stop() unbinds listeners (idempotent)", async () => {
    const harness = makeHarness(() => makeSuccessFrame(1));
    // start() never called → just exercise stop()
    harness.server.stop();
    harness.server.stop(); // no throw on second call
    expect(harness.stdin.listenerCount("data")).toBe(0);
    expect(harness.stdin.listenerCount("end")).toBe(0);
    expect(harness.stdin.listenerCount("error")).toBe(0);
  });
});

describe("StdioJsonRpcServer — write failure", () => {
  it("rejects start() when stdout.write callback returns an error", async () => {
    const stdin = new PassThrough();
    // Custom writable that invokes the callback with an error exactly
    // once, then becomes a no-op so end-of-stream cleanup does not
    // re-trigger the failure path.
    let triggered = false;
    const stdout = new (class extends PassThrough {
      public override write(
        chunk: unknown,
        encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
        cb?: (err?: Error | null) => void,
      ): boolean {
        const callback =
          typeof encodingOrCb === "function" ? encodingOrCb : cb;
        if (typeof callback === "function" && !triggered) {
          triggered = true;
          process.nextTick(() => {
            callback(new Error("disk full"));
          });
        } else if (typeof callback === "function") {
          process.nextTick(() => {
            callback(null);
          });
        }
        void chunk;
        return true;
      }
    })();
    const logger = new RecordingLogger();
    const handler = new StubHandler((raw) =>
      makeSuccessFrame((JSON.parse(raw) as { id: number }).id),
    );
    const server = new StdioJsonRpcServer(handler, stdin, stdout, logger);
    const startPromise = server.start();
    // Attach a no-op handler so any post-rejection echo doesn't surface
    // as an unhandled rejection in the test runner.
    startPromise.catch(() => {
      /* expected */
    });
    stdin.write('{"jsonrpc":"2.0","method":"x","id":1}\n');
    await expect(startPromise).rejects.toThrow("disk full");
  });
});

describe("StdioJsonRpcServer — large-ish frames", () => {
  it("handles a frame with a multi-kilobyte payload", async () => {
    const big = "x".repeat(64 * 1024); // 64KB string
    const harness = makeHarness(() => makeSuccessFrame(42));
    const startPromise = harness.server.start();
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 42,
      params: { name: "mem.recall", arguments: { query: big } },
    });
    harness.stdin.write(`${frame}\n`);
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(1);
    expect(harness.handler.received[0]?.length ?? 0).toBeGreaterThanOrEqual(big.length);
  });
});

describe("StdioJsonRpcServer — sequential dispatch", () => {
  it("dispatches multiple frames in arrival order under one chunk", async () => {
    // The adapter loops over the newline-terminated frames in the
    // buffer in order. Each frame is processed in its own chunk to
    // give the async drainFrames loop a chance to fire between frames.
    const completions: number[] = [];
    const harness = makeHarness((raw) => {
      const id = (JSON.parse(raw) as { id: number }).id;
      completions.push(id);
      return makeSuccessFrame(id);
    });
    const startPromise = harness.server.start();
    harness.stdin.write('{"jsonrpc":"2.0","method":"a","id":1}\n');
    // Yield to allow drainFrames to process frame 1 before next chunk.
    await new Promise((r) => setImmediate(r));
    harness.stdin.write('{"jsonrpc":"2.0","method":"b","id":2}\n');
    await new Promise((r) => setImmediate(r));
    harness.stdin.write('{"jsonrpc":"2.0","method":"c","id":3}\n');
    await new Promise((r) => setImmediate(r));
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(3);
    expect(completions).toEqual([1, 2, 3]);
  });

  it("dispatches a frame even when handler is async (single inflight)", async () => {
    const harness = makeHarness((raw) => {
      const id = (JSON.parse(raw) as { id: number }).id;
      return makeSuccessFrame(id);
    });
    // Replace handle with a delayed implementation
    const original = harness.handler.handle.bind(harness.handler);
    harness.handler.handle = async (
      raw: string,
    ): Promise<JsonRpcHandlerResult> => {
      await new Promise((r) => setImmediate(r));
      return original(raw);
    };
    const startPromise = harness.server.start();
    harness.stdin.write('{"jsonrpc":"2.0","method":"x","id":1}\n');
    // Yield repeatedly so the async handler chain finishes before end.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    harness.stdin.end();
    await startPromise;
    const frames = harness.drainFrames();
    expect(frames.length).toBe(1);
  });
});

describe("StdioJsonRpcServer — Readable.from compatibility", () => {
  it("works with a Readable.from(...) source", async () => {
    const stdin = Readable.from([
      '{"jsonrpc":"2.0","method":"a","id":1}\n',
      '{"jsonrpc":"2.0","method":"b","id":2}\n',
    ]);
    const stdout = new PassThrough();
    const logger = new RecordingLogger();
    const handler = new StubHandler((raw) =>
      makeSuccessFrame((JSON.parse(raw) as { id: number }).id),
    );
    const server = new StdioJsonRpcServer(handler, stdin, stdout, logger);
    const collector = collectStdoutFrames(stdout);
    await server.start();
    const frames = collector.drain();
    expect(frames.length).toBe(2);
  });
});

// ─── W-3.1-SEC-M1 — buffer-cap regression suite ─────────────────────────
//
// Each test asserts a behavioural property of the cap, not the
// shape of an internal helper. The cap defends against unbounded
// accumulator growth when an adversarial client streams bytes
// without a frame delimiter.

describe("StdioJsonRpcServer — buffer cap (W-3.1-SEC-M1)", () => {
  it("rejects start() with BufferOverflowError when stdin streams more than the cap without a newline", async () => {
    const cap = 1024;
    const harness = makeHarness(() => makeSuccessFrame(0), {
      maxBufferBytes: cap,
    });
    const startPromise = harness.server.start();
    // Attach early so the rejection (which happens synchronously
    // inside the data callback) doesn't surface as unhandled.
    startPromise.catch(() => {
      /* expected */
    });
    // Stream more than the cap with no `\n`. PassThrough preserves
    // chunk boundaries so the adapter sees these as separate `data`
    // events and the running buffer crosses the threshold on the
    // second chunk.
    harness.stdin.write("a".repeat(cap));
    harness.stdin.write("b".repeat(64));
    await expect(startPromise).rejects.toBeInstanceOf(BufferOverflowError);
  });

  it("populates BufferOverflowError.details with the cap and the buffered size (W-3.5-SEC-L1)", async () => {
    const cap = 256;
    const harness = makeHarness(() => makeSuccessFrame(0), {
      maxBufferBytes: cap,
    });
    const startPromise = harness.server.start();
    startPromise.catch(() => {
      /* expected */
    });
    harness.stdin.write("x".repeat(cap + 64));
    let captured: unknown = null;
    try {
      await startPromise;
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(BufferOverflowError);
    if (captured instanceof BufferOverflowError) {
      expect(captured.code).toBe("mcp-server.transport.buffer-overflow");
      expect(captured.jsonRpcCode).toBe(-32000);
      expect(captured.details.maxBufferBytes).toBe(cap);
      expect(captured.details.bufferedBytes).toBeGreaterThan(cap);
      // Sizes live in `details`, not `message` — assert the message
      // does NOT contain the numeric values (W-3.5-SEC-L1).
      expect(captured.message).not.toContain(String(cap));
      expect(captured.message).not.toContain(
        String(captured.details.bufferedBytes),
      );
    }
  });

  it("does NOT trigger overflow when a frame near the cap is delivered with a newline", async () => {
    const cap = 4096;
    // Build a frame whose payload PLUS the JSON-RPC envelope
    // overhead leaves a comfortable margin under the cap; the
    // frame ends with `\n` so the adapter drains it on receipt
    // before the next chunk arrives. Any leftover chunk after
    // drain is empty, so the cap check (which only fires when
    // the running buffer has NO `\n` and is over the cap) does
    // not trip.
    const filler = "x".repeat(cap - 200);
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 7,
      params: { name: "mem.recall", arguments: { query: filler } },
    });
    expect(frame.length).toBeLessThanOrEqual(cap);
    const harness = makeHarness(() => makeSuccessFrame(7), {
      maxBufferBytes: cap,
    });
    const startPromise = harness.server.start();
    harness.stdin.write(`${frame}\n`);
    harness.stdin.end();
    await startPromise;
    expect(harness.handler.received.length).toBe(1);
  });

  it("respects an explicit maxBufferBytes lower than the default", async () => {
    // The default is 10 MiB; a 512-byte cap must clearly trip on a
    // 1 KB stream. This proves the constructor option flows through.
    const harness = makeHarness(() => makeSuccessFrame(0), {
      maxBufferBytes: 512,
    });
    const startPromise = harness.server.start();
    startPromise.catch(() => {
      /* expected */
    });
    harness.stdin.write("a".repeat(1024));
    await expect(startPromise).rejects.toBeInstanceOf(BufferOverflowError);
  });

  it("exposes a default cap of 10 MiB", () => {
    expect(DEFAULT_MAX_BUFFER_BYTES).toBe(10 * 1024 * 1024);
  });

  it("does NOT trigger overflow at the default cap when no option is supplied (cap unchanged)", async () => {
    // Drive 1 KiB through the adapter without any option override
    // and observe a clean round-trip — proves the default is well
    // above realistic frame sizes.
    const harness = makeHarness((raw) =>
      makeSuccessFrame((JSON.parse(raw) as { id: number }).id),
    );
    const startPromise = harness.server.start();
    const frame = JSON.stringify({
      jsonrpc: "2.0",
      method: "x",
      id: 1,
      params: { payload: "x".repeat(1024) },
    });
    harness.stdin.write(`${frame}\n`);
    harness.stdin.end();
    await startPromise;
    expect(harness.handler.received.length).toBe(1);
  });

  it("closes the transport (unbinds listeners) when overflow happens", async () => {
    const cap = 256;
    const harness = makeHarness(() => makeSuccessFrame(0), {
      maxBufferBytes: cap,
    });
    const startPromise = harness.server.start();
    startPromise.catch(() => {
      /* expected */
    });
    harness.stdin.write("z".repeat(cap + 64));
    await expect(startPromise).rejects.toBeInstanceOf(BufferOverflowError);
    // After overflow, the adapter MUST have detached its listeners
    // so a stale stdin event cannot drive further dispatches.
    expect(harness.stdin.listenerCount("data")).toBe(0);
    expect(harness.stdin.listenerCount("end")).toBe(0);
    expect(harness.stdin.listenerCount("error")).toBe(0);
  });

  it("logs a warn entry on overflow with the cap and excess size (no buffer contents)", async () => {
    const cap = 128;
    const harness = makeHarness(() => makeSuccessFrame(0), {
      maxBufferBytes: cap,
    });
    const startPromise = harness.server.start();
    startPromise.catch(() => {
      /* expected */
    });
    const adversarial = "secret-token-".repeat(64);
    harness.stdin.write(adversarial);
    try {
      await startPromise;
    } catch {
      /* expected */
    }
    const warns = harness.logger.entries.filter((e) => e.level === "warn");
    expect(warns.length).toBeGreaterThanOrEqual(1);
    const payload = warns[0]?.payload;
    expect(typeof payload).toBe("object");
    if (typeof payload === "object" && payload !== null) {
      const bag = payload as Record<string, unknown>;
      expect(bag["maxBufferBytes"]).toBe(cap);
      expect(typeof bag["bufferedBytes"]).toBe("number");
      // The buffer's content MUST NOT have leaked into any logged
      // field — defence against secrets accidentally streamed by a
      // misbehaving client.
      const serialised = JSON.stringify(bag);
      expect(serialised).not.toContain("secret-token-");
    }
  });

  it("rejects an invalid maxBufferBytes at construction time", () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const logger = new RecordingLogger();
    const handler = new StubHandler(() => makeSuccessFrame(0));
    expect(
      () =>
        new StdioJsonRpcServer(handler, stdin, stdout, logger, {
          maxBufferBytes: 0,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new StdioJsonRpcServer(handler, stdin, stdout, logger, {
          maxBufferBytes: -1,
        }),
    ).toThrow(TypeError);
    expect(
      () =>
        new StdioJsonRpcServer(handler, stdin, stdout, logger, {
          maxBufferBytes: 1.5,
        }),
    ).toThrow(TypeError);
  });

  it("processes a multi-chunk frame whose total stays under the cap", async () => {
    // Defence against a false positive: a frame split across many
    // chunks whose accumulated length is BELOW the cap must NOT
    // trip overflow (the cap only applies when no `\n` is in the
    // running buffer AND the buffer has crossed the cap).
    const cap = 4096;
    const harness = makeHarness((raw) =>
      makeSuccessFrame((JSON.parse(raw) as { id: number }).id),
      { maxBufferBytes: cap },
    );
    const startPromise = harness.server.start();
    // Build a frame around 1 KiB across 4 writes, no newline until
    // the last chunk.
    const head = '{"jsonrpc":"2.0","method":"x","id":42,"params":{"q":"';
    const body = "y".repeat(900);
    const tail = '"}}';
    harness.stdin.write(head);
    harness.stdin.write(body.slice(0, 300));
    harness.stdin.write(body.slice(300, 600));
    harness.stdin.write(body.slice(600));
    harness.stdin.write(`${tail}\n`);
    harness.stdin.end();
    await startPromise;
    expect(harness.handler.received.length).toBe(1);
  });
});
