import { describe, expect, it } from "vitest";

import { RetrievalInfrastructureError } from "../../../../src/modules/retrieval/infrastructure/errors/retrieval-infrastructure-error.ts";

describe("RetrievalInfrastructureError", () => {
  describe("tiktokenLoadFailed factory", () => {
    it("returns a RetrievalInfrastructureError instance", () => {
      const e = RetrievalInfrastructureError.tiktokenLoadFailed(
        new Error("boom"),
      );
      expect(e).toBeInstanceOf(RetrievalInfrastructureError);
      expect(e).toBeInstanceOf(Error);
    });

    it("has stable kebab-case code", () => {
      const e = RetrievalInfrastructureError.tiktokenLoadFailed(
        new Error("boom"),
      );
      expect(e.code).toBe("retrieval.tiktoken-load-failed");
    });

    it("captures the cause non-enumerably (not in JSON.stringify)", () => {
      const cause = new Error("inner cause text");
      const e = RetrievalInfrastructureError.tiktokenLoadFailed(cause);
      const json = JSON.stringify(e);
      expect(json).not.toContain("inner cause text");
      // The cause property is still accessible programmatically.
      const eAny = e as Error & { cause?: unknown };
      expect(eAny.cause).toBe(cause);
    });

    it("has a meaningful message", () => {
      const e = RetrievalInfrastructureError.tiktokenLoadFailed(
        new Error("nope"),
      );
      expect(e.message).toContain("tiktoken");
    });

    it("sets the name to the concrete subclass name", () => {
      const e = RetrievalInfrastructureError.tiktokenLoadFailed(
        new Error("nope"),
      );
      expect(e.name).toBe("TiktokenLoadFailedError");
    });
  });

  describe("permanentEmbeddingFailure factory", () => {
    it("captures queueId and attempts on the error", () => {
      const e = RetrievalInfrastructureError.permanentEmbeddingFailure(
        "01952f3b-7d8c-7000-8000-q00000000001",
        5,
      );
      const eAny = e as RetrievalInfrastructureError & {
        queueId: string;
        attempts: number;
      };
      expect(eAny.queueId).toBe("01952f3b-7d8c-7000-8000-q00000000001");
      expect(eAny.attempts).toBe(5);
    });

    it("has stable kebab-case code", () => {
      const e = RetrievalInfrastructureError.permanentEmbeddingFailure(
        "qid",
        5,
      );
      expect(e.code).toBe("retrieval.permanent-embedding-failure");
    });

    it("includes the queueId and attempts in the message", () => {
      const e = RetrievalInfrastructureError.permanentEmbeddingFailure(
        "qid-x",
        7,
      );
      expect(e.message).toContain("qid-x");
      expect(e.message).toContain("7");
    });
  });

  it("instanceof RetrievalInfrastructureError catches every concrete subclass", () => {
    const e1 = RetrievalInfrastructureError.tiktokenLoadFailed(
      new Error("x"),
    );
    const e2 = RetrievalInfrastructureError.permanentEmbeddingFailure(
      "qid",
      5,
    );
    expect(e1).toBeInstanceOf(RetrievalInfrastructureError);
    expect(e2).toBeInstanceOf(RetrievalInfrastructureError);
  });
});
