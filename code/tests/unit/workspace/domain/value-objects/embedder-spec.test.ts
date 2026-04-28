import { describe, it, expect } from "vitest";

import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("EmbedderSpec.create", () => {
  it("fastembed + canonical model: dim derived", () => {
    const s = EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" });
    expect(s.provider).toBe("fastembed");
    expect(s.model).toBe("BGESmallEN15");
    expect(s.dim).toBe(384);
    expect(s.isFastembed()).toBe(true);
    expect(s.isVoyage()).toBe(false);
    expect(s.isOpenAi()).toBe(false);
  });

  it("fastembed canonical: matching explicit dim accepted", () => {
    const s = EmbedderSpec.create({
      provider: "fastembed",
      model: "MultilingualE5Base",
      dim: 768,
    });
    expect(s.dim).toBe(768);
  });

  it("fastembed canonical: mismatched dim rejected", () => {
    expect(() =>
      EmbedderSpec.create({
        provider: "fastembed",
        model: "BGESmallEN15",
        dim: 512,
      }),
    ).toThrow(InvalidInputError);
  });

  it("fastembed unknown model: dim is required", () => {
    expect(() =>
      EmbedderSpec.create({ provider: "fastembed", model: "weird-model" }),
    ).toThrow(InvalidInputError);
    const s = EmbedderSpec.create({
      provider: "fastembed",
      model: "weird-model",
      dim: 256,
    });
    expect(s.dim).toBe(256);
  });

  it("voyage / openai: dim mandatory", () => {
    expect(() =>
      EmbedderSpec.create({ provider: "voyage", model: "voyage-3" }),
    ).toThrow(InvalidInputError);
    expect(() =>
      EmbedderSpec.create({ provider: "openai", model: "text-embedding-3-small" }),
    ).toThrow(InvalidInputError);

    const v = EmbedderSpec.create({
      provider: "voyage",
      model: "voyage-3",
      dim: 1024,
    });
    expect(v.dim).toBe(1024);
    expect(v.isVoyage()).toBe(true);

    const o = EmbedderSpec.create({
      provider: "openai",
      model: "text-embedding-3-small",
      dim: 1536,
    });
    expect(o.isOpenAi()).toBe(true);
    expect(o.dim).toBe(1536);
  });

  it("rejects unknown provider", () => {
    expect(() =>
      EmbedderSpec.create({ provider: "cohere", model: "x" }),
    ).toThrow(InvalidInputError);
  });

  it("rejects empty / non-string provider", () => {
    expect(() =>
      EmbedderSpec.create({ provider: "  ", model: "BGESmallEN15" }),
    ).toThrow(InvalidInputError);
    expect(() =>
      EmbedderSpec.create({
        provider: undefined as unknown as string,
        model: "x",
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects empty model", () => {
    expect(() =>
      EmbedderSpec.create({ provider: "fastembed", model: "  " }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-string model", () => {
    expect(() =>
      EmbedderSpec.create({
        provider: "fastembed",
        model: undefined as unknown as string,
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects invalid dimensions (NaN, fractional, zero, negative)", () => {
    expect(() =>
      EmbedderSpec.create({
        provider: "voyage",
        model: "x",
        dim: Number.NaN,
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      EmbedderSpec.create({ provider: "voyage", model: "x", dim: 1.5 }),
    ).toThrow(InvalidInputError);
    expect(() =>
      EmbedderSpec.create({ provider: "voyage", model: "x", dim: 0 }),
    ).toThrow(InvalidInputError);
    expect(() =>
      EmbedderSpec.create({ provider: "voyage", model: "x", dim: -1 }),
    ).toThrow(InvalidInputError);
  });

  it("equals + producesSameVectorsAs", () => {
    const a = EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" });
    const b = EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" });
    const c = EmbedderSpec.create({
      provider: "fastembed",
      model: "BGELargeEN",
      dim: 1024,
    });
    expect(a.equals(b)).toBe(true);
    expect(a.producesSameVectorsAs(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
