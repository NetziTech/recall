import type {
  RememberInputWire,
  RememberOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driven (output) port: protocol-facing facade over the memory
 * module's `mem.remember` use case (which itself dispatches into the
 * decision / learning / entity / turn use cases by `kind`).
 *
 * The composition root binds this facade to the memory module's
 * `RememberDecisionUseCase`, `RememberLearningUseCase`, etc. The
 * adapter performs:
 * 1. Capa 1 / Capa 2 secret detection (via the secrets module).
 * 2. Translation from wire DTOs to memory aggregates.
 * 3. Persistence via the kind-specific repository.
 * 4. Optional similarity scan (the `similar_existing` field — cosine
 *    > 0.85 according to `docs/02 §4.4`).
 * 5. Embedding queueing (`embedding_status: "queued" | "ready" |
 *    "skipped"`).
 *
 * The protocol layer does not perform any of those — it is purely a
 * translator between the JSON-RPC envelope and this facade.
 */
export interface RememberFacade {
  remember(input: RememberInputWire): Promise<RememberOutputWire>;
}
