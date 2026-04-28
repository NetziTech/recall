/**
 * Re-export of the `EmbeddingStatus` value object owned by the `memory`
 * bounded context.
 *
 * The retrieval pipeline reads `embedding_status` to decide whether a
 * candidate entry has a vector available (`ready`) or whether it must
 * fall back to FTS5-only ranking (`pending` or `failed`). The status is
 * not a retrieval concept: it is a piece of state owned by the entry
 * itself (`Decision`, `Learning`, `Entity`, `Turn`), so the canonical
 * VO lives in the memory module.
 *
 * This file re-exports the type so consumers of the retrieval domain
 * (use cases, adapters, tests) can import a single, retrieval-flavoured
 * symbol without poking at the memory layer's path. The re-export does
 * NOT copy the implementation — there is exactly one `EmbeddingStatus`
 * class in the codebase, and adding a parallel one would force the
 * curator and the retrieval pipeline to translate between two
 * indistinguishable representations on every read.
 *
 * Per `docs/12-lineamientos-arquitectura.md` §1.5 Regla 3 ("Si dos o
 * mas modulos necesitan una funcionalidad, esa funcionalidad se mueve a
 * `shared/`"), an alternative would be to relocate `EmbeddingStatus` to
 * `shared/domain/`. The trade-off is documented: the type is small and
 * already stable, but it carries semantics that are tightly coupled to
 * the memory aggregates' embedding lifecycle. The re-export keeps the
 * conceptual home in `memory` while letting `retrieval` use it as a
 * first-class citizen — the spec for this task explicitly authorises
 * imports from `memory/domain/`.
 */
export {
  EmbeddingStatus,
  type EmbeddingStatusKind,
} from "../../../memory/domain/value-objects/embedding-status.ts";
