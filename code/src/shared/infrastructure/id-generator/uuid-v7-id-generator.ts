import { v7 as uuidV7 } from "uuid";

import type { IdGenerator } from "../../application/ports/id-generator.port.ts";
import { Id } from "../../domain/value-objects/id.ts";

/**
 * Adapter that fulfils the {@link IdGenerator} port using the `uuid`
 * package's UUID v7 generator.
 *
 * UUID v7 was chosen project-wide (see
 * `docs/12 §1.6` and `shared/domain/value-objects/id.ts` JSDoc) because
 * it is sortable by time. The persistence layer can therefore order
 * rows by id without an extra `created_at_ms` index, which keeps the
 * SQLite schema lean.
 *
 * Implementation notes:
 * - The `uuid` package emits canonical lowercase UUID v7 strings, which
 *   is exactly what `Id.create<TBrand>()` expects (`docs/06 §9`).
 * - The generator does NOT seed itself; it relies on the host's
 *   crypto-strong PRNG. Tests requiring determinism use
 *   {@link FakeIdGenerator} instead.
 *
 * Composition root example:
 * ```typescript
 * const idGenerator: IdGenerator = new UuidV7IdGenerator();
 * const useCase = new RememberDecisionUseCase(repo, idGenerator, clock, logger);
 * ```
 */
export class UuidV7IdGenerator implements IdGenerator {
  public generate<TBrand extends string>(): Id<TBrand> {
    return Id.create<TBrand>(uuidV7());
  }

  public generateString(): string {
    return uuidV7();
  }
}
