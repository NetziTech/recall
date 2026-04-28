import { EmbeddingModel, FlagEmbedding } from "fastembed";

import type {
  Embedder,
  RawEmbedding,
} from "../../application/ports/embedder.port.ts";
import { EmbedderError } from "../errors/embedder-error.ts";

/**
 * Subset of `fastembed`'s {@link EmbeddingModel} that the adapter
 * accepts. The CUSTOM variant is excluded because it requires
 * filesystem-side model registration which the workspace flow does
 * not expose yet (`docs/06 §6` only lists the curated catalog).
 */
export type FastembedModelName = Exclude<
  EmbeddingModel,
  EmbeddingModel.CUSTOM
>;

/**
 * Construction options for {@link FastembedEmbedder}.
 *
 * - `modelName` — one of the curated fastembed models. Default
 *   `BGESmallENV15` (the one pinned in `docs/06 §6`).
 * - `cacheDir` — directory where ONNX weights are downloaded and
 *   cached. Default `~/.cache/recall/models/` per
 *   `docs/03-modelo-datos.md` §1 (resolved by the composition root, not
 *   here, so the adapter stays portable for tests with a temp dir).
 * - `maxLength` — token cap applied at tokenisation time. fastembed
 *   silently truncates inputs longer than `maxLength`; the adapter
 *   keeps the cap explicit so the workspace can document the policy
 *   and so that pre-flight checks (e.g. mem.recall query length) can
 *   compare against the same constant.
 * - `showDownloadProgress` — when `false` (default), suppresses
 *   fastembed's progress bar so the MCP stdio transport stays clean.
 */
export interface FastembedEmbedderOptions {
  readonly modelName?: FastembedModelName | undefined;
  readonly cacheDir?: string | undefined;
  readonly maxLength?: number | undefined;
  readonly showDownloadProgress?: boolean | undefined;
}

/**
 * Static catalog of model dimensions supported by the adapter.
 *
 * Why hard-coded:
 * - The fastembed `listSupportedModels()` API returns the dimension
 *   alongside the model name, but only AFTER the underlying
 *   FlagEmbedding instance has been constructed. The adapter exposes
 *   {@link FastembedEmbedder.dimension} synchronously (the port
 *   contract requires it) so the value MUST be known before the model
 *   downloads. The dimensions below are the official ones for each
 *   model variant — verified against the fastembed v2.1 source on
 *   2026-04-27.
 *
 * Adding a new variant requires:
 * 1. Confirming the dimension against the upstream `listSupportedModels()`.
 * 2. Updating this map.
 * 3. Updating the workspace `EmbedderSpec` value object so config.json
 *    can persist the new variant.
 */
const FASTEMBED_DIMENSIONS: Readonly<Record<FastembedModelName, number>> = {
  [EmbeddingModel.AllMiniLML6V2]: 384,
  [EmbeddingModel.BGEBaseEN]: 768,
  [EmbeddingModel.BGEBaseENV15]: 768,
  [EmbeddingModel.BGESmallEN]: 384,
  [EmbeddingModel.BGESmallENV15]: 384,
  [EmbeddingModel.BGESmallZH]: 512,
  [EmbeddingModel.MLE5Large]: 1024,
};

const DEFAULT_MODEL: FastembedModelName = EmbeddingModel.BGESmallENV15;

/**
 * Adapter that fulfils the {@link Embedder} port using `fastembed`.
 *
 * Lifecycle:
 * - The constructor is **lazy**: the underlying ONNX model is NOT
 *   loaded until the first {@link FastembedEmbedder.embed} or
 *   {@link FastembedEmbedder.embedBatch} call. This keeps cold-start
 *   latency off the MCP server's `initialize` handshake — the model
 *   only loads when a recall actually requests an embedding.
 * - `dimension()` is callable at any time because the dimension is
 *   pinned by the static catalog above.
 *
 * Concurrency:
 * - The lazy load is gated by a single `Promise<FlagEmbedding>` field.
 *   Concurrent first calls share the same load promise; only one ONNX
 *   session is created per adapter instance.
 *
 * Truncation policy:
 * - Inputs longer than `maxLength` tokens are truncated by fastembed
 *   on the way in (configured at tokenizer construction). The adapter
 *   does NOT pad short inputs; fastembed handles that internally.
 * - Empty strings: returned as the model's mean-pooled padding
 *   vector (fastembed's default). The retrieval domain is documented
 *   to cope with zero-magnitude vectors gracefully, so we do NOT
 *   reject empty inputs at this layer.
 *
 * Errors:
 * - {@link EmbedderError.initialisationFailed} on first `embed()` if
 *   the model cannot be downloaded or loaded.
 * - {@link EmbedderError.embedFailed} on per-call inference failures.
 * - {@link EmbedderError.dimensionMismatch} if fastembed produces a
 *   vector whose dimension disagrees with the catalog (defence in
 *   depth — should never happen).
 *
 * Composition root example:
 * ```typescript
 * const embedder = new FastembedEmbedder({
 *   modelName: EmbeddingModel.BGESmallENV15,
 *   cacheDir: path.join(homedir, ".cache", "recall", "models"),
 *   maxLength: 512,
 * });
 * const { vector } = await embedder.embed("first query"); // model loads here
 * ```
 */
export class FastembedEmbedder implements Embedder {
  private readonly modelName: FastembedModelName;
  private readonly cacheDir: string | undefined;
  private readonly maxLength: number;
  private readonly showDownloadProgress: boolean;
  private readonly pinnedDimension: number;
  private modelPromise: Promise<FlagEmbedding> | null;

  public constructor(options: FastembedEmbedderOptions = {}) {
    this.modelName = options.modelName ?? DEFAULT_MODEL;
    this.cacheDir = options.cacheDir;
    this.maxLength = options.maxLength ?? 512;
    this.showDownloadProgress = options.showDownloadProgress ?? false;
    const dim = FASTEMBED_DIMENSIONS[this.modelName];
    this.pinnedDimension = dim;
    this.modelPromise = null;
  }

  public dimension(): number {
    return this.pinnedDimension;
  }

  public async embed(text: string): Promise<RawEmbedding> {
    const [result] = await this.embedBatch([text]);
    if (result === undefined) {
      throw EmbedderError.embedFailed(
        new Error("fastembed returned no vector for non-empty input batch"),
      );
    }
    return result;
  }

  public async embedBatch(
    texts: readonly string[],
  ): Promise<readonly RawEmbedding[]> {
    if (texts.length === 0) {
      return Object.freeze([]);
    }
    const model = await this.ensureModel();
    const out: RawEmbedding[] = [];
    try {
      // fastembed's `embed` is an async generator that yields chunks
      // (one per batch). We aggregate them into a single ordered list
      // and convert each to a Float32Array (the port contract).
      const generator = model.embed([...texts], texts.length);
      for await (const chunk of generator) {
        for (const numberArray of chunk) {
          if (numberArray.length !== this.pinnedDimension) {
            throw EmbedderError.dimensionMismatch(
              this.pinnedDimension,
              numberArray.length,
            );
          }
          // The port owns the buffer; copy into a fresh Float32Array
          // so the caller cannot have it mutated under them by future
          // generator iterations.
          out.push({
            dimension: this.pinnedDimension,
            vector: Float32Array.from(numberArray),
          });
        }
      }
    } catch (cause: unknown) {
      if (cause instanceof EmbedderError) throw cause;
      throw EmbedderError.embedFailed(cause);
    }

    if (out.length !== texts.length) {
      throw EmbedderError.embedFailed(
        new Error(
          `fastembed returned ${String(out.length)} vectors for ${String(texts.length)} inputs`,
        ),
      );
    }
    return Object.freeze(out);
  }

  /**
   * Returns the lazily-loaded fastembed model. Concurrent first
   * callers share the same promise so the model is loaded exactly
   * once per adapter instance.
   */
  private async ensureModel(): Promise<FlagEmbedding> {
    this.modelPromise ??= this.loadModel();
    try {
      return await this.modelPromise;
    } catch (cause: unknown) {
      // Reset on failure so a later retry can attempt the load again
      // (e.g. after the user fixes connectivity for the GCS download).
      this.modelPromise = null;
      if (cause instanceof EmbedderError) throw cause;
      throw EmbedderError.initialisationFailed(cause);
    }
  }

  private async loadModel(): Promise<FlagEmbedding> {
    try {
      // fastembed accepts the union of `InitStandardOptions` /
      // `InitCustomOptions`; we strictly use the standard branch.
      return await FlagEmbedding.init({
        model: this.modelName,
        maxLength: this.maxLength,
        showDownloadProgress: this.showDownloadProgress,
        ...(this.cacheDir !== undefined ? { cacheDir: this.cacheDir } : {}),
      });
    } catch (cause: unknown) {
      throw EmbedderError.initialisationFailed(cause);
    }
  }
}
