import { describe, it, expect } from "vitest";

import { EmbedderPortProbe } from "../../../../../src/modules/workspace/infrastructure/persistence/embedder-port-probe.ts";
import type {
  Embedder,
  RawEmbedding,
} from "../../../../../src/shared/application/ports/embedder.port.ts";
import { EmbedderError } from "../../../../../src/shared/infrastructure/errors/embedder-error.ts";

class FakeEmbedder implements Embedder {
  public constructor(
    private readonly dim: number,
    private readonly throws: unknown = null,
  ) {}
  public dimension(): number {
    if (this.throws !== null) {
      throw this.throws;
    }
    return this.dim;
  }
  public embed(): Promise<RawEmbedding> {
    return Promise.resolve({
      dimension: this.dim,
      vector: new Float32Array(this.dim),
    });
  }
  public embedBatch(): Promise<readonly RawEmbedding[]> {
    return Promise.resolve(Object.freeze([]));
  }
}

describe("EmbedderPortProbe", () => {
  it("returns ok=true with the dimension when the embedder is loadable", async () => {
    const probe = new EmbedderPortProbe(new FakeEmbedder(384));
    const out = await probe.probe();
    expect(out.ok).toBe(true);
    expect(out.dimension).toBe(384);
    expect(out.message).toContain("384");
  });

  it("returns ok=false when dimension <= 0", async () => {
    const probe = new EmbedderPortProbe(new FakeEmbedder(0));
    const out = await probe.probe();
    expect(out.ok).toBe(false);
    expect(out.dimension).toBeNull();
  });

  it("returns ok=false when dimension throws (Error)", async () => {
    const probe = new EmbedderPortProbe(
      new FakeEmbedder(384, new Error("model missing")),
    );
    const out = await probe.probe();
    expect(out.ok).toBe(false);
    expect(out.dimension).toBeNull();
    expect(out.message).toContain("model missing");
  });

  it("returns ok=false when dimension throws (non-Error)", async () => {
    const probe = new EmbedderPortProbe(new FakeEmbedder(384, "boom"));
    const out = await probe.probe();
    expect(out.ok).toBe(false);
    expect(out.message).toContain("boom");
  });

  it("returns ok=false when dimension throws an EmbedderError", async () => {
    const probe = new EmbedderPortProbe(
      new FakeEmbedder(384, EmbedderError.notInitialised("dimension")),
    );
    const out = await probe.probe();
    expect(out.ok).toBe(false);
    expect(out.message).toContain("dimension");
  });
});
