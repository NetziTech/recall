import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteSecretAuditRepository } from "../../../../src/modules/secrets/infrastructure/persistence/sqlite-secret-audit-repository.ts";
import { SecretAuditEntry } from "../../../../src/modules/secrets/domain/aggregates/secret-audit-entry.ts";
import { AuditEventId } from "../../../../src/modules/secrets/domain/value-objects/audit-event-id.ts";
import { SecretFinding } from "../../../../src/modules/secrets/domain/value-objects/secret-finding.ts";
import { SecretMatch } from "../../../../src/modules/secrets/domain/value-objects/secret-match.ts";
import { SecretKind } from "../../../../src/modules/secrets/domain/value-objects/secret-kind.ts";
import { SecretActions } from "../../../../src/modules/secrets/domain/value-objects/secret-action.ts";
import { SecretSources } from "../../../../src/modules/secrets/domain/value-objects/secret-source.ts";
import { DetectorName } from "../../../../src/modules/secrets/domain/value-objects/detector-name.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { InMemoryDatabase } from "../../../_fixtures/in-memory-database.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS secret_audit_log (
    id              TEXT    PRIMARY KEY,
    workspace_id    TEXT    NOT NULL,
    occurred_at_ms  INTEGER NOT NULL,
    action          TEXT    NOT NULL CHECK (action IN ('blocked', 'redacted', 'warned_user')),
    finding_json    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_secret_audit_log_by_workspace
    ON secret_audit_log (workspace_id, occurred_at_ms DESC);
`;

const finding = (): SecretFinding =>
  SecretFinding.create({
    kind: SecretKind.apiKey(),
    position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
    confidence: Confidence.full(),
    source: SecretSources.text("rationale"),
    detectedBy: DetectorName.from("regex.test"),
  });

let db: InMemoryDatabase;
let repo: SqliteSecretAuditRepository;

beforeEach(() => {
  db = new InMemoryDatabase();
  db.exec(SCHEMA);
  repo = new SqliteSecretAuditRepository(db);
});

afterEach(() => {
  db.close();
});

const buildEntry = (id: string, occurredAt = 1_700_000_000_000): SecretAuditEntry =>
  SecretAuditEntry.record({
    id: AuditEventId.from(id),
    workspaceId: WorkspaceId.from(WS_ID),
    finding: finding(),
    action: SecretActions.blocked(),
    occurredAt: Timestamp.fromEpochMs(occurredAt),
  });

describe("SqliteSecretAuditRepository", () => {
  it("save() then findById() round-trips", async () => {
    const id = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";
    const entry = buildEntry(id);
    await repo.save(entry);
    const found = await repo.findById(AuditEventId.from(id));
    expect(found).not.toBeNull();
    expect(found?.getId().toString()).toBe(id);
    expect(found?.getAction().kind).toBe("blocked");
  });

  it("findById returns null when missing", async () => {
    const found = await repo.findById(
      AuditEventId.from("01952f3c-2222-7000-8000-bbbbbbbbbbbb"),
    );
    expect(found).toBeNull();
  });

  it("findByWorkspace returns entries DESC by time", async () => {
    await repo.save(buildEntry("01952f3c-2222-7000-8000-aaaaaaaaaaaa", 1));
    await repo.save(buildEntry("01952f3c-2222-7000-8000-bbbbbbbbbbbb", 2));
    await repo.save(buildEntry("01952f3c-2222-7000-8000-cccccccccccc", 3));
    const entries = await repo.findByWorkspace(WorkspaceId.from(WS_ID), 10);
    expect(entries.length).toBe(3);
    expect(entries[0]?.getOccurredAt().epochMs).toBe(3);
    expect(entries[2]?.getOccurredAt().epochMs).toBe(1);
  });

  it("findByWorkspace honours limit", async () => {
    for (let i = 1; i <= 5; i += 1) {
      const idHex = i.toString(16).padStart(12, "0");
      await repo.save(
        buildEntry(`01952f3c-2222-7000-8000-${idHex}`, i),
      );
    }
    const entries = await repo.findByWorkspace(WorkspaceId.from(WS_ID), 3);
    expect(entries.length).toBe(3);
  });

  it("findByWorkspace rejects invalid limit", async () => {
    await expect(
      repo.findByWorkspace(WorkspaceId.from(WS_ID), 0),
    ).rejects.toThrow();
    await expect(
      repo.findByWorkspace(WorkspaceId.from(WS_ID), -1),
    ).rejects.toThrow();
    await expect(
      repo.findByWorkspace(WorkspaceId.from(WS_ID), 1.5),
    ).rejects.toThrow();
  });

  it("save is upsert", async () => {
    const id = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";
    await repo.save(buildEntry(id, 1));
    await repo.save(buildEntry(id, 2));
    const found = await repo.findById(AuditEventId.from(id));
    expect(found?.getOccurredAt().epochMs).toBe(2);
  });

  it("encodes filePath source variants correctly", async () => {
    const id = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";
    const entry = SecretAuditEntry.record({
      id: AuditEventId.from(id),
      workspaceId: WorkspaceId.from(WS_ID),
      finding: SecretFinding.create({
        kind: SecretKind.apiKey(),
        position: SecretMatch.create({
          start: 0,
          end: 4,
          evidence: "[R:4]",
        }),
        confidence: Confidence.full(),
        source: SecretSources.filePath("/foo/bar"),
        detectedBy: DetectorName.from("regex.test"),
      }),
      action: SecretActions.redacted(),
      occurredAt: Timestamp.fromEpochMs(1),
    });
    await repo.save(entry);
    const found = await repo.findById(AuditEventId.from(id));
    expect(found?.getFinding().source).toMatchObject({
      kind: "filePath",
      path: "/foo/bar",
    });
  });

  it("encodes logLine source variant correctly", async () => {
    const id = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";
    const entry = SecretAuditEntry.record({
      id: AuditEventId.from(id),
      workspaceId: WorkspaceId.from(WS_ID),
      finding: SecretFinding.create({
        kind: SecretKind.apiKey(),
        position: SecretMatch.create({
          start: 0,
          end: 4,
          evidence: "[R:4]",
        }),
        confidence: Confidence.full(),
        source: SecretSources.logLine(42),
        detectedBy: DetectorName.from("regex.test"),
      }),
      action: SecretActions.warnedUser(),
      occurredAt: Timestamp.fromEpochMs(1),
    });
    await repo.save(entry);
    const found = await repo.findById(AuditEventId.from(id));
    expect(found?.getFinding().source).toMatchObject({
      kind: "logLine",
      line: 42,
    });
    expect(found?.getAction().kind).toBe("warned_user");
  });

  it("maxPracticalLimit returns 10000", () => {
    expect(SqliteSecretAuditRepository.maxPracticalLimit()).toBe(10000);
  });
});
