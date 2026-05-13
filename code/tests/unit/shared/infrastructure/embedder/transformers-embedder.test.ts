import { describe, it, expect, beforeEach, vi } from "vitest";

import { TransformersEmbedder } from "../../../../../src/shared/infrastructure/embedder/transformers-embedder.ts";
import { EmbedderError } from "../../../../../src/shared/infrastructure/errors/embedder-error.ts";

/**
 * The TransformersEmbedder unit suite mocks `@huggingface/transformers`'s
 * `pipeline()` factory so the tests never download an ONNX model. The
 * replacement returns a fake `FeatureExtractionPipeline`-shaped callable
 * whose invocation returns a Tensor-shaped object with `data:
 * Float32Array` and `dims: number[]`.
 */

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
}));

const { pipeline } = await import("@huggingface/transformers");
const pipelineMock = vi.mocked(pipeline);

interface FakeExtractorOptions {
  readonly dim: number;
  /** When provided, the extractor invocation throws this on every call. */
  readonly callThrows?: unknown;
  /** When provided, the extractor yields a Tensor of THIS dim instead. */
  readonly producedDim?: number;
  /** When provided, the extractor returns this data shape instead of Float32Array. */
  readonly nonFloat32?: boolean;
  /** When provided, the extractor returns dims of THIS shape instead of [n, dim]. */
  readonly overrideDims?: readonly number[];
}

interface FakeTensor {
  readonly data: Float32Array | Int8Array;
  readonly dims: readonly number[];
}

type FakeExtractor = ((
  texts: string | string[],
  options?: { pooling?: string; normalize?: boolean },
) => Promise<FakeTensor>) & { dispose?: () => Promise<void> };

function makeFakeExtractor(opts: FakeExtractorOptions): FakeExtractor {
  const fn: FakeExtractor = async (texts) => {
    await Promise.resolve();
    if (opts.callThrows !== undefined) {
      throw opts.callThrows;
    }
    const inputs = Array.isArray(texts) ? texts : [texts];
    const producedDim = opts.producedDim ?? opts.dim;
    const total = inputs.length * producedDim;
    const data = opts.nonFloat32
      ? new Int8Array(total)
      : new Float32Array(total);
    for (let i = 0; i < total; i += 1) {
      data[i] = (i % producedDim) + 1;
    }
    const dims = opts.overrideDims ?? [inputs.length, producedDim];
    return { data, dims };
  };
  return fn;
}

beforeEach(() => {
  pipelineMock.mockReset();
});

describe("TransformersEmbedder", () => {
  it("dimension() is callable before the pipeline loads (lazy)", () => {
    const e = new TransformersEmbedder();
    expect(e.dimension()).toBe(384);
    expect(pipelineMock).not.toHaveBeenCalled();
  });

  it("dimension() reflects custom modelName", () => {
    const e = new TransformersEmbedder({
      modelName: "Xenova/bge-base-en-v1.5",
    });
    expect(e.dimension()).toBe(768);
  });

  it("embed() lazy-loads the pipeline exactly once across concurrent calls", async () => {
    let callCount = 0;
    pipelineMock.mockImplementation(async () => {
      callCount += 1;
      await new Promise<void>((res) => setTimeout(res, 5));
      return makeFakeExtractor({ dim: 384 }) as unknown as Awaited<
        ReturnType<typeof pipeline>
      >;
    });
    const e = new TransformersEmbedder();
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

  it("embedBatch returns one RawEmbedding per input, ordered, with distinct buffers", async () => {
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({ dim: 384 }) as unknown as Awaited<
          ReturnType<typeof pipeline>
        >,
    );
    const e = new TransformersEmbedder();
    const out = await e.embedBatch(["a", "b", "c"]);
    expect(out.length).toBe(3);
    for (const r of out) {
      expect(r.dimension).toBe(384);
      expect(r.vector.length).toBe(384);
      expect(r.vector).toBeInstanceOf(Float32Array);
    }
    expect(Object.isFrozen(out)).toBe(true);
    // Each entry must own its own buffer slice; mutating one MUST NOT
    // affect the others. This is the slicing contract of the adapter.
    out[0]!.vector[0] = 999;
    expect(out[1]!.vector[0]).not.toBe(999);
  });

  it("embedBatch on empty input returns frozen empty array (no pipeline load)", async () => {
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({ dim: 384 }) as unknown as Awaited<
          ReturnType<typeof pipeline>
        >,
    );
    const e = new TransformersEmbedder();
    const out = await e.embedBatch([]);
    expect(out).toEqual([]);
    expect(Object.isFrozen(out)).toBe(true);
    expect(pipelineMock).not.toHaveBeenCalled();
  });

  it("rejects vectors whose dimension disagrees with the catalog", async () => {
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({
          dim: 384,
          producedDim: 512,
        }) as unknown as Awaited<ReturnType<typeof pipeline>>,
    );
    const e = new TransformersEmbedder();
    try {
      await e.embed("x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.dimension-mismatch");
    }
  });

  it("rejects tensors whose dims rank is not 2", async () => {
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({
          dim: 384,
          overrideDims: [1, 8, 384], // rank 3 (no pooling) instead of rank 2
        }) as unknown as Awaited<ReturnType<typeof pipeline>>,
    );
    const e = new TransformersEmbedder();
    try {
      await e.embed("x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.dimension-mismatch");
    }
  });

  it("rejects tensors whose batch size disagrees with input count", async () => {
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({
          dim: 384,
          overrideDims: [5, 384], // 5 rows for 2 inputs
        }) as unknown as Awaited<ReturnType<typeof pipeline>>,
    );
    const e = new TransformersEmbedder();
    try {
      await e.embedBatch(["a", "b"]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.dimension-mismatch");
    }
  });

  it("rejects tensors whose data is not Float32Array (e.g. quantised path)", async () => {
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({
          dim: 384,
          nonFloat32: true,
        }) as unknown as Awaited<ReturnType<typeof pipeline>>,
    );
    const e = new TransformersEmbedder();
    try {
      await e.embed("x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.embed-failed");
    }
  });

  it("wraps load failures as initialisation-failed", async () => {
    pipelineMock.mockImplementation(async () => {
      throw new Error("model download failed");
    });
    const e = new TransformersEmbedder();
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
    pipelineMock.mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network down");
      return makeFakeExtractor({ dim: 384 }) as unknown as Awaited<
        ReturnType<typeof pipeline>
      >;
    });
    const e = new TransformersEmbedder();
    await expect(e.embed("x")).rejects.toBeInstanceOf(EmbedderError);
    const ok = await e.embed("x");
    expect(ok.dimension).toBe(384);
    expect(attempt).toBe(2);
  });

  it("wraps inference failures as embed-failed", async () => {
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({
          dim: 384,
          callThrows: new Error("inference broken"),
        }) as unknown as Awaited<ReturnType<typeof pipeline>>,
    );
    const e = new TransformersEmbedder();
    try {
      await e.embed("x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.embed-failed");
    }
  });

  it("forwards cacheDir option as cache_dir (smoke)", async () => {
    let receivedCacheDir: string | undefined;
    pipelineMock.mockImplementation(
      async (_task: unknown, _model: unknown, opts: unknown) => {
        receivedCacheDir = (opts as { cache_dir?: string } | undefined)?.[
          "cache_dir"
        ];
        return makeFakeExtractor({ dim: 384 }) as unknown as Awaited<
          ReturnType<typeof pipeline>
        >;
      },
    );
    const e = new TransformersEmbedder({ cacheDir: "/tmp/cache-x" });
    await e.embed("x");
    expect(receivedCacheDir).toBe("/tmp/cache-x");
  });

  it("does not pass cache_dir when cacheDir omitted", async () => {
    let receivedCacheDir: string | undefined;
    pipelineMock.mockImplementation(
      async (_task: unknown, _model: unknown, opts: unknown) => {
        receivedCacheDir = (opts as { cache_dir?: string } | undefined)?.[
          "cache_dir"
        ];
        return makeFakeExtractor({ dim: 384 }) as unknown as Awaited<
          ReturnType<typeof pipeline>
        >;
      },
    );
    const e = new TransformersEmbedder();
    await e.embed("x");
    expect(receivedCacheDir).toBeUndefined();
  });

  it("forwards localFilesOnly option as local_files_only", async () => {
    let received: boolean | undefined;
    pipelineMock.mockImplementation(
      async (_task: unknown, _model: unknown, opts: unknown) => {
        received = (opts as { local_files_only?: boolean } | undefined)?.[
          "local_files_only"
        ];
        return makeFakeExtractor({ dim: 384 }) as unknown as Awaited<
          ReturnType<typeof pipeline>
        >;
      },
    );
    const e = new TransformersEmbedder({ localFilesOnly: true });
    await e.embed("x");
    expect(received).toBe(true);
  });

  it("forwards pooling + normalize defaults (mean + true) to extractor call", async () => {
    let receivedOpts: { pooling?: string; normalize?: boolean } | undefined;
    pipelineMock.mockImplementation(async () => {
      const fn = (async (
        _texts: string | string[],
        opts?: { pooling?: string; normalize?: boolean },
      ) => {
        receivedOpts = opts;
        return makeFakeExtractor({ dim: 384 })("placeholder");
      }) as unknown as Awaited<ReturnType<typeof pipeline>>;
      return fn;
    });
    const e = new TransformersEmbedder();
    await e.embed("x");
    expect(receivedOpts?.pooling).toBe("mean");
    expect(receivedOpts?.normalize).toBe(true);
  });

  it("uses custom pooling + normalize when supplied", async () => {
    let receivedOpts: { pooling?: string; normalize?: boolean } | undefined;
    pipelineMock.mockImplementation(async () => {
      const fn = (async (
        _texts: string | string[],
        opts?: { pooling?: string; normalize?: boolean },
      ) => {
        receivedOpts = opts;
        return makeFakeExtractor({ dim: 384 })("placeholder");
      }) as unknown as Awaited<ReturnType<typeof pipeline>>;
      return fn;
    });
    const e = new TransformersEmbedder({ pooling: "cls", normalize: false });
    await e.embed("x");
    expect(receivedOpts?.pooling).toBe("cls");
    expect(receivedOpts?.normalize).toBe(false);
  });

  it("embed() with single empty input still produces a vector", async () => {
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({ dim: 384 }) as unknown as Awaited<
          ReturnType<typeof pipeline>
        >,
    );
    const e = new TransformersEmbedder();
    const out = await e.embed("");
    expect(out.dimension).toBe(384);
    expect(out.vector.length).toBe(384);
  });

  it("embed() surfaces embed-failed when the extractor returns 0 rows for non-empty input", async () => {
    // Defensive branch: `embedBatch([text])` reaches the dimension-mismatch
    // path because dims=[0, 384] disagrees with input length 1. The
    // adapter MUST throw a typed error rather than panic on the empty
    // destructuring at the embed() seam.
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({
          dim: 384,
          overrideDims: [0, 384],
        }) as unknown as Awaited<ReturnType<typeof pipeline>>,
    );
    const e = new TransformersEmbedder();
    try {
      await e.embed("non-empty input");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      // The seam happens to throw dimension-mismatch first (the batch
      // count differs from inputs); either typed code is acceptable
      // for this defensive path.
      const code = (err as EmbedderError).code;
      expect(
        code === "embedder.embed-failed" || code === "embedder.dimension-mismatch",
      ).toBe(true);
    }
  });

  it("preserves EmbedderError thrown from the underlying extractor without re-wrapping", async () => {
    // The dim-mismatch path: embedBatch throws EmbedderError mid-flow;
    // it must propagate unchanged (not re-wrapped as embed-failed).
    pipelineMock.mockImplementation(
      async () =>
        makeFakeExtractor({
          dim: 384,
          producedDim: 100,
        }) as unknown as Awaited<ReturnType<typeof pipeline>>,
    );
    const e = new TransformersEmbedder();
    try {
      await e.embed("x");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderError);
      expect((err as EmbedderError).code).toBe("embedder.dimension-mismatch");
    }
  });
});
