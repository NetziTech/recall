/**
 * Driven (output) facade ports for the maintenance commands of the
 * CLI catalog (`docs/07-instalacion.md` §7):
 *
 *   - `mcp-memoria import-handoff` — bootstrap memory from a legacy
 *     `HANDOFF.md` file (`docs/07-instalacion.md` §10).
 *   - `mcp-memoria export`         — JSON dump of every persisted
 *     aggregate.
 *   - `mcp-memoria import`         — counterpart of `export`, applies
 *     a JSON dump.
 *   - `mcp-memoria wipe`           — remove `.mcp-memoria/` from disk
 *     after explicit confirmation.
 *   - `mcp-memoria stats`          — counts by kind, embedding-queue
 *     depth, last-curator info, total bytes on disk.
 *   - `mcp-memoria server`         — entry-point for the MCP server
 *     stdin/stdout transport.
 *
 * These facades sit at the boundary between the CLI module and the
 * (memory / mcp-server) modules. The composition root wires each
 * one to the right use case.
 */

export interface ImportHandoffFacadeInput {
  readonly rootPath: string;
  readonly handoffPath: string;
}

export interface ImportHandoffFacadeOutput {
  readonly importedDecisions: number;
  readonly importedLearnings: number;
  readonly skippedSections: number;
}

export interface ImportHandoffFacade {
  importHandoff(
    input: ImportHandoffFacadeInput,
  ): Promise<ImportHandoffFacadeOutput>;
}

export interface ExportFacadeInput {
  readonly rootPath: string;
  readonly outputPath: string;
}

export interface ExportFacadeOutput {
  readonly outputPath: string;
  readonly bytesWritten: number;
}

export interface ExportFacade {
  export(input: ExportFacadeInput): Promise<ExportFacadeOutput>;
}

export interface ImportFacadeInput {
  readonly rootPath: string;
  readonly inputPath: string;
}

export interface ImportFacadeOutput {
  readonly inputPath: string;
  readonly importedRows: number;
}

export interface ImportFacade {
  import(input: ImportFacadeInput): Promise<ImportFacadeOutput>;
}

export interface WipeFacadeInput {
  readonly rootPath: string;
  readonly confirmed: boolean;
}

export interface WipeFacadeOutput {
  readonly removedPath: string;
}

export interface WipeFacade {
  wipe(input: WipeFacadeInput): Promise<WipeFacadeOutput>;
}

export interface StatsFacadeInput {
  readonly rootPath: string;
}

export interface StatsFacadeOutput {
  readonly decisions: number;
  readonly learnings: number;
  readonly entities: number;
  readonly tasks: number;
  readonly turns: number;
  readonly sessions: number;
  readonly embeddingsQueued: number;
  readonly diskBytes: number;
  readonly lastCuratorRunMs: number | null;
}

export interface StatsFacade {
  stats(input: StatsFacadeInput): Promise<StatsFacadeOutput>;
}

export interface ServerFacadeInput {
  readonly rootPath: string;
}

export interface ServerFacadeOutput {
  /** Exit code returned by the MCP server transport when it shuts down. */
  readonly exitCode: number;
}

export interface ServerFacade {
  start(input: ServerFacadeInput): Promise<ServerFacadeOutput>;
}
