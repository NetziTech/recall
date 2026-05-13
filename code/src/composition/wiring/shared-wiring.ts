/**
 * Wires the shared cross-module adapters that every module needs:
 * `Logger`, `Clock`, `IdGenerator`, the cross-module `Embedder`
 * port, and the retrieval-flavoured embedder adapter.
 *
 * Why this lives in `composition/wiring/`:
 * - The shared adapters are portable but their construction (cache
 *   directory for the embedder, log level, etc.) is environment-driven.
 *   Hiding the construction here keeps the bootstrap entrypoint thin.
 *
 * Embedder backend:
 * - `TransformersEmbedder` (`@huggingface/transformers`) is the sole
 *   backend. The legacy `FastembedEmbedder` was removed in `v0.1.3`
 *   because its transitive `tar@^6` carried 6 high-severity advisories
 *   (`swap-embedder-tar7` follow-up). Dimension parity (384) and
 *   L2-normalised output are preserved against `Xenova/bge-small-en-v1.5`
 *   — see `HANDOFF.md` §6.32 for the POC parity report.
 *
 * What this file does NOT decide:
 * - The encryption key material: that flows from the encryption-wiring
 *   to the workspace's `DatabaseBootstrap` adapter, never via this
 *   helper.
 * - The workspace path: the bootstrap entrypoint resolves the path
 *   before calling into the wiring helpers.
 */

import * as os from "node:os";
import * as path from "node:path";

import type { Clock } from "../../shared/application/ports/clock.port.ts";
import type { Embedder as RawEmbedder } from "../../shared/application/ports/embedder.port.ts";
import type { IdGenerator } from "../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../shared/application/ports/logger.port.ts";
import {
  TransformersEmbedder,
  type TransformersEmbedderOptions,
} from "../../shared/infrastructure/embedder/transformers-embedder.ts";
import { SystemClock } from "../../shared/infrastructure/clock/system-clock.ts";
import { UuidV7IdGenerator } from "../../shared/infrastructure/id-generator/uuid-v7-id-generator.ts";
import {
  PinoLogger,
  type PinoLoggerOptions,
} from "../../shared/infrastructure/logger/pino-logger.ts";
import type { Embedder as RetrievalEmbedder } from "../../modules/retrieval/domain/services/embedder.ts";
import { RawEmbedderAdapter } from "../../modules/retrieval/infrastructure/embedder/raw-embedder-adapter.ts";

/**
 * Bag of cross-cutting adapters every other wiring helper needs.
 */
export interface SharedAdapters {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  /** Raw `Embedder` port; consumed by the workspace probe and the
   *  retrieval adapter wrapper. */
  readonly embedder: RawEmbedder;
  /** Retrieval-flavoured embedder (`EmbeddingVector`) for the
   *  retrieval use cases. Wraps `embedder`. */
  readonly retrievalEmbedder: RetrievalEmbedder;
}

/**
 * Construction options for {@link buildSharedAdapters}.
 */
export interface SharedAdaptersOptions {
  readonly logger: PinoLoggerOptions;
  /**
   * transformers.js-specific knobs. When omitted, defaults to
   * `~/.cache/recall/models/` and the curated default model
   * (`Xenova/bge-small-en-v1.5`, 384-dim).
   */
  readonly transformersEmbedder?: TransformersEmbedderOptions | undefined;
}

/**
 * Builds the shared adapters in their canonical configuration:
 *
 * - `logger`         → `PinoLogger.create` with the user-supplied
 *                      level / pretty / redact path overrides.
 * - `clock`          → `SystemClock` (Date.now-backed).
 * - `idGenerator`    → `UuidV7IdGenerator` (uuid v7, time-ordered).
 * - `embedder`       → `TransformersEmbedder` lazy-loaded from
 *                      `~/.cache/recall/models/` by default.
 * - `retrievalEmbedder`
 *                    → `RawEmbedderAdapter` wrapping the same
 *                      backend so the retrieval use cases can speak
 *                      `EmbeddingVector`.
 */
export function buildSharedAdapters(options: SharedAdaptersOptions): SharedAdapters {
  const logger = PinoLogger.create(options.logger);
  const clock = new SystemClock();
  const idGenerator = new UuidV7IdGenerator();

  const defaultCacheDir = path.join(os.homedir(), ".cache", "recall", "models");
  const opts: TransformersEmbedderOptions = options.transformersEmbedder ?? {
    cacheDir: defaultCacheDir,
  };
  const embedder: RawEmbedder = new TransformersEmbedder(opts);
  const retrievalEmbedder = new RawEmbedderAdapter(embedder);

  return {
    logger,
    clock,
    idGenerator,
    embedder,
    retrievalEmbedder,
  };
}
