/**
 * Public surface of `composition/wiring/`. The bootstrap entrypoints
 * import from here.
 */

export type { CliWiring, CliFacadesBag, CliWiringOptions } from "./cli-wiring.ts";
export { buildCliWiring } from "./cli-wiring.ts";

export type {
  CuratorWiring,
  CuratorWiringOptions,
} from "./curator-wiring.ts";
export { buildCuratorWiring } from "./curator-wiring.ts";

export type {
  EncryptionWiring,
  EncryptionWiringOptions,
} from "./encryption-wiring.ts";
export { buildEncryptionWiring } from "./encryption-wiring.ts";

export type {
  MemoryWiring,
  MemoryWiringOptions,
} from "./memory-wiring.ts";
export { buildMemoryWiring } from "./memory-wiring.ts";

export type {
  McpServerFacadesBag,
  McpServerWiring,
  McpServerWiringOptions,
} from "./mcp-server-wiring.ts";
export { buildMcpServerWiring } from "./mcp-server-wiring.ts";

export type {
  RetrievalWiring,
  RetrievalWiringOptions,
} from "./retrieval-wiring.ts";
export { buildRetrievalWiring } from "./retrieval-wiring.ts";

export type {
  SecretsWiring,
  SecretsWiringOptions,
} from "./secrets-wiring.ts";
export { buildSecretsWiring } from "./secrets-wiring.ts";

export type {
  SharedAdapters,
  SharedAdaptersOptions,
} from "./shared-wiring.ts";
export { buildSharedAdapters } from "./shared-wiring.ts";

export type {
  EncryptionKeyResolver,
  WorkspaceWiring,
  WorkspaceWiringOptions,
} from "./workspace-wiring.ts";
export { buildWorkspaceWiring } from "./workspace-wiring.ts";
