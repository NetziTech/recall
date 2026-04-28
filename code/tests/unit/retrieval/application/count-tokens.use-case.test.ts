import { describe, expect, it } from "vitest";

import { CountTokensUseCase } from "../../../../src/modules/retrieval/application/use-cases/count-tokens.use-case.ts";
import type { TokenCounter } from "../../../../src/modules/retrieval/domain/services/token-counter.ts";
import { Tokens } from "../../../../src/shared/domain/value-objects/tokens.ts";

/**
 * In-memory `TokenCounter` stub. Records every call so tests can
 * verify the use case is a thin pass-through with no extra logic.
 */
class StubTokenCounter implements TokenCounter {
  public readonly counted: string[] = [];
  public readonly batchCounted: (readonly string[])[] = [];

  public constructor(
    private readonly mapping: (text: string) => number = (t) => t.length,
  ) {}

  public count(text: string): Tokens {
    this.counted.push(text);
    return Tokens.of(this.mapping(text));
  }

  public countBatch(texts: readonly string[]): Promise<readonly Tokens[]> {
    this.batchCounted.push(texts);
    return Promise.resolve(texts.map((t) => Tokens.of(this.mapping(t))));
  }
}

describe("CountTokensUseCase", () => {
  it("delegates to the injected TokenCounter and returns its Tokens VO", async () => {
    const counter = new StubTokenCounter((t) => t.length * 2);
    const useCase = new CountTokensUseCase(counter);

    const result = await useCase.count("hello");

    expect(result).toBeInstanceOf(Tokens);
    expect(result.toNumber()).toBe(10);
    expect(counter.counted).toEqual(["hello"]);
  });

  it("forwards the empty string verbatim", async () => {
    const counter = new StubTokenCounter(() => 0);
    const useCase = new CountTokensUseCase(counter);

    const result = await useCase.count("");

    expect(result.toNumber()).toBe(0);
    expect(counter.counted).toEqual([""]);
  });

  it("does not call countBatch (single-text path)", async () => {
    const counter = new StubTokenCounter();
    const useCase = new CountTokensUseCase(counter);

    await useCase.count("alpha");
    await useCase.count("beta");

    expect(counter.batchCounted).toEqual([]);
    expect(counter.counted).toEqual(["alpha", "beta"]);
  });

  it("returns a Promise (callers can `await` even though counter is sync)", () => {
    const counter = new StubTokenCounter(() => 1);
    const useCase = new CountTokensUseCase(counter);
    expect(useCase.count("x")).toBeInstanceOf(Promise);
  });
});
