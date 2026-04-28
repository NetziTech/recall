import type { RandomBytes } from "../../src/modules/encryption/application/ports/out/random-bytes.port.ts";

/**
 * Deterministic test double for the `RandomBytes` port.
 *
 * Two modes:
 * - `pattern: "counter"` (default) — returns `[0, 1, 2, ..., n-1]`
 *   modulo 256.
 * - `pattern: "fill"` — returns `[v, v, ..., v]` for a configured
 *   value `v`.
 * - `pattern: "queue"` — returns the next pre-built buffer from a
 *   queue.
 *
 * Used by tests that require deterministic CSPRNG output without the
 * non-determinism of the real adapter.
 */
export class DeterministicRandomBytes implements RandomBytes {
  private readonly mode: "counter" | "fill" | "queue";
  private readonly fill: number;
  private readonly queue: Uint8Array[];
  private counter: number;

  public constructor(
    options: {
      pattern?: "counter" | "fill" | "queue";
      fillValue?: number;
      queue?: Uint8Array[];
    } = {},
  ) {
    this.mode = options.pattern ?? "counter";
    this.fill = options.fillValue ?? 0;
    this.queue = options.queue ?? [];
    this.counter = 0;
  }

  public next(length: number): Uint8Array {
    if (this.mode === "queue") {
      const next = this.queue.shift();
      if (next === undefined) {
        throw new Error("DeterministicRandomBytes: queue exhausted");
      }
      if (next.length !== length) {
        throw new Error(
          `DeterministicRandomBytes: queue head length ${String(next.length)} != requested ${String(length)}`,
        );
      }
      return new Uint8Array(next);
    }
    if (this.mode === "fill") {
      const buf = new Uint8Array(length);
      buf.fill(this.fill);
      return buf;
    }
    // counter
    const buf = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      buf[i] = this.counter & 0xff;
      this.counter = (this.counter + 1) & 0xff;
    }
    return buf;
  }
}
