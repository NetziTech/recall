import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of supported embedding providers.
 *
 * - `fastembed`: local ONNX runtime (default), see
 *   `docs/06-stack-tecnico.md` §8 (`fastembed-js`). Models are listed
 *   below in `FASTEMBED_MODEL_DIMENSIONS`.
 * - `voyage`: Voyage AI, opt-in cloud provider (requires API key via env
 *   var). Documented in `docs/06-stack-tecnico.md` §8 ("Alternativa
 *   cloud: Voyage AI").
 * - `openai`: OpenAI embedding API. The stack doc deliberately
 *   discourages it as the default but the protocol must accept it as a
 *   legal value (the user is free to opt in via `~/.config/...`).
 *
 * The array below is the single source of truth: the `EmbedderProvider`
 * union is derived from its element type, so adding a new provider is
 * a one-line change here and the union updates automatically. Avoids
 * the previous duplication between a hand-written union literal and a
 * separate validation array (which could drift if a new variant was
 * added to one but not the other).
 */
const EMBEDDER_PROVIDERS = ["fastembed", "voyage", "openai"] as const;

export type EmbedderProvider = (typeof EMBEDDER_PROVIDERS)[number];

/**
 * Canonical (model name -> dimension) table for fastembed. Mirrors the
 * matrix in `docs/06-stack-tecnico.md` §8 ("Modelos recomendados") and
 * the example workspace config in `docs/03-modelo-datos.md` §2 where
 * `embedder.model = "BGESmallEN15"` and `embedder.dimension = 384`.
 *
 * The table is intentionally exhaustive for the providers whose model
 * catalog is closed (`fastembed`); `voyage` and `openai` accept arbitrary
 * model strings because the upstream catalogs evolve faster than the
 * MCP can. The `dim` field is then required to disambiguate.
 */
const FASTEMBED_MODEL_DIMENSIONS: Readonly<Record<string, number>> = Object.freeze(
  {
    BGESmallEN15: 384,
    MultilingualE5Base: 768,
    BGELargeEN: 1024,
  },
);

/**
 * Value object representing the embedder configuration of a workspace.
 *
 * The embedder choice is part of the workspace's persistent config
 * (`config.json → embedder`, see `docs/03-modelo-datos.md` §2) because
 * cosine similarity scores are only comparable between vectors produced
 * by the same model. Changing models triggers a re-embed pass in the
 * curator (`docs/03-modelo-datos.md` §6 — "Migracion del modelo
 * embedder").
 *
 * Invariants:
 * - `provider` is one of `fastembed | voyage | openai`.
 * - `model` is a non-empty trimmed string.
 * - `dim` (when provided) is a positive finite integer.
 * - For `fastembed` with a model in the canonical table, `dim` (when
 *   provided) MUST match the table value. Inconsistent inputs are
 *   rejected so the runtime never opens a `vec0` table sized for the
 *   wrong vector length.
 * - For `fastembed` with a model NOT in the canonical table, `dim` is
 *   required (the runtime would otherwise have to ask the model loader
 *   for the dimension before it can size the vector index).
 * - For `voyage` and `openai`, `dim` is required: the catalogs are open
 *   and the dimension cannot be inferred from the model name.
 *
 * Equality:
 * - Two specs are equal iff `provider`, `model` and `dim` match
 *   exactly. The model name is case-sensitive to match the upstream
 *   identifiers (e.g. `"BGESmallEN15"` is not the same string as
 *   `"bgesmallen15"`).
 */
export class EmbedderSpec {
  private constructor(
    public readonly provider: EmbedderProvider,
    public readonly model: string,
    public readonly dim: number,
  ) {}

  /**
   * Builds an `EmbedderSpec` from raw fields. The factory derives the
   * canonical dimension when possible (fastembed with a known model)
   * and otherwise enforces that `dim` was supplied.
   */
  public static create(raw: {
    provider: string;
    model: string;
    dim?: number;
  }): EmbedderSpec {
    const provider = EmbedderSpec.parseProvider(raw.provider);
    const model = EmbedderSpec.parseModel(raw.model);
    const dim = EmbedderSpec.resolveDimension(provider, model, raw.dim);
    return new EmbedderSpec(provider, model, dim);
  }

  public isFastembed(): boolean {
    return this.provider === "fastembed";
  }

  public isVoyage(): boolean {
    return this.provider === "voyage";
  }

  public isOpenAi(): boolean {
    return this.provider === "openai";
  }

  /**
   * True iff two specs would produce mutually compatible vectors. Same
   * provider, same model, same dimension. Used by the curator to
   * decide whether a re-embed pass is necessary
   * (`docs/03-modelo-datos.md` §6).
   */
  public producesSameVectorsAs(other: EmbedderSpec): boolean {
    return this.equals(other);
  }

  public equals(other: EmbedderSpec): boolean {
    return (
      this.provider === other.provider &&
      this.model === other.model &&
      this.dim === other.dim
    );
  }

  // -- internals ------------------------------------------------------------

  private static parseProvider(raw: string): EmbedderProvider {
    if (typeof raw !== "string") {
      throw new InvalidInputError("embedder provider must be a string", {
        field: "embedder.provider",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("embedder provider must not be empty", {
        field: "embedder.provider",
      });
    }
    if (!EmbedderSpec.isProvider(trimmed)) {
      throw new InvalidInputError(
        `embedder provider must be one of "fastembed" | "voyage" | "openai" (got: "${raw}")`,
        { field: "embedder.provider" },
      );
    }
    return trimmed;
  }

  private static parseModel(raw: string): string {
    if (typeof raw !== "string") {
      throw new InvalidInputError("embedder model must be a string", {
        field: "embedder.model",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError(
        "embedder model must contain at least one non-whitespace character",
        { field: "embedder.model" },
      );
    }
    return trimmed;
  }

  private static resolveDimension(
    provider: EmbedderProvider,
    model: string,
    explicit: number | undefined,
  ): number {
    if (explicit !== undefined) {
      EmbedderSpec.assertValidDimension(explicit);
    }

    if (provider === "fastembed") {
      const canonical = FASTEMBED_MODEL_DIMENSIONS[model];
      if (canonical !== undefined) {
        if (explicit !== undefined && explicit !== canonical) {
          throw new InvalidInputError(
            `fastembed model "${model}" produces ${String(canonical)}-dim vectors, but dim=${String(explicit)} was provided`,
            { field: "embedder.dim" },
          );
        }
        return canonical;
      }
      // Unknown fastembed model: the user is opting into a custom
      // model and must declare its dimension explicitly.
      if (explicit === undefined) {
        throw new InvalidInputError(
          `fastembed model "${model}" is not in the canonical catalog; an explicit dim is required`,
          { field: "embedder.dim" },
        );
      }
      return explicit;
    }

    // voyage / openai: catalogs are open, dim is mandatory.
    if (explicit === undefined) {
      throw new InvalidInputError(
        `embedder provider "${provider}" requires an explicit dim`,
        { field: "embedder.dim" },
      );
    }
    return explicit;
  }

  private static assertValidDimension(dim: number): void {
    if (!Number.isFinite(dim)) {
      throw new InvalidInputError("embedder dim must be a finite number", {
        field: "embedder.dim",
      });
    }
    if (!Number.isInteger(dim)) {
      throw new InvalidInputError("embedder dim must be an integer", {
        field: "embedder.dim",
      });
    }
    if (dim <= 0) {
      throw new InvalidInputError("embedder dim must be strictly positive", {
        field: "embedder.dim",
      });
    }
  }

  private static isProvider(candidate: string): candidate is EmbedderProvider {
    for (const known of EMBEDDER_PROVIDERS) {
      if (known === candidate) return true;
    }
    return false;
  }
}
