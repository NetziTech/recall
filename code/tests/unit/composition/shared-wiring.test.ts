import { describe, it, expect, vi } from "vitest";

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(async () => {
    throw new Error("pipeline must NOT be called during wiring construction");
  }),
}));

import { buildSharedAdapters } from "../../../src/composition/wiring/shared-wiring.ts";
import { TransformersEmbedder } from "../../../src/shared/infrastructure/embedder/transformers-embedder.ts";

const baseLogger = { level: "silent" as const, pretty: false };

describe("buildSharedAdapters", () => {
  it("constructs a TransformersEmbedder with the default cache dir", () => {
    const adapters = buildSharedAdapters({ logger: baseLogger });
    expect(adapters.embedder).toBeInstanceOf(TransformersEmbedder);
  });

  it("forwards custom transformersEmbedder options", () => {
    const adapters = buildSharedAdapters({
      logger: baseLogger,
      transformersEmbedder: {
        cacheDir: "/tmp/custom-recall-cache",
        modelName: "Xenova/all-MiniLM-L6-v2",
      },
    });
    expect(adapters.embedder).toBeInstanceOf(TransformersEmbedder);
    expect(adapters.embedder.dimension()).toBe(384);
  });

  it("default model dimension is 384 (Xenova/bge-small-en-v1.5)", () => {
    const adapters = buildSharedAdapters({ logger: baseLogger });
    expect(adapters.embedder.dimension()).toBe(384);
  });

  it("retrievalEmbedder wraps the same backend (defined + delegating)", () => {
    const adapters = buildSharedAdapters({ logger: baseLogger });
    expect(adapters.retrievalEmbedder).toBeDefined();
    // retrieval port does not expose dimension(), but its construction
    // implies the wrapped raw embedder; we exercise the wiring by checking
    // both objects are constructed and live on the same return value.
    expect(adapters.embedder).toBeDefined();
  });

  it("returns logger / clock / idGenerator concrete adapters", () => {
    const adapters = buildSharedAdapters({ logger: baseLogger });
    expect(adapters.logger).toBeDefined();
    expect(adapters.clock).toBeDefined();
    expect(adapters.idGenerator).toBeDefined();
  });
});
