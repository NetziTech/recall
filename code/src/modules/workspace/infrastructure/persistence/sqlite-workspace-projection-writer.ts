import * as path from "node:path";

import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import {
  SqliteDatabase,
  type EncryptionKeyBytes,
} from "../../../../shared/infrastructure/database/sqlite-database.ts";
import type {
  UpsertWorkspaceConfigInput,
  WorkspaceProjectionWriter,
} from "../../application/ports/out/workspace-projection-writer.port.ts";
import { WorkspaceInfrastructureError } from "../errors/workspace-infrastructure-error.ts";

/**
 * SQLite-backed adapter implementing
 * {@link WorkspaceProjectionWriter}.
 *
 * Persists the workspace's identity slice into the `workspace_config`
 * table created by `migrations/006__workspace-config-table.sql`.
 *
 * Connection lifecycle:
 *   - The adapter opens its OWN short-lived SQLite handle per upsert
 *     (resolves `<root>/.recall/recall.db`, runs the upsert,
 *     closes). The workspace's `SqliteDatabaseBootstrap` already does
 *     the same dance for migrations so the pattern is familiar.
 *   - `loadVectorExtension: false` because this adapter does not
 *     touch the vector index. Skipping the load also keeps the upsert
 *     fast on machines where `sqlite-vec` is unavailable (the workspace
 *     can still register its identity even if the retrieval pipeline
 *     is degraded).
 *   - The handle is opened with the encryption key (if any) supplied
 *     by the composition root through the same `keyResolver` callback
 *     used by the bootstrap port.
 *
 * Atomicity:
 *   - The upsert is a single `INSERT ... ON CONFLICT DO UPDATE`
 *     statement. SQLite wraps single statements in an implicit
 *     transaction, so partial state cannot leak.
 *
 * Schema coupling note:
 *   - The retrieval module reads this same row via
 *     `SqliteMemoryProjectionRepository.loadWorkspaceAnchor`. The
 *     contract is the column shape pinned in
 *     `migrations/006__workspace-config-table.sql`. There is no
 *     cross-module code import between workspace and retrieval — only
 *     a SQL-level coupling — which is the same pattern already
 *     established with `embedding_queue` (memory writes / retrieval
 *     reads). Documented in the migration JSDoc and in the port
 *     interface.
 */
export interface SqliteWorkspaceProjectionWriterOptions {
  /**
   * Lazy resolver for the encryption key when the workspace is
   * encrypted. Returns `null` for non-encrypted modes (or when the
   * encrypted workspace is currently locked). Same shape as the
   * `keyResolver` of `SqliteDatabaseBootstrap` so the composition
   * root can reuse the same closure.
   */
  readonly keyResolver: (input: {
    readonly mode: "shared" | "encrypted" | "private";
    readonly databasePath: string;
  }) => Promise<EncryptionKeyBytes | null>;
  readonly logger: Logger;
}

const SQL_UPSERT_WORKSPACE_CONFIG = `
INSERT INTO workspace_config (
  workspace_id,
  display_name,
  mode,
  created_at_ms,
  updated_at_ms,
  metadata_json
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(workspace_id) DO UPDATE SET
  display_name  = excluded.display_name,
  mode          = excluded.mode,
  updated_at_ms = excluded.updated_at_ms,
  metadata_json = excluded.metadata_json
`.trim();

export class SqliteWorkspaceProjectionWriter
  implements WorkspaceProjectionWriter
{
  public constructor(
    private readonly options: SqliteWorkspaceProjectionWriterOptions,
  ) {}

  public async upsert(input: UpsertWorkspaceConfigInput): Promise<void> {
    const databasePath = SqliteWorkspaceProjectionWriter.databasePath(
      input.rootPath.toString(),
    );

    let key: EncryptionKeyBytes | null;
    try {
      key = await this.options.keyResolver({
        mode: SqliteWorkspaceProjectionWriter.modeKey(
          input.config.mode.toString(),
        ),
        databasePath,
      });
    } catch (cause: unknown) {
      throw WorkspaceInfrastructureError.configWriteFailed(
        input.rootPath.toString(),
        cause,
      );
    }

    let db: SqliteDatabase | null = null;
    try {
      db = await SqliteDatabase.open({
        path: databasePath,
        encryptionKey: key ?? undefined,
        loadVectorExtension: false,
        logger: this.options.logger,
      });
      const stmt = db.prepare(SQL_UPSERT_WORKSPACE_CONFIG);
      stmt.run(
        input.config.workspaceId.toString(),
        input.config.displayName.toString(),
        input.config.mode.toString(),
        input.config.createdAt.toEpochMs(),
        input.updatedAtMs,
        // The workspace domain does not yet model arbitrary metadata
        // for the anchor row (only display_name + mode are first-class).
        // Persist an empty JSON object so the readers receive a
        // well-formed string they can `JSON.parse(...)` without
        // special-casing NULL.
        "{}",
      );
    } catch (cause: unknown) {
      throw WorkspaceInfrastructureError.configWriteFailed(
        input.rootPath.toString(),
        cause,
      );
    } finally {
      if (db !== null) {
        try {
          db.close();
        } catch {
          // Best-effort close; the next adapter invocation will
          // re-open the handle.
        }
      }
    }
  }

  private static databasePath(rootPath: string): string {
    return path.resolve(path.join(rootPath, ".recall", "recall.db"));
  }

  private static modeKey(raw: string): "shared" | "encrypted" | "private" {
    if (raw === "shared") return "shared";
    if (raw === "encrypted") return "encrypted";
    return "private";
  }
}
