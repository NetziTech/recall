import { afterEach, describe, expect, it } from "vitest";
import type { Tiktoken, TiktokenEncoding } from "tiktoken";

import { TiktokenTokenCounter } from "../../../../src/modules/retrieval/infrastructure/token-counter/tiktoken-token-counter.ts";
import { Tokens } from "../../../../src/shared/domain/value-objects/tokens.ts";

const counters: TiktokenTokenCounter[] = [];

afterEach(() => {
  while (counters.length > 0) {
    const c = counters.pop();
    c?.dispose();
  }
});

const make = (
  options?: ConstructorParameters<typeof TiktokenTokenCounter>[0],
): TiktokenTokenCounter => {
  const c = new TiktokenTokenCounter(options);
  counters.push(c);
  return c;
};

describe("TiktokenTokenCounter (real tiktoken cl100k_base)", () => {
  it("counts known short strings via the real encoder", () => {
    const counter = make();
    const tokens = counter.count("hello");
    expect(tokens).toBeInstanceOf(Tokens);
    expect(tokens.toNumber()).toBeGreaterThan(0);
    expect(tokens.toNumber()).toBeLessThan(5);
  });

  it("returns 0 tokens for the empty string", () => {
    const counter = make();
    expect(counter.count("").toNumber()).toBe(0);
  });

  it("accepts an explicit cl100k_base encoding", () => {
    const counter = make({ encoding: "cl100k_base" });
    expect(counter.count("test").toNumber()).toBeGreaterThan(0);
  });

  it("countBatch returns one Tokens per input in input order", async () => {
    const counter = make();
    const out = await counter.countBatch(["a", "bb cc", "ddd eee fff"]);
    expect(out.length).toBe(3);
    expect(out[0]?.toNumber()).toBeGreaterThan(0);
    expect(out[2]?.toNumber()).toBeGreaterThan(out[0]?.toNumber() ?? 0);
  });

  it("dispose() releases the encoder and a subsequent count throws", () => {
    const counter = make();
    expect(counter.count("alive").toNumber()).toBeGreaterThan(0);
    counter.dispose();
    expect(() => counter.count("dead")).toThrow(/disposed/i);
  });

  it("dispose() is idempotent", () => {
    const counter = make();
    counter.dispose();
    expect(() => counter.dispose()).not.toThrow();
  });

  it("uses an injected factory for tests (no native model load)", () => {
    let factoryCalls = 0;
    const fakeEncoder: Tiktoken = {
      encode: (text: string): Uint32Array =>
        new Uint32Array(text.length === 0 ? [] : [1, 2, 3]),
      decode: (): Uint8Array => new Uint8Array(),
      free: () => {
        // no-op
      },
    } as unknown as Tiktoken;

    const counter = make({
      factory: (encoding: TiktokenEncoding): Tiktoken => {
        factoryCalls += 1;
        void encoding;
        return fakeEncoder;
      },
    });

    expect(factoryCalls).toBe(1);
    expect(counter.count("anything").toNumber()).toBe(3);
    expect(counter.count("").toNumber()).toBe(0);
  });

  it("returns increasing counts for longer inputs", () => {
    const counter = make();
    const small = counter.count("hi").toNumber();
    const big = counter.count(
      "the quick brown fox jumps over the lazy dog repeatedly",
    ).toNumber();
    expect(big).toBeGreaterThan(small);
  });
});
