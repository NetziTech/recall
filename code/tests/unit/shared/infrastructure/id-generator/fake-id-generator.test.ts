import { describe, it, expect } from "vitest";

import { FakeIdGenerator } from "../../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { Id } from "../../../../../src/shared/domain/value-objects/id.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("FakeIdGenerator (counter mode)", () => {
  it("default seed = 1, emits the documented prefix", () => {
    const g = new FakeIdGenerator();
    expect(g.generateString()).toBe("00000000-0000-7000-8000-000000000001");
    expect(g.generateString()).toBe("00000000-0000-7000-8000-000000000002");
    expect(g.generateString()).toBe("00000000-0000-7000-8000-000000000003");
  });

  it("respects custom seed", () => {
    const g = new FakeIdGenerator({ seed: 10 });
    expect(g.generateString()).toBe("00000000-0000-7000-8000-00000000000a");
    expect(g.generateString()).toBe("00000000-0000-7000-8000-00000000000b");
  });

  it("seed = 0 is allowed", () => {
    const g = new FakeIdGenerator({ seed: 0 });
    expect(g.generateString()).toBe("00000000-0000-7000-8000-000000000000");
  });

  it("rejects fractional seed", () => {
    expect(() => new FakeIdGenerator({ seed: 1.5 })).toThrow(InvalidInputError);
  });

  it("rejects negative seed", () => {
    expect(() => new FakeIdGenerator({ seed: -1 })).toThrow(InvalidInputError);
  });

  it("rejects counter overflow beyond 12 hex digits", () => {
    const g = new FakeIdGenerator({ seed: 0xff_ff_ff_ff_ff_ff });
    expect(g.generateString()).toBe("00000000-0000-7000-8000-ffffffffffff");
    expect(() => g.generateString()).toThrow(InvalidInputError);
  });

  it("generate returns an Id instance whose value matches generateString", () => {
    const g = new FakeIdGenerator();
    const id = g.generate();
    expect(id).toBeInstanceOf(Id);
    expect(id.toString()).toBe("00000000-0000-7000-8000-000000000001");
  });

  it("yields uniques across many calls", () => {
    const g = new FakeIdGenerator();
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      seen.add(g.generateString());
    }
    expect(seen.size).toBe(100);
  });
});

describe("FakeIdGenerator (sequence mode)", () => {
  const SEQ = [
    "01952f3b-7d8c-7b4a-94f1-a3f8d12e5c89",
    "01952f3c-2222-7000-8000-aaaaaaaaaaaa",
  ] as const;

  it("yields entries in order", () => {
    const g = new FakeIdGenerator({ sequence: SEQ });
    expect(g.generateString()).toBe(SEQ[0]);
    expect(g.generateString()).toBe(SEQ[1]);
  });

  it("throws on exhaustion", () => {
    const g = new FakeIdGenerator({ sequence: [SEQ[0]] });
    g.generateString();
    expect(() => g.generateString()).toThrow(InvalidInputError);
  });

  it("rejects malformed sequence entries at construction", () => {
    expect(() => new FakeIdGenerator({ sequence: ["not-a-uuid"] })).toThrow(
      InvalidInputError,
    );
  });

  it("rejects passing both seed and sequence", () => {
    expect(
      () => new FakeIdGenerator({ seed: 1, sequence: [SEQ[0]] }),
    ).toThrow(InvalidInputError);
  });

  it("falls back to counter mode when sequence is empty array", () => {
    const g = new FakeIdGenerator({ sequence: [] });
    expect(g.generateString()).toBe("00000000-0000-7000-8000-000000000001");
  });
});
