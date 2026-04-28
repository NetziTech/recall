import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type {
  SessionRollupReader,
  TurnRollupProjection,
} from "../../application/ports/out/session-rollup-reader.port.ts";
import { CuratorInfrastructureError } from "../errors/curator-infrastructure-error.ts";

/**
 * Zod schema for a single row of the rollup query. Mirrors the
 * `turns` table layout in `docs/03-modelo-datos.md` §4.2.
 */
const TurnRollupRowSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.number(),
  recorded_at_ms: z.number().int().min(0),
});

const SQL_TOP_TURNS_BY_SESSION = `
SELECT id, summary, confidence, recorded_at_ms
FROM turns
WHERE session_id = ?
ORDER BY confidence DESC, recorded_at_ms ASC
LIMIT ?
`.trim();

/**
 * Adapter that fulfils the `SessionRollupReader` driving port using
 * the SQLite `turns` table.
 *
 * The SQL is the simplest predicate that satisfies the rollup
 * contract: filter by `session_id`, sort by confidence descending
 * (highest signal first), break ties with the earliest `recorded_at_ms`
 * so the resulting summary follows the natural session timeline.
 *
 * Note on `workspace_id`: the `turns` table does not carry a
 * `workspace_id` column (per `docs/03-modelo-datos.md` §4.1 — the
 * whole DB is one workspace). The argument is accepted for symmetry
 * with the rest of the curator's adapters and to future-proof the
 * port shape against a multi-workspace schema.
 */
export class SqliteSessionRollupReader implements SessionRollupReader {
  public constructor(private readonly db: DatabaseConnection) {}

  public async listTopTurns(input: {
    workspaceId: WorkspaceId;
    sessionId: string;
    limit: number;
  }): Promise<readonly TurnRollupProjection[]> {
    void input.workspaceId;
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw CuratorInfrastructureError.rowMalformed(
        "turns",
        `limit must be a positive integer (got: ${String(input.limit)})`,
      );
    }
    const stmt = this.db.prepare(SQL_TOP_TURNS_BY_SESSION);
    const rows = stmt.all(input.sessionId, input.limit);
    const out: TurnRollupProjection[] = [];
    for (const row of rows) {
      let parsed: z.infer<typeof TurnRollupRowSchema>;
      try {
        parsed = TurnRollupRowSchema.parse(row);
      } catch (cause: unknown) {
        throw CuratorInfrastructureError.rowMalformed(
          "turns",
          cause instanceof Error ? cause.message : "schema parse failed",
          cause,
        );
      }
      out.push({
        turnId: parsed.id,
        summary: parsed.summary,
        confidence: Confidence.of(parsed.confidence),
        recordedAt: Timestamp.fromEpochMs(parsed.recorded_at_ms),
      });
    }
    return Promise.resolve(Object.freeze(out));
  }
}
