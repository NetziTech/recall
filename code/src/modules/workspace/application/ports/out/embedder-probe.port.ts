/**
 * Driven (output) port the workspace's `HealthCheckUseCase` uses to
 * assert that the configured embedder is actually loadable.
 *
 * The probe is intentionally trivial: ask the adapter for its
 * dimension. A working `Embedder` adapter has the model loaded
 * lazily, so reading `dimension()` typically forces the load and
 * surfaces any I/O / model-cache failure (`docs/06-stack-tecnico.md`
 * §6 — "Modelos recomendados", "Cache local: ~/.cache/mcp-memoria/models/").
 *
 * Why this is its own port rather than reusing the shared
 * `Embedder` port:
 *   - The shared `Embedder` port is broad (embed, embedBatch,
 *     dimension). The health check only needs the bare-minimum
 *     "loadable?" answer. Shrinking the surface follows ISP and
 *     lets a test fixture return `{ ok: false, message: ... }`
 *     without implementing the embedding methods.
 */
export interface EmbedderProbeOutcome {
  readonly ok: boolean;
  readonly dimension: number | null;
  readonly message: string;
}

export interface EmbedderProbe {
  probe(): Promise<EmbedderProbeOutcome>;
}
