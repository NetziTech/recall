import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { SecretAuditEntry } from "../../domain/aggregates/secret-audit-entry.ts";
import type { SecretAuditRepository } from "../../domain/repositories/secret-audit-repository.ts";
import { AuditEventId } from "../../domain/value-objects/audit-event-id.ts";
import { DetectorName } from "../../domain/value-objects/detector-name.ts";
import {
  SecretActions,
  type SecretAction,
} from "../../domain/value-objects/secret-action.ts";
import { SecretFinding } from "../../domain/value-objects/secret-finding.ts";
import { SecretKind } from "../../domain/value-objects/secret-kind.ts";
import { SecretMatch } from "../../domain/value-objects/secret-match.ts";
import {
  SecretSources,
  type SecretSource,
} from "../../domain/value-objects/secret-source.ts";

/**
 * Zod schema for the JSON encoding of `SecretAction`. Mirrors the
 * domain VO's discriminated union.
 */
const ActionSchema = z.object({
  kind: z.enum(["blocked", "redacted", "warned_user"]),
});

/**
 * Zod schema for the JSON encoding of `SecretSource`. Each variant
 * carries only its own fields so the on-disk representation stays
 * close to the in-memory shape.
 */
const SourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), field: z.string().min(1) }),
  z.object({ kind: z.literal("filePath"), path: z.string().min(1) }),
  z.object({ kind: z.literal("logLine"), line: z.number().int().min(1) }),
]);

/**
 * Zod schema for the JSON-encoded finding stored alongside the audit
 * row. The schema keeps the persistence shape decoupled from the
 * VO factories: changes to either side are absorbed by this single
 * schema definition.
 */
const FindingPayloadSchema = z.object({
  kind: z.string().min(1),
  position: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    evidence: z.string().min(1),
  }),
  confidence: z.number().min(0).max(1),
  source: SourceSchema,
  detected_by: z.string().min(1),
});

/**
 * Zod schema for the persisted row of `secret_audit_log`. Validated
 * before any VO factory runs so an attacker who tampered with the
 * SQLite file cannot bypass the domain invariants.
 */
const AuditRowSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  occurred_at_ms: z.number().int().min(0),
  action: z.string().min(1),
  finding_json: z.string().min(1),
});

/**
 * SQL DDL for the audit-log table. The migration ships this DDL
 * (see `code/migrations/001__secret-audit-log.sql`); the constant
 * is kept here in JSDoc form for code review.
 *
 * ```sql
 * CREATE TABLE IF NOT EXISTS secret_audit_log (
 *     id              TEXT    PRIMARY KEY,
 *     workspace_id    TEXT    NOT NULL,
 *     occurred_at_ms  INTEGER NOT NULL,
 *     action          TEXT    NOT NULL,
 *     finding_json    TEXT    NOT NULL
 * );
 * CREATE INDEX IF NOT EXISTS idx_secret_audit_log_by_workspace
 *     ON secret_audit_log (workspace_id, occurred_at_ms DESC);
 * ```
 */

const SQL_INSERT = `
INSERT INTO secret_audit_log (id, workspace_id, occurred_at_ms, action, finding_json)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  workspace_id    = excluded.workspace_id,
  occurred_at_ms  = excluded.occurred_at_ms,
  action          = excluded.action,
  finding_json    = excluded.finding_json
`.trim();

const SQL_SELECT_BY_ID = `
SELECT id, workspace_id, occurred_at_ms, action, finding_json
FROM secret_audit_log
WHERE id = ?
LIMIT 1
`.trim();

const SQL_SELECT_BY_WORKSPACE = `
SELECT id, workspace_id, occurred_at_ms, action, finding_json
FROM secret_audit_log
WHERE workspace_id = ?
ORDER BY occurred_at_ms DESC, id DESC
LIMIT ?
`.trim();

/**
 * Adapter that fulfils the `SecretAuditRepository` domain port using
 * the SQLite `secret_audit_log` table.
 *
 * Persistence shape:
 * - One row per `SecretAuditEntry`. The `finding` VO is JSON-encoded
 *   into `finding_json` because the domain shape is rich (kind,
 *   position, confidence, source, detected_by) and modelling each
 *   field as a column would multiply the schema for no operational
 *   benefit (we never query on those fields independently — the
 *   only reads are by workspace + time).
 * - The `action` column carries the kind of the action only;
 *   variants with payload (none today) would extend the JSON
 *   encoding instead.
 *
 * Invariants:
 * - `save(...)` is upsert by id (the aggregate factory mints a fresh
 *   UUID v7 per call so collisions are practically impossible; the
 *   upsert is defensive).
 * - The audit trail is append-only: there is no `delete` method. The
 *   DDL also lacks a delete trigger; persistence-side garbage
 *   collection (rolling 90-day retention per
 *   `docs/11-seguridad-modos.md` §6) is run by a separate
 *   scheduled job, not by this adapter.
 */
export class SqliteSecretAuditRepository implements SecretAuditRepository {
  public constructor(private readonly db: DatabaseConnection) {}

  public async findById(id: AuditEventId): Promise<SecretAuditEntry | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_ID);
    const row = stmt.get(id.toString());
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async save(entry: SecretAuditEntry): Promise<void> {
    const findingJson = this.encodeFinding(entry.getFinding());
    const stmt = this.db.prepare(SQL_INSERT);
    stmt.run(
      entry.getId().toString(),
      entry.getWorkspaceId().toString(),
      entry.getOccurredAt().epochMs,
      entry.getAction().kind,
      findingJson,
    );
    return Promise.resolve();
  }

  public async findByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly SecretAuditEntry[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(
        `findByWorkspace.limit must be a positive integer (got: ${String(limit)})`,
      );
    }
    const stmt = this.db.prepare(SQL_SELECT_BY_WORKSPACE);
    const rows = stmt.all(workspaceId.toString(), limit);
    const out: SecretAuditEntry[] = [];
    for (const row of rows) {
      out.push(this.parseRow(row));
    }
    return Promise.resolve(Object.freeze(out));
  }

  // -- internals --------------------------------------------------------

  private parseRow(raw: unknown): SecretAuditEntry {
    const parsed = AuditRowSchema.parse(raw);
    const findingPayload = FindingPayloadSchema.parse(
      JSON.parse(parsed.finding_json),
    );
    const finding = SecretFinding.create({
      kind: SecretKind.create(findingPayload.kind),
      position: SecretMatch.create({
        start: findingPayload.position.start,
        end: findingPayload.position.end,
        evidence: findingPayload.position.evidence,
      }),
      confidence: Confidence.of(findingPayload.confidence),
      source: this.parseSource(findingPayload.source),
      detectedBy: DetectorName.from(findingPayload.detected_by),
    });
    return SecretAuditEntry.rehydrate({
      id: AuditEventId.from(parsed.id),
      workspaceId: WorkspaceId.from(parsed.workspace_id),
      finding,
      action: this.parseAction(parsed.action),
      occurredAt: Timestamp.fromEpochMs(parsed.occurred_at_ms),
    });
  }

  private parseAction(raw: string): SecretAction {
    const parsed = ActionSchema.parse({ kind: raw });
    return SecretActions.fromKind(parsed.kind);
  }

  private parseSource(raw: z.infer<typeof SourceSchema>): SecretSource {
    switch (raw.kind) {
      case "text":
        return SecretSources.text(raw.field);
      case "filePath":
        return SecretSources.filePath(raw.path);
      case "logLine":
        return SecretSources.logLine(raw.line);
      default: {
        const exhaustive: never = raw;
        throw new Error(
          `unreachable: unknown source kind ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }

  private encodeFinding(finding: SecretFinding): string {
    const sourcePayload = this.encodeSource(finding.source);
    const payload = {
      kind: finding.kind.toString(),
      position: {
        start: finding.position.start,
        end: finding.position.end,
        evidence: finding.position.evidence,
      },
      confidence: finding.confidence.toNumber(),
      source: sourcePayload,
      detected_by: finding.detectedBy.toString(),
    } satisfies z.infer<typeof FindingPayloadSchema>;
    return JSON.stringify(payload);
  }

  private encodeSource(source: SecretSource): z.infer<typeof SourceSchema> {
    switch (source.kind) {
      case "text":
        return { kind: "text", field: source.field };
      case "filePath":
        return { kind: "filePath", path: source.path };
      case "logLine":
        return { kind: "logLine", line: source.line };
      default: {
        const exhaustive: never = source;
        throw new Error(
          `unreachable: unknown source kind ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }

  /**
   * Limit-validation helper exposed for documentation. Lives as a
   * static method so the repository constructor can reuse it
   * without importing a free function.
   */
  public static maxPracticalLimit(): number {
    // The audit log has a rolling 90-day retention policy
    // (`docs/11-seguridad-modos.md` §6 §5 "Capa 5"); a single
    // workspace generating 1000 findings/day still leaves 90,000
    // rows. We cap callers at 10,000 to refuse degenerate "give me
    // everything" queries.
    return 10000;
  }
}
