import { describe, expect, it } from "vitest";
import { EmbeddingVector } from "../../../../src/modules/retrieval/domain/value-objects/embedding-vector.ts";
import { EmbeddingDimensionMismatchError } from "../../../../src/modules/retrieval/domain/errors/embedding-dimension-mismatch-error.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("EmbeddingVector", () => {
  describe("create", () => {
    it("accepts a Float32Array", () => {
      const v = EmbeddingVector.create(new Float32Array([1, 2, 3]));
      expect(v.dim()).toBe(3);
    });

    it("accepts a plain number[]", () => {
      const v = EmbeddingVector.create([0.5, -0.5, 0.25]);
      expect(v.dim()).toBe(3);
    });

    it("rejects an empty Float32Array", () => {
      expect(() => EmbeddingVector.create(new Float32Array([]))).toThrow(
        InvalidInputError,
      );
    });

    it("rejects an empty number[]", () => {
      expect(() => EmbeddingVector.create([])).toThrow(InvalidInputError);
    });

    it("rejects a NaN component (Float32Array)", () => {
      expect(() =>
        EmbeddingVector.create(new Float32Array([1, Number.NaN, 3])),
      ).toThrow(InvalidInputError);
    });

    it("rejects a NaN component (number[])", () => {
      expect(() => EmbeddingVector.create([1, Number.NaN, 3])).toThrow(
        InvalidInputError,
      );
    });

    it("rejects a non-finite component (number[])", () => {
      expect(() =>
        EmbeddingVector.create([1, Number.POSITIVE_INFINITY, 3]),
      ).toThrow(InvalidInputError);
    });

    it("rejects an undefined element in a sparse number[]", () => {
      // `[1, undefined, 3]` would be flagged as `(number | undefined)[]`;
      // we cast through unknown so the validation runs at the VO factory.
      const sparse: readonly number[] = [1, undefined as unknown as number, 3];
      expect(() => EmbeddingVector.create(sparse)).toThrow(InvalidInputError);
    });

    it("rejects non-array, non-typed-array inputs", () => {
      expect(() =>
        EmbeddingVector.create(
          ("foo" as unknown) as readonly number[],
        ),
      ).toThrow(InvalidInputError);
    });

    it("makes a defensive copy (caller cannot mutate)", () => {
      const src = new Float32Array([1, 2, 3]);
      const v = EmbeddingVector.create(src);
      src[0] = 99;
      v.withVector((buf) => {
        expect(buf[0]).toBe(1);
      });
    });
  });

  describe("dim", () => {
    it("returns the component count", () => {
      const v = EmbeddingVector.create([0, 0, 0, 0, 0]);
      expect(v.dim()).toBe(5);
    });
  });

  describe("cosineDistance", () => {
    it("returns 0 for identical unit vectors", () => {
      const v = EmbeddingVector.create([1, 0, 0]);
      expect(v.cosineDistance(v)).toBe(0);
    });

    it("returns 1 for orthogonal vectors", () => {
      const a = EmbeddingVector.create([1, 0]);
      const b = EmbeddingVector.create([0, 1]);
      expect(a.cosineDistance(b)).toBeCloseTo(1, 5);
    });

    it("returns 2 for opposite-pointing vectors", () => {
      const a = EmbeddingVector.create([1, 0]);
      const b = EmbeddingVector.create([-1, 0]);
      expect(a.cosineDistance(b)).toBeCloseTo(2, 5);
    });

    it("returns 0 for two zero-vectors (special case)", () => {
      const a = EmbeddingVector.create([0, 0, 0]);
      const b = EmbeddingVector.create([0, 0, 0]);
      expect(a.cosineDistance(b)).toBe(0);
    });

    it("returns 0 when one vector is zero (special case)", () => {
      const a = EmbeddingVector.create([0, 0, 0]);
      const b = EmbeddingVector.create([1, 2, 3]);
      expect(a.cosineDistance(b)).toBe(0);
    });

    it("rejects mismatched dimensions", () => {
      const a = EmbeddingVector.create([1, 0]);
      const b = EmbeddingVector.create([1, 0, 0]);
      expect(() => a.cosineDistance(b)).toThrow(
        EmbeddingDimensionMismatchError,
      );
    });
  });

  describe("cosineSimilarityTo", () => {
    it("returns 1 for identical vectors", () => {
      const v = EmbeddingVector.create([0.6, 0.8]);
      expect(v.cosineSimilarityTo(v).toNumber()).toBeCloseTo(1, 5);
    });

    it("clamps negative similarity to 0", () => {
      const a = EmbeddingVector.create([1, 0]);
      const b = EmbeddingVector.create([-1, 0]);
      expect(a.cosineSimilarityTo(b).toNumber()).toBe(0);
    });
  });

  describe("withVector", () => {
    it("exposes the underlying buffer to the callback", () => {
      const v = EmbeddingVector.create([1, 2, 3]);
      const sum = v.withVector((buf) => {
        let s = 0;
        for (const x of buf) s += x;
        return s;
      });
      expect(sum).toBe(6);
    });
  });

  describe("toFloat32Array", () => {
    it("returns a defensive copy", () => {
      const v = EmbeddingVector.create([1, 2, 3]);
      const out = v.toFloat32Array();
      out[0] = 99;
      v.withVector((buf) => {
        expect(buf[0]).toBe(1);
      });
    });
  });

  describe("equals", () => {
    it("returns true for the same instance", () => {
      const v = EmbeddingVector.create([1, 2, 3]);
      expect(v.equals(v)).toBe(true);
    });

    it("returns true for component-by-component matches", () => {
      const a = EmbeddingVector.create([1, 2, 3]);
      const b = EmbeddingVector.create([1, 2, 3]);
      expect(a.equals(b)).toBe(true);
    });

    it("returns false for different dimensions", () => {
      const a = EmbeddingVector.create([1, 2]);
      const b = EmbeddingVector.create([1, 2, 3]);
      expect(a.equals(b)).toBe(false);
    });

    it("returns false for any component mismatch", () => {
      const a = EmbeddingVector.create([1, 2, 3]);
      const b = EmbeddingVector.create([1, 2, 4]);
      expect(a.equals(b)).toBe(false);
    });
  });
});
