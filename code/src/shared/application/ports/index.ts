/**
 * Public surface of `shared/application/ports/`.
 *
 * Re-exports every transversal driven (output) port that lives in this
 * directory so that downstream modules and the composition root can
 * import them through a single, stable barrel:
 *
 * ```typescript
 * import type {
 *   Clock,
 *   DatabaseConnection,
 *   Embedder,
 *   IdGenerator,
 *   Logger,
 *   PreparedStatement,
 *   RawEmbedding,
 *   RunResult,
 *   LogPayload,
 * } from "../../../../shared/application/ports/index.ts";
 * ```
 *
 * Why re-export?
 * - Single entry point keeps consumer imports terse and stable across
 *   port renames (the file path stays inside `shared/application/`).
 * - Aligns with `docs/12-lineamientos-arquitectura.md` §2: the
 *   reference structure of `shared/application/ports/` lists the
 *   transversal ports as siblings — the barrel makes that intent
 *   explicit and lets the ESLint `consistent-type-imports` rule pick
 *   them up uniformly.
 *
 * What is intentionally NOT here:
 * - **`kdf` port**. The KDF contract consumes value objects that live
 *   in `modules/encryption/domain/` (`Passphrase`, `KdfParams`,
 *   `DerivedKey`). A shared port cannot import them without inverting
 *   the dependency graph, so the KDF port belongs to
 *   `modules/encryption/application/ports/` (Fase 3 deliverable; see
 *   the validator report for §2.3 and the orchestrator's task split).
 *   `modules/encryption/domain/services/key-derivation.ts` already
 *   exposes a type-only domain version that the encryption use-case
 *   layer will lift into its own application port.
 * - **`transaction-manager` port**. The `transaction(fn)` method on
 *   `DatabaseConnection` already covers every use case Fase 1 has
 *   (single-level commit/rollback). Splitting it into a separate
 *   port would violate ISP-by-symmetry (we would have one port that
 *   only forwards to the other) without adding any contract.
 *   Re-evaluate when nested savepoints, retry-on-conflict, or
 *   distributed transactions land on the roadmap.
 */

export type {
  DatabaseConnection,
  PreparedStatement,
  RunResult,
} from "./database-connection.port.ts";

export type { Logger, LogPayload } from "./logger.port.ts";

export type { Clock } from "./clock.port.ts";

export type { IdGenerator } from "./id-generator.port.ts";

export type { Embedder, RawEmbedding } from "./embedder.port.ts";

export type { EventPublisher } from "./event-publisher.port.ts";
