import { describe, expect, it } from "vitest";

import { EmbedFailedError } from "../../../../src/modules/retrieval/domain/errors/embed-failed-error.ts";
import { EmbedderUnavailableError } from "../../../../src/modules/retrieval/domain/errors/embedder-unavailable-error.ts";
import { EmbeddingVector } from "../../../../src/modules/retrieval/domain/value-objects/embedding-vector.ts";
import { RawEmbedderAdapter } from "../../../../src/modules/retrieval/infrastructure/embedder/raw-embedder-adapter.ts";
import type {
  Embedder as RawEmbedderPort,
  RawEmbedding,
} from "../../../../src/shared/application/ports/embedder.port.ts";
import { EmbedderError } from "../../../../src/shared/infrastructure/errors/embedder-error.ts";

class StubRawEmbedder implements RawEmbedderPort {
  public lastTexts: string[] = [];

  public constructor(
    private readonly produce: (text: string) => RawEmbedding,
  ) {}

  public embed(text: string): Promise<RawEmbedding> {
    this.lastTexts.push(text);
    return Promise.resolve(this.produce(text));
  }

  public embedBatch(
    texts: readonly string[],
  ): Promise<readonly RawEmbedding[]> {
    for (const t of texts) this.lastTexts.push(t);
    return Promise.resolve(texts.map((t) => this.produce(t)));
  }

  public dimension(): number {
    return this.produce("").dimension;
  }
}

const fixed = (vector: Float32Array, dim?: number): RawEmbedding => ({
  dimension: dim ?? vector.length,
  vector,
});

describe("RawEmbedderAdapter", () => {
  it("wraps the raw vector in an EmbeddingVector VO", async () => {
    const inputVec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const raw = new StubRawEmbedder(() => fixed(inputVec));
    const adapter = new RawEmbedderAdapter(raw);

    const out = await adapter.embed("hello");
    expect(out).toBeInstanceOf(EmbeddingVector);
    expect(out.dim()).toBe(4);
  });

  it("passes the input text through unchanged", async () => {
    const raw = new StubRawEmbedder(() =>
      fixed(new Float32Array([1, 2, 3])),
    );
    const adapter = new RawEmbedderAdapter(raw);

    await adapter.embed("query text");
    expect(raw.lastTexts).toEqual(["query text"]);
  });

  it("preserves component values from the raw embedding", async () => {
    const inputVec = new Float32Array([0.25, -0.5, 0.75]);
    const raw = new StubRawEmbedder(() => fixed(inputVec));
    const adapter = new RawEmbedderAdapter(raw);

    const out = await adapter.embed("any");
    const buffer = out.toFloat32Array();
    expect(buffer[0]).toBeCloseTo(0.25, 5);
    expect(buffer[1]).toBeCloseTo(-0.5, 5);
    expect(buffer[2]).toBeCloseTo(0.75, 5);
  });

  it("makes a defensive copy (mutating raw input does not affect VO)", async () => {
    const buffer = new Float32Array([1, 2, 3]);
    const raw = new StubRawEmbedder(() => fixed(buffer));
    const adapter = new RawEmbedderAdapter(raw);

    const out = await adapter.embed("x");
    buffer[0] = 999;
    const copy = out.toFloat32Array();
    expect(copy[0]).toBe(1);
  });

  it("embedBatch returns one EmbeddingVector per input in order", async () => {
    let counter = 0;
    const raw = new StubRawEmbedder(() => {
      counter += 1;
      return fixed(new Float32Array([counter, counter, counter]));
    });
    const adapter = new RawEmbedderAdapter(raw);

    const out = await adapter.embedBatch(["a", "b", "c"]);
    expect(out.length).toBe(3);
    expect(out[0]?.toFloat32Array()[0]).toBe(1);
    expect(out[1]?.toFloat32Array()[0]).toBe(2);
    expect(out[2]?.toFloat32Array()[0]).toBe(3);
  });

  it("embedBatch with an empty input returns a frozen empty array", async () => {
    const raw = new StubRawEmbedder(() => fixed(new Float32Array([1])));
    const adapter = new RawEmbedderAdapter(raw);

    const out = await adapter.embedBatch([]);
    expect(out.length).toBe(0);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("throws EmbedFailedError when raw embedding lies about its dimension", async () => {
    // dimension says 5 but vector length is 3 — the adapter MUST detect.
    const raw: RawEmbedderPort = {
      embed: (): Promise<RawEmbedding> =>
        Promise.resolve({
          dimension: 5,
          vector: new Float32Array([1, 2, 3]),
        }),
      embedBatch: (): Promise<readonly RawEmbedding[]> => Promise.resolve([]),
      dimension: () => 5,
    };
    const adapter = new RawEmbedderAdapter(raw);
    await expect(adapter.embed("x")).rejects.toBeInstanceOf(EmbedFailedError);
    await expect(adapter.embed("x")).rejects.toThrow(
      /vector of length 3.*dimension 5/i,
    );
  });

  // ─── B-MCP-7: typed-error translation layer ───────────────────────────

  describe("B-MCP-7 typed error translation", () => {
    it("wraps EmbedderError(initialisation-failed) as EmbedderUnavailableError", async () => {
      const raw: RawEmbedderPort = {
        embed: (): Promise<RawEmbedding> =>
          Promise.reject(
            EmbedderError.initialisationFailed(new Error("download timed out")),
          ),
        embedBatch: (): Promise<readonly RawEmbedding[]> =>
          Promise.resolve([]),
        dimension: () => 3,
      };
      const adapter = new RawEmbedderAdapter(raw);
      const err = await adapter.embed("x").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmbedderUnavailableError);
      const unavailable = err as EmbedderUnavailableError;
      expect(unavailable.code).toBe("retrieval.embedder-unavailable");
      // The shared cause is preserved on the domain error so callers
      // that introspect it (e.g. logs) still see the original message.
      expect(unavailable.cause).toBeInstanceOf(EmbedderError);
      // No retry hint by default — the worker picks its own back-off.
      expect(unavailable.retryAfterMs).toBeNull();
    });

    it("wraps EmbedderError(not-initialised) as EmbedderUnavailableError", async () => {
      const raw: RawEmbedderPort = {
        embed: (): Promise<RawEmbedding> =>
          Promise.reject(EmbedderError.notInitialised("dimension")),
        embedBatch: (): Promise<readonly RawEmbedding[]> =>
          Promise.resolve([]),
        dimension: () => 3,
      };
      const adapter = new RawEmbedderAdapter(raw);
      const err = await adapter.embed("x").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmbedderUnavailableError);
    });

    it("wraps EmbedderError(embed-failed) as EmbedFailedError", async () => {
      const raw: RawEmbedderPort = {
        embed: (): Promise<RawEmbedding> =>
          Promise.reject(
            EmbedderError.embedFailed(new Error("input rejected by tokenizer")),
          ),
        embedBatch: (): Promise<readonly RawEmbedding[]> =>
          Promise.resolve([]),
        dimension: () => 3,
      };
      const adapter = new RawEmbedderAdapter(raw);
      const err = await adapter.embed("x").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmbedFailedError);
      // Specifically NOT an unavailable error — per-item rejections stay
      // per-item so the worker bumps attempts as before.
      expect(err).not.toBeInstanceOf(EmbedderUnavailableError);
    });

    it("wraps EmbedderError(dimension-mismatch) as EmbedFailedError", async () => {
      const raw: RawEmbedderPort = {
        embed: (): Promise<RawEmbedding> =>
          Promise.reject(EmbedderError.dimensionMismatch(384, 768)),
        embedBatch: (): Promise<readonly RawEmbedding[]> =>
          Promise.resolve([]),
        dimension: () => 384,
      };
      const adapter = new RawEmbedderAdapter(raw);
      await expect(adapter.embed("x")).rejects.toBeInstanceOf(
        EmbedFailedError,
      );
    });

    it("wraps a non-EmbedderError cause as EmbedFailedError (conservative default)", async () => {
      // Defaulting to per-item failure means a misbehaving adapter cannot
      // accidentally trigger the worker-wide back-off.
      const raw: RawEmbedderPort = {
        embed: (): Promise<RawEmbedding> =>
          Promise.reject(new Error("backend down")),
        embedBatch: (): Promise<readonly RawEmbedding[]> =>
          Promise.resolve([]),
        dimension: () => 3,
      };
      const adapter = new RawEmbedderAdapter(raw);
      const err = await adapter.embed("x").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmbedFailedError);
      expect((err as EmbedFailedError).message).toMatch(/backend down/);
    });

    it("translates errors thrown from embedBatch as well", async () => {
      const raw: RawEmbedderPort = {
        embed: (): Promise<RawEmbedding> =>
          Promise.resolve(fixed(new Float32Array([1]))),
        embedBatch: (): Promise<readonly RawEmbedding[]> =>
          Promise.reject(EmbedderError.initialisationFailed(undefined)),
        dimension: () => 1,
      };
      const adapter = new RawEmbedderAdapter(raw);
      await expect(adapter.embedBatch(["x"])).rejects.toBeInstanceOf(
        EmbedderUnavailableError,
      );
    });

    it("wraps a non-Error rejection (e.g. string) as EmbedFailedError using String() coercion", async () => {
      // Misbehaving adapters can reject with non-Error values (string,
      // plain object, etc.). The translation layer MUST handle this to
      // avoid leaking `undefined.message` errors to the caller.
      const raw: RawEmbedderPort = {
        embed: (): Promise<RawEmbedding> =>
          // deliberately reject with a primitive
          Promise.reject("legacy adapter threw a string"),
        embedBatch: (): Promise<readonly RawEmbedding[]> =>
          Promise.resolve([]),
        dimension: () => 3,
      };
      const adapter = new RawEmbedderAdapter(raw);
      const err = await adapter.embed("x").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmbedFailedError);
      expect((err as EmbedFailedError).message).toBe(
        "legacy adapter threw a string",
      );
    });
  });
});
