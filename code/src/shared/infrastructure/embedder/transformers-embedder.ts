import {
  pipeline,
  type FeatureExtractionPipeline,
  type Tensor,
} from "@huggingface/transformers";

import type {
  Embedder,
  RawEmbedding,
} from "../../application/ports/embedder.port.ts";
import { EmbedderError } from "../errors/embedder-error.ts";

/**
 * Curated model identifiers supported by the adapter.
 *
 * Naming convention: the `Xenova/` repos are the ONNX-exported mirrors
 * of the canonical `BAAI/` / `sentence-transformers/` model weights that
 * `@huggingface/transformers@4.x` consumes via its `pipeline()` entry
 * point. The dimensions below match the upstream model cards verified
 * 2026-05-12 (see `HANDOFF.md` §6.32 HIGH research). Dimension parity
 * with the fastembed catalog is intentional: switching the underlying
 * backend MUST NOT silently change `embedding_metadata.dimension`
 * because the `sqlite-vec` index is sized at create time.
 */
export type TransformersModelName =
  | "Xenova/bge-small-en-v1.5"
  | "Xenova/bge-base-en-v1.5"
  | "Xenova/all-MiniLM-L6-v2";

/**
 * Construction options for {@link TransformersEmbedder}.
 *
 * - `modelName` — one of the curated identifiers above. Default
 *   `Xenova/bge-small-en-v1.5` (parity with fastembed
 *   `BGESmallENV15`).
 * - `cacheDir` — directory where HuggingFace assets (ONNX weights,
 *   tokenizer, config) are downloaded and cached. Default is the
 *   transformers.js fallback, but the composition root pins
 *   `~/.cache/recall/models/` so both backends share the same cache
 *   layout (see `docs/03-modelo-datos.md` §1).
 * - `pooling` / `normalize` — pinned to `mean` and `true` respectively
 *   to match fastembed's BGE default output (sentence embeddings,
 *   L2-normalised). Exposed for tests but not part of the public
 *   composition surface.
 * - `localFilesOnly` — when `true`, the pipeline refuses to fetch
 *   from the Hub and only reads `cacheDir`. Used by offline integration
 *   tests after a seeded download.
 */
export interface TransformersEmbedderOptions {
  readonly modelName?: TransformersModelName | undefined;
  readonly cacheDir?: string | undefined;
  readonly pooling?: "mean" | "cls" | undefined;
  readonly normalize?: boolean | undefined;
  readonly localFilesOnly?: boolean | undefined;
}

/**
 * Static catalog of model dimensions supported by the adapter.
 *
 * Why hard-coded:
 * - The `pipeline()` factory in `@huggingface/transformers` resolves
 *   the dimension only AFTER the ONNX session has been constructed
 *   (the model config drives the output shape). The adapter exposes
 *   {@link TransformersEmbedder.dimension} synchronously (the port
 *   contract requires it) so the value MUST be known before the model
 *   downloads. The dimensions below are the official ones for each
 *   model variant — verified against the upstream model cards
 *   2026-05-12.
 *
 * Adding a new variant requires:
 * 1. Confirming the dimension against the model card on huggingface.co.
 * 2. Updating this map.
 * 3. Updating the workspace `EmbedderSpec` value object if the variant
 *    must be persistable in `config.json`.
 */
const TRANSFORMERS_DIMENSIONS: Readonly<Record<TransformersModelName, number>> =
  Object.freeze({
    "Xenova/bge-small-en-v1.5": 384,
    "Xenova/bge-base-en-v1.5": 768,
    "Xenova/all-MiniLM-L6-v2": 384,
  });

const DEFAULT_MODEL: TransformersModelName = "Xenova/bge-small-en-v1.5";

/**
 * Adapter that fulfils the {@link Embedder} port using
 * `@huggingface/transformers` (transformers.js).
 *
 * Why this adapter replaced the legacy `FastembedEmbedder` (removed in
 * `v0.1.3`):
 * - `fastembed@2.x` transitively depended on `tar@^6` which carries
 *   6 high-severity advisories (`tar/tar-fs` path traversal /
 *   symlink poisoning). Upstream `fastembed` had no timeline to bump
 *   to `tar@7`; `npm audit fix` would have downgraded to
 *   `fastembed@1.0.0`, breaking the API.
 *   `@huggingface/transformers@4.x` is actively maintained by
 *   HuggingFace, ships 0 high-severity advisories, and supports the
 *   exact same BGE-small-en-v1.5 model with dimension parity (384).
 *
 * Lifecycle:
 * - The constructor is **lazy**: the underlying ONNX session is NOT
 *   loaded until the first {@link TransformersEmbedder.embed} or
 *   {@link TransformersEmbedder.embedBatch} call. This keeps cold-start
 *   latency off the MCP server's `initialize` handshake.
 * - `dimension()` is callable at any time because the dimension is
 *   pinned by the static catalog above.
 *
 * Concurrency:
 * - The lazy load is gated by a single `Promise<FeatureExtractionPipeline>`
 *   field. Concurrent first callers share the same load promise; only
 *   one ONNX session is created per adapter instance.
 *
 * Pooling / normalisation:
 * - Pinned to `pooling: "mean"` + `normalize: true` to match the BGE
 *   sentence-embedding convention (cosine similarity over L2-normalised
 *   mean-pooled vectors). This is also what `fastembed` returns for its
 *   BGE variants, so vector magnitudes are compatible across the two
 *   backends (numerical values still differ — see migration notes in
 *   `HANDOFF.md` §6.32).
 *
 * Truncation policy:
 * - The pipeline tokenises with the model's pinned tokenizer and
 *   truncates to the model's max sequence length (512 for BGE-small).
 *   The adapter does NOT pad short inputs; the tokenizer handles that
 *   internally.
 * - Empty strings: returned as the model's mean-pooled padding-token
 *   embedding (transformers.js default). The retrieval domain is
 *   documented to cope with zero-magnitude vectors gracefully, so we
 *   do NOT reject empty inputs at this layer.
 *
 * Errors:
 * - {@link EmbedderError.initialisationFailed} on first `embed()` if
 *   the pipeline cannot download or instantiate the model.
 * - {@link EmbedderError.embedFailed} on per-call inference failures.
 * - {@link EmbedderError.dimensionMismatch} if transformers.js produces
 *   a vector whose dimension disagrees with the catalog (defence in
 *   depth — should never happen).
 *
 * Composition root example:
 * ```typescript
 * const embedder = new TransformersEmbedder({
 *   modelName: "Xenova/bge-small-en-v1.5",
 *   cacheDir: path.join(homedir, ".cache", "recall", "models"),
 * });
 * const { vector } = await embedder.embed("first query"); // model loads here
 * ```
 */
export class TransformersEmbedder implements Embedder {
  private readonly modelName: TransformersModelName;
  private readonly cacheDir: string | undefined;
  private readonly pooling: "mean" | "cls";
  private readonly normalize: boolean;
  private readonly localFilesOnly: boolean;
  private readonly pinnedDimension: number;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null;

  public constructor(options: TransformersEmbedderOptions = {}) {
    this.modelName = options.modelName ?? DEFAULT_MODEL;
    this.cacheDir = options.cacheDir;
    this.pooling = options.pooling ?? "mean";
    this.normalize = options.normalize ?? true;
    this.localFilesOnly = options.localFilesOnly ?? false;
    const dim = TRANSFORMERS_DIMENSIONS[this.modelName];
    this.pinnedDimension = dim;
    this.pipelinePromise = null;
  }

  public dimension(): number {
    return this.pinnedDimension;
  }

  public async embed(text: string): Promise<RawEmbedding> {
    const [result] = await this.embedBatch([text]);
    if (result === undefined) {
      throw EmbedderError.embedFailed(
        new Error(
          "@huggingface/transformers returned no vector for non-empty input batch",
        ),
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
    const extractor = await this.ensurePipeline();
    let tensor: Tensor;
    try {
      tensor = await extractor([...texts], {
        pooling: this.pooling,
        normalize: this.normalize,
      });
    } catch (cause: unknown) {
      throw EmbedderError.embedFailed(cause);
    }

    const dims = tensor.dims;
    if (
      dims.length !== 2 ||
      dims[0] !== texts.length ||
      dims[1] !== this.pinnedDimension
    ) {
      throw EmbedderError.dimensionMismatch(
        this.pinnedDimension,
        dims.length === 2 && typeof dims[1] === "number"
          ? dims[1]
          : tensor.data.length,
      );
    }

    const data = tensor.data;
    if (!(data instanceof Float32Array)) {
      throw EmbedderError.embedFailed(
        new Error(
          `@huggingface/transformers returned ${data.constructor.name} but Float32Array was expected`,
        ),
      );
    }

    const out: RawEmbedding[] = [];
    for (let i = 0; i < texts.length; i += 1) {
      const start = i * this.pinnedDimension;
      const end = start + this.pinnedDimension;
      out.push({
        dimension: this.pinnedDimension,
        vector: data.slice(start, end),
      });
    }
    return Object.freeze(out);
  }

  /**
   * Returns the lazily-loaded transformers.js pipeline. Concurrent
   * first callers share the same promise so the model is loaded
   * exactly once per adapter instance.
   */
  private async ensurePipeline(): Promise<FeatureExtractionPipeline> {
    this.pipelinePromise ??= this.loadPipeline();
    try {
      return await this.pipelinePromise;
    } catch (cause: unknown) {
      this.pipelinePromise = null;
      if (cause instanceof EmbedderError) throw cause;
      throw EmbedderError.initialisationFailed(cause);
    }
  }

  private async loadPipeline(): Promise<FeatureExtractionPipeline> {
    try {
      return await pipeline("feature-extraction", this.modelName, {
        dtype: "fp32",
        local_files_only: this.localFilesOnly,
        ...(this.cacheDir !== undefined ? { cache_dir: this.cacheDir } : {}),
      });
    } catch (cause: unknown) {
      throw EmbedderError.initialisationFailed(cause);
    }
  }
}
