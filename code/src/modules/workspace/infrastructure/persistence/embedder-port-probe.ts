import type { Embedder } from "../../../../shared/application/ports/embedder.port.ts";
import type {
  EmbedderProbe,
  EmbedderProbeOutcome,
} from "../../application/ports/out/embedder-probe.port.ts";

/**
 * Adapter that turns a generic `Embedder` port into the narrower
 * `EmbedderProbe` consumed by the workspace's `HealthCheckUseCase`.
 *
 * Why a wrapper instead of injecting `Embedder` directly:
 *   - The use case only needs "is the embedder loadable?". Asking
 *     for the full `Embedder` interface would tempt the use case
 *     into using `embed`/`embedBatch` (a tighter port surface
 *     follows ISP).
 *   - Wrapping the call lets us catch `EmbedderError` from the
 *     adapter and report it as a structured outcome instead of an
 *     exception that aborts the rest of the health check.
 *
 * The probe is intentionally cheap: it reads the dimension. For
 * lazy adapters (the default `TransformersEmbedder` implementation),
 * reading the dimension is synchronous and does NOT force the model
 * to load; the first `embed()` call surfaces I/O / model-cache
 * failures.
 */
export class EmbedderPortProbe implements EmbedderProbe {
  public constructor(private readonly embedder: Embedder) {}

  public probe(): Promise<EmbedderProbeOutcome> {
    try {
      const dimension = this.embedder.dimension();
      if (dimension <= 0) {
        return Promise.resolve({
          ok: false,
          dimension: null,
          message: `embedder reported a non-positive dimension (${String(dimension)})`,
        });
      }
      return Promise.resolve({
        ok: true,
        dimension,
        message: `embedder loadable (dimension=${String(dimension)})`,
      });
    } catch (err: unknown) {
      return Promise.resolve({
        ok: false,
        dimension: null,
        message: `embedder probe failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}
