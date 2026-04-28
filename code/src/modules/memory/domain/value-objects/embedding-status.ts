import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `EmbeddingStatusKind` values.
 *
 * Embedding generation is asynchronous (`docs/01-arquitectura.md` §2.7)
 * — `mem.remember` returns immediately and the worker fills the vector
 * later. The status communicates that bit to the recall layer:
 * - `pending`: the entry exists but no vector is available yet; recall
 *   falls back to FTS5.
 * - `ready`: the vector is in `vectors.db` and hybrid search is fully
 *   operational.
 * - `failed`: the worker tried and gave up (typically after retries).
 *   Recall continues to work via FTS5; the curator can re-enqueue the
 *   job.
 *
 * The `mem.remember` response uses the values `"queued" | "ready" |
 * "skipped"` (`docs/02-protocolo-mcp.md` §4.4). The persistence layer
 * uses the values modelled here; the application layer is responsible
 * for translating between the two representations.
 */
const EMBEDDING_STATUS_KINDS = ["pending", "ready", "failed"] as const;

export type EmbeddingStatusKind = (typeof EMBEDDING_STATUS_KINDS)[number];

/**
 * Value object representing the embedding-generation status of a
 * memory entry.
 *
 * Invariants:
 * - The wrapped `kind` is one of the three known values.
 * - Instances are immutable.
 */
export class EmbeddingStatus {
  private constructor(public readonly kind: EmbeddingStatusKind) {}

  public static pending(): EmbeddingStatus {
    return new EmbeddingStatus("pending");
  }

  public static ready(): EmbeddingStatus {
    return new EmbeddingStatus("ready");
  }

  public static failed(): EmbeddingStatus {
    return new EmbeddingStatus("failed");
  }

  public static create(raw: string): EmbeddingStatus {
    if (typeof raw !== "string") {
      throw new InvalidInputError("embedding status must be a string", {
        field: "embedding_status",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("embedding status must not be empty", {
        field: "embedding_status",
      });
    }
    if (!EmbeddingStatus.isKind(trimmed)) {
      throw new InvalidInputError(
        `embedding status must be one of "pending" | "ready" | "failed" (got: "${raw}")`,
        { field: "embedding_status" },
      );
    }
    return new EmbeddingStatus(trimmed);
  }

  public static isKind(candidate: string): candidate is EmbeddingStatusKind {
    for (const known of EMBEDDING_STATUS_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public isPending(): boolean {
    return this.kind === "pending";
  }

  public isReady(): boolean {
    return this.kind === "ready";
  }

  public isFailed(): boolean {
    return this.kind === "failed";
  }

  public toString(): EmbeddingStatusKind {
    return this.kind;
  }

  public equals(other: EmbeddingStatus): boolean {
    return this.kind === other.kind;
  }
}
