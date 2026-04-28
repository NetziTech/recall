import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EmbeddingModel, FlagEmbedding } from "fastembed";

import { FastembedEmbedder } from "../../../../../src/shared/infrastructure/embedder/fastembed-embedder.ts";
import { EmbedderError } from "../../../../../src/shared/infrastructure/errors/embedder-error.ts";

/**
 * The FastembedEmbedder unit suite mocks `FlagEmbedding.init` so the
 * tests never download an ONNX model. The replacement returns a fake
 * `FlagEmbedding`-shaped object whose `embed(...)` is an async
 * generator yielding a single chunk of vectors.
 */

interface FakeModelOptions {
  readonly dim: number;
  /** When provided, embed() throws this on every call. */
  readonly embedThrows?: unknown;
  /** When provided, embed() yields vectors of THIS dimension instead. */
  readonly producedDim?: number;
}

function makeFakeModel(opts: FakeModelOptions): FlagEmbedding {
  async function* embedGen(
    texts: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _batchSize: number,
  ): AsyncGenerator<number[][], void, unknown> {
    await Promise.resolve();
    if (opts.embedThrows !== undefined) {
      throw opts.embedThrows;
    }
    const dim = opts.producedDim ?? opts.dim;
    const vectors = texts.map(() =>
      Array.from({ length: dim }, (_v, i) => i + 1),
    );
    yield vectors;
  }
  // The FastembedEmbedder only calls `model.embed([...texts], texts.length)`.
  // We satisfy that surface and ignore the rest of FlagEmbedding's API.
  return { embed: embedGen } as unknown as FlagEmbedding;
}

let originalInit: typeof FlagEmbedding.init;

beforeEach(() => {
  originalInit = FlagEmbedding.init.bind(FlagEmbedding);
});

afterEach(() => {
  FlagEmbedding.init = originalInit;
});

describe("FastembedEmbedder", () => {
  it("dimension() is callable before the model loads (lazy)", () => {
    const e = new FastembedEmbedder();
    expect(e.dimension()).toBe(384); // BGESmallENV15 default
  });

  it("dimension() reflects custom modelName", () => {
    const e = new FastembedEmbedder({ modelName: EmbeddingModel.BGEBaseEN });
    expect(e.dimension()).toBe(768);
  });

  it("embed() lazy-loads the model exactly once across concurrent calls", async () => {
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    FlagEmbedding.init = async (_opts) => {
      callCount += 1;
      // small delay to highlight the race window
      await new Promise<void>((res) => setTimeout(res, 5));
      return makeFakeModel({ dim: 384 });
    };
    const e = new FastembedEmbedder();
    const [a, b, c] = await Promise.all([
      e.embed("first"),
      e.embed("second"),
      e.embed("third"),
    ]);
    expect(callCount).toBe(1);
    expect(a.dimension).toBe(384);
    expect(a.vector).toBeInstanceOf(Float32Array);
    expect(a.vector.length).toBe(384);
    expect(b.dimension).toBe(384);
    expect(c.dimension).toBe(384);
  });

  it("embedBatch returns one RawEmbedding per input, ordered", async () => {
    FlagEmbedding.init = async () =>
      Promise.resolve(makeFakeModel({ dim: 384 }));
    const e = new FastembedEmbedder();
    const out = await e.embedBatch(["a", "b", "c"]);
    expect(out.length).toBe(3);
    for (const r of out) {
      expect(r.dimension).toBe(384);
      expect(r.vector.length).toBe(384);
    }
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("embedBatch on empty input returns frozen empty array (no model load)", async () => {
    let init = false;
    FlagEmbedding.init = async () => {
      init = true;
      return Promise.resolve(makeFakeModel({ dim: 384 }));
    };
    const e = new FastembedEmbedder();
    const out = await e.embedBatch([]);
    expect(out).toEqual([]);
    expect(Object.isFrozen(out)).toBe(true);
    expect(init).toBe(false);
  });

  it("rejects vectors whose dimension disagrees with the catalog", async () => {
    FlagEmbedding.init = async () =>
      Promise.resolve(makeFakeModel({ dim: 384, producedDim: 512 }));
    const e = new FastembedEmbedder();
    try {
      await e.embed("x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.dimension-mismatch");
    }
  });

  it("wraps load failures as initialisation-failed", async () => {
    FlagEmbedding.init = async () => {
      throw new Error("model download failed");
    };
    const e = new FastembedEmbedder();
    try {
      await e.embed("anything");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe(
        "embedder.initialisation-failed",
      );
    }
  });

  it("after a load failure, the next call retries the load", async () => {
    let attempt = 0;
    FlagEmbedding.init = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network down");
      return Promise.resolve(makeFakeModel({ dim: 384 }));
    };
    const e = new FastembedEmbedder();
    await expect(e.embed("x")).rejects.toBeInstanceOf(EmbedderError);
    const ok = await e.embed("x"); // retry succeeds
    expect(ok.dimension).toBe(384);
    expect(attempt).toBe(2);
  });

  it("wraps inference failures as embed-failed", async () => {
    FlagEmbedding.init = async () =>
      Promise.resolve(
        makeFakeModel({ dim: 384, embedThrows: new Error("inference broken") }),
      );
    const e = new FastembedEmbedder();
    try {
      await e.embed("x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.embed-failed");
    }
  });

  it("surfaces a clean error when fastembed returns nothing for non-empty input", async () => {
    // empty generator
    const fakeEmpty: FlagEmbedding = {
      embed: async function* (): AsyncGenerator<number[][], void, unknown> {
        await Promise.resolve();
        // yield nothing
        yield [];
      },
    } as unknown as FlagEmbedding;
    FlagEmbedding.init = async () => Promise.resolve(fakeEmpty);
    const e = new FastembedEmbedder();
    try {
      await e.embed("x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.embed-failed");
    }
  });

  it("forwards cacheDir option (smoke)", async () => {
    let receivedCacheDir: string | undefined;
    FlagEmbedding.init = async (opts) => {
      // Treat as a Record so our stub doesn't need to know the union shape.
      receivedCacheDir = (opts as { cacheDir?: string }).cacheDir;
      return Promise.resolve(makeFakeModel({ dim: 384 }));
    };
    const e = new FastembedEmbedder({ cacheDir: "/tmp/cache-x" });
    await e.embed("x");
    expect(receivedCacheDir).toBe("/tmp/cache-x");
  });

  it("inference failure rethrows existing EmbedderError without re-wrapping", async () => {
    // The dimension-mismatch path: embedBatch throws EmbedderError
    // INSIDE the for-await loop. The catch block must rethrow it
    // unchanged (line 182 `if (cause instanceof EmbedderError) throw
    // cause`). This is the analogous "preserve EmbedderError" branch
    // to the one inside ensureModel.
    FlagEmbedding.init = async () =>
      Promise.resolve(makeFakeModel({ dim: 384, producedDim: 100 }));
    const e = new FastembedEmbedder();
    try {
      await e.embed("x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.dimension-mismatch");
    }
  });

  it("embed() with single empty input still produces a vector", async () => {
    FlagEmbedding.init = async () =>
      Promise.resolve(makeFakeModel({ dim: 384 }));
    const e = new FastembedEmbedder();
    const out = await e.embed("");
    expect(out.dimension).toBe(384);
  });

  it("does not pass cacheDir when omitted", async () => {
    let receivedCacheDir: string | undefined;
    FlagEmbedding.init = async (opts) => {
      receivedCacheDir = (opts as { cacheDir?: string }).cacheDir;
      return Promise.resolve(makeFakeModel({ dim: 384 }));
    };
    const e = new FastembedEmbedder();
    await e.embed("x");
    expect(receivedCacheDir).toBeUndefined();
  });
});
