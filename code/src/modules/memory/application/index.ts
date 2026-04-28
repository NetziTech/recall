/**
 * Public surface of `modules/memory/application/`.
 *
 * Re-exports the input ports, output ports, error types, and use-case
 * classes the memory module's application layer exposes.
 */

export {
  MemoryApplicationError,
  type MemoryApplicationErrorCode,
} from "./errors/memory-application-error.ts";

export type * from "./ports/in/index.ts";
export type * from "./ports/out/index.ts";
export * from "./use-cases/index.ts";
