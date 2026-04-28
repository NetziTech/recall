/**
 * Public surface of `modules/memory/infrastructure/`.
 *
 * Re-exports every concrete adapter and the infrastructure error
 * type so the composition root can wire them with a single barrel
 * import.
 */

export {
  MemoryInfrastructureError,
  type MemoryInfrastructureErrorCode,
} from "./errors/memory-infrastructure-error.ts";

export * from "./embedding/index.ts";
export * from "./import-export/index.ts";
export * from "./persistence/index.ts";
