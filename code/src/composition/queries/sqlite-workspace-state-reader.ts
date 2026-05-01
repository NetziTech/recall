/**
 * Composition-level read adapter that satisfies
 * {@link WorkspaceStateReader} by joining live state from across the
 * memory + retrieval + curator + workspace tables.
 *
 * Why composition: the SQL crosses bounded contexts (decisions,
 * learnings, entities, tasks, turns, sessions, curator_runs,
 * embedding_queue, workspace_config). Honouring those boundaries via
 * domain repositories would require an outbound port per module, all
 * to feed a single read-model owned by no aggregate. The composition
 * layer already exists as the only place wiring crosses modules
 * (ADR-001 §4); placing this read here keeps cross-module SQL where
 * it already belongs and avoids a new ADR for a single diagnostic
 * surface.
 *
 * SQL contract:
 *   - The MEMORY tables (`decisions`, `learnings`, `entities`,
 *     `tasks`, `turns`) DO NOT carry `workspace_id`. The
 *     "one database file == one workspace" invariant is enforced at
 *     the bootstrap layer (`recall init` opens exactly one DB per
 *     workspace), so an unfiltered `COUNT(*)` is correct.
 *   - `workspace_config` is keyed by `workspace_id`; the reader
 *     filters by the injected id.
 *   - `embedding_queue` and `curator_runs` carry `workspace_id` —
 *     filtered to be future-proof against any test that opens
 *     several workspaces against the same database file.
 *   - `sessions` does not carry `workspace_id` (same invariant as
 *     memory tables); the reader returns the most recent row whose
 *     `ended_at_ms IS NULL`.
 *
 * Failure model: this adapter swallows per-query failures (returning
 * the documented safe default in {@link WorkspaceStateSnapshot})
 * because `mem.health` is the diagnostic of last resort — it must
 * not throw on a corrupt or partial database. The bootstrap-level
 * probe already surfaces "the database itself is unusable" via the
 * existing `HealthCheckUseCase`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { DatabaseConnection } from "../../shared/application/ports/database-connection.port.ts";
import type { Logger } from "../../shared/application/ports/logger.port.ts";
import type {
  WorkspaceStateReader,
  WorkspaceStateSnapshot,
} from "../../modules/mcp-server/application/ports/out/workspace-state-reader.port.ts";

interface CountRow {
  readonly n: number;
}

interface ModeRow {
  readonly mode: string;
}

interface ActiveSessionRow {
  readonly id: string;
  readonly started_at_ms: number;
}

interface CuratorRunRow {
  readonly started_at_ms: number;
}

const TRACKED_KINDS = ["decision", "learning", "entity", "task", "turn"] as const;
type TrackedKind = (typeof TRACKED_KINDS)[number];

const KIND_TO_TABLE: Readonly<Record<TrackedKind, string>> = {
  decision: "decisions",
  learning: "learnings",
  entity: "entities",
  task: "tasks",
  turn: "turns",
};

/**
 * Persisted modes in `workspace_config.mode` are constrained to the
 * three values below by the workspace aggregate's invariants. The
 * reader narrows to that union after the SQL read so the caller's
 * type stays tight.
 */
function narrowMode(raw: string): WorkspaceStateSnapshot["mode"] {
  if (raw === "shared" || raw === "encrypted" || raw === "private") return raw;
  return "shared";
}

/**
 * Computes the encryption_status without runtime knowledge. For
 * non-encrypted modes the answer is unambiguous (`"n/a"`); for
 * encrypted mode we conservatively report `"locked"` because this
 * adapter does not have access to the bootstrap closure that holds
 * the in-memory unlocked key. Documented limitation; tracked in the
 * port JSDoc.
 */
function deriveEncryptionStatus(
  mode: WorkspaceStateSnapshot["mode"],
): WorkspaceStateSnapshot["encryptionStatus"] {
  if (mode === "encrypted") return "locked";
  return "n/a";
}

/**
 * Sums the on-disk size of `recall.db` plus its WAL/SHM siblings, if
 * present. `vectors_db` is preserved on the wire but reported as `0`
 * because the vec0 virtual table is co-located inside `recall.db`
 * (see {@link WorkspaceStateSnapshot.sizeBytes}).
 */
function readDatabaseSizes(workspaceRoot: string): {
  readonly recallDb: number;
  readonly vectorsDb: number;
} {
  const dbPath = path.join(workspaceRoot, ".recall", "recall.db");
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  let total = 0;
  for (const candidate of [dbPath, walPath, shmPath]) {
    try {
      total += fs.statSync(candidate).size;
    } catch {
      // The companion WAL/SHM files only exist while the database is
      // open in WAL mode and has pending pages. Missing siblings are
      // expected, not an error.
    }
  }
  return { recallDb: total, vectorsDb: 0 };
}

export class SqliteWorkspaceStateReader implements WorkspaceStateReader {
  public constructor(
    private readonly database: DatabaseConnection,
    private readonly logger: Logger,
  ) {}

  public readState(input: {
    readonly workspaceId: { toString(): string };
    readonly workspaceRoot: string;
  }): Promise<WorkspaceStateSnapshot> {
    const workspaceIdStr = input.workspaceId.toString();

    const mode = this.readMode(workspaceIdStr);
    const encryptionStatus = deriveEncryptionStatus(mode);
    const entriesByKind = this.readEntriesByKind();
    const totalEntries = TRACKED_KINDS.reduce(
      (acc, kind) => acc + (entriesByKind[kind] ?? 0),
      0,
    );
    const sizeBytes = readDatabaseSizes(input.workspaceRoot);
    const activeSession = this.readActiveSession();
    const lastCuratorRunAtMs = this.readLastCuratorRunAtMs(workspaceIdStr);
    const embeddingQueuePending = this.readEmbeddingQueuePending(workspaceIdStr);

    return Promise.resolve({
      mode,
      encryptionStatus,
      entriesByKind,
      totalEntries,
      sizeBytes,
      activeSession,
      lastCuratorRunAtMs,
      embeddingQueuePending,
    });
  }

  // ── private SQL helpers ────────────────────────────────────────────

  private readMode(workspaceId: string): WorkspaceStateSnapshot["mode"] {
    try {
      const stmt = this.database.prepare(
        "SELECT mode FROM workspace_config WHERE workspace_id = ? LIMIT 1",
      );
      const row = stmt.get(workspaceId) as ModeRow | undefined;
      if (row === undefined) return "shared";
      return narrowMode(row.mode);
    } catch (cause: unknown) {
      this.logger.warn(
        {
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "workspace-state-reader: failed to read workspace mode",
      );
      return "shared";
    }
  }

  private readEntriesByKind(): Record<string, number> {
    const counts: Record<string, number> = {
      decision: 0,
      learning: 0,
      entity: 0,
      task: 0,
      turn: 0,
    };
    for (const kind of TRACKED_KINDS) {
      const table = KIND_TO_TABLE[kind];
      try {
        const stmt = this.database.prepare(
          `SELECT COUNT(*) AS n FROM ${table}`,
        );
        const row = stmt.get() as CountRow | undefined;
        counts[kind] = row?.n ?? 0;
      } catch (cause: unknown) {
        this.logger.warn(
          {
            kind,
            table,
            err: cause instanceof Error ? cause.message : String(cause),
          },
          "workspace-state-reader: failed to count rows",
        );
      }
    }
    return counts;
  }

  private readActiveSession(): WorkspaceStateSnapshot["activeSession"] {
    try {
      const stmt = this.database.prepare(
        "SELECT id, started_at_ms FROM sessions WHERE ended_at_ms IS NULL ORDER BY started_at_ms DESC LIMIT 1",
      );
      const row = stmt.get() as ActiveSessionRow | undefined;
      if (row === undefined) return null;
      return { id: row.id, startedAtMs: row.started_at_ms };
    } catch (cause: unknown) {
      this.logger.warn(
        {
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "workspace-state-reader: failed to read active session",
      );
      return null;
    }
  }

  private readLastCuratorRunAtMs(workspaceId: string): number | null {
    try {
      const stmt = this.database.prepare(
        "SELECT started_at_ms FROM curator_runs WHERE workspace_id = ? ORDER BY started_at_ms DESC LIMIT 1",
      );
      const row = stmt.get(workspaceId) as CuratorRunRow | undefined;
      if (row === undefined) return null;
      return row.started_at_ms;
    } catch (cause: unknown) {
      this.logger.warn(
        {
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "workspace-state-reader: failed to read last curator run",
      );
      return null;
    }
  }

  private readEmbeddingQueuePending(workspaceId: string): number {
    try {
      const stmt = this.database.prepare(
        "SELECT COUNT(*) AS n FROM embedding_queue WHERE workspace_id = ?",
      );
      const row = stmt.get(workspaceId) as CountRow | undefined;
      return row?.n ?? 0;
    } catch (cause: unknown) {
      this.logger.warn(
        {
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "workspace-state-reader: failed to read embedding queue depth",
      );
      return 0;
    }
  }
}
