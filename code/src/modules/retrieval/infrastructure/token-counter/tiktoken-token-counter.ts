import { get_encoding, type Tiktoken, type TiktokenEncoding } from "tiktoken";

import { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { TokenCounter } from "../../domain/services/token-counter.ts";

/**
 * Default encoding name. Matches the policy in
 * `docs/04-capas-contexto.md` §10 ("modelo cl100k_base — GPT-4 /
 * Claude approximation"). The constant is the only place the magic
 * string lives.
 */
const DEFAULT_ENCODING: TiktokenEncoding = "cl100k_base";

/**
 * Construction options for {@link TiktokenTokenCounter}.
 *
 * The factory is injectable so tests can supply a fake encoder that
 * does not pay the BPE-merges load cost.
 */
export interface TiktokenTokenCounterOptions {
  /**
   * Tiktoken encoding name. Defaults to `cl100k_base`.
   */
  readonly encoding?: TiktokenEncoding;

  /**
   * Factory that produces the encoder handle. Defaults to
   * `tiktoken.get_encoding`. Tests inject a no-allocation fake.
   */
  readonly factory?: (encoding: TiktokenEncoding) => Tiktoken;
}

/**
 * Token-counter adapter backed by `tiktoken`.
 *
 * Mirrors the `TokenCounter` driven port documented in
 * `domain/services/token-counter.ts` and used by
 * `RecallMemoryUseCase` and `GetContextBundleUseCase`.
 *
 * Lifecycle:
 * - The adapter holds a single encoder handle for its lifetime. The
 *   handle owns native (WASM) memory: the composition root MUST call
 *   {@link TiktokenTokenCounter.dispose} at server shutdown so the
 *   WASM heap is released. Letting the GC reclaim the handle is fine
 *   for tests but leaks native memory in long-lived processes.
 *
 * Performance:
 * - The encoder load is paid once at construction. Every subsequent
 *   `count(...)` is a few microseconds (the BPE merges are pre-loaded
 *   and the WASM call is a tight loop).
 * - The `cl100k_base` encoding is the right call for Claude/GPT-4
 *   compatibility per `docs/04-capas-contexto.md` §10.
 *
 * Errors:
 * - `tiktoken.get_encoding` throws if the encoding name is not in the
 *   shipped catalogue; the adapter surfaces the error unchanged
 *   (composition root catches it as a fatal start-up failure).
 */
export class TiktokenTokenCounter implements TokenCounter {
  private readonly encoder: Tiktoken;
  private disposed: boolean;

  public constructor(options?: TiktokenTokenCounterOptions) {
    const encoding = options?.encoding ?? DEFAULT_ENCODING;
    const factory = options?.factory ?? get_encoding;
    this.encoder = factory(encoding);
    this.disposed = false;
  }

  public count(text: string): Tokens {
    if (this.disposed) {
      throw new Error("TiktokenTokenCounter has been disposed");
    }
    const ids = this.encoder.encode(text);
    return Tokens.of(ids.length);
  }

  public countBatch(texts: readonly string[]): Promise<readonly Tokens[]> {
    const out: Tokens[] = [];
    for (const text of texts) {
      out.push(this.count(text));
    }
    return Promise.resolve(Object.freeze(out));
  }

  /**
   * Releases the underlying encoder's native memory. Idempotent.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.encoder.free();
  }
}
