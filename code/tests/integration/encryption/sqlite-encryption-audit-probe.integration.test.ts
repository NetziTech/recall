/**
 * Integration test — `SqliteEncryptionAuditProbe` (FU-A7-2).
 *
 * Drives the adapter against a real on-disk SQLite database after
 * running every migration (so `encryption_audit_log` is present with
 * its append-only triggers + the `idx_eal_ts` index). Verifies:
 *
 *   - `lastExportAt()` returns `null` on an empty table.
 *   - `lastExportAt()` returns the latest `ExportKeyEmitted` timestamp
 *     when one or more rows are present.
 *   - `FAILURE` rows are ignored (the probe filters on
 *     `outcome = 'SUCCESS'`).
 *   - Other event-type rows (`UnlockSucceeded`, `UnlockFailed`, ...)
 *     do NOT influence the result.
 *
 * Pattern mirrors `sqlite-encryption-audit-repository.integration.test`
 * (same migrations dir, same beforeEach/afterEach, same VO fixtures).
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EventId } from "../../../src/modules/encryption/domain/value-objects/event-id.ts";
import { SqliteEncryptionAuditProbe } from "../../../src/modules/encryption/infrastructure/persistence/sqlite-encryption-audit-probe.ts";
import { SqliteEncryptionAuditRepository } from "../../../src/modules/encryption/infrastructure/persistence/sqlite-encryption-audit-repository.ts";
import { NonEmptyString } from "../../../src/shared/domain/value-objects/non-empty-string.ts";
import { Timestamp } from "../../../src/shared/domain/value-objects/timestamp.ts";
import {
  SqliteDatabase,
  type SqliteDatabaseOpenOptions,
} from "../../../src/shared/infrastructure/database/sqlite-database.ts";
import { MigrationsRunner } from "../../../src/shared/infrastructure/database/migrations-runner.ts";
import { RecordingLogger } from "../../_fixtures/silent-logger.ts";

const EVENT_ID_1 = "019e1de3-6015-76e1-a3aa-e882b6a6809f";
const EVENT_ID_2 = "019e1de3-6017-71b6-919d-321d064575da";
const EVENT_ID_3 = "019e1de3-6017-71b6-919d-35204ca8768e";
const EVENT_ID_4 = "019e1de3-6017-71b6-919d-3a3c178f1a0f";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
  "migrations",
);

let tmpDir: string;
let database: SqliteDatabase;
let repo: SqliteEncryptionAuditRepository;
let probe: SqliteEncryptionAuditProbe;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "recall-eap-"));
  const dbPath = path.join(tmpDir, "audit.db");
  const logger = new RecordingLogger();
  const openOptions: SqliteDatabaseOpenOptions = {
    path: dbPath,
    loadVectorExtension: true,
    logger,
  };
  database = await SqliteDatabase.open(openOptions);
  const runner = new MigrationsRunner(logger);
  await runner.run(database, MIGRATIONS_DIR);
  repo = new SqliteEncryptionAuditRepository(database);
  probe = new SqliteEncryptionAuditProbe(database);
});

afterEach(async () => {
  try {
    database.close();
  } catch {
    // already closed
  }
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

const actor = NonEmptyString.create("cli:export-key", "actor_hint");

describe("SqliteEncryptionAuditProbe.lastExportAt", () => {
  it("returns null when the table is empty", async () => {
    const result = await probe.lastExportAt();
    expect(result).toBeNull();
  });

  it("returns the timestamp of the only ExportKeyEmitted row", async () => {
    const exportedAt = Timestamp.fromEpochMs(1_745_000_000_000);
    await repo.append({
      eventId: EventId.from(EVENT_ID_1),
      occurredAt: exportedAt,
      eventType: "ExportKeyEmitted",
      envelopeId: null,
      masterKeyFingerprint: null,
      actorHint: actor,
      outcome: "SUCCESS",
      detailJson: null,
    });

    const result = await probe.lastExportAt();
    expect(result?.toEpochMs()).toBe(exportedAt.toEpochMs());
  });

  it("returns the MOST RECENT ExportKeyEmitted across multiple rows", async () => {
    const earlier = Timestamp.fromEpochMs(1_745_000_000_000);
    const later = Timestamp.fromEpochMs(1_745_000_100_000);
    await repo.append({
      eventId: EventId.from(EVENT_ID_1),
      occurredAt: earlier,
      eventType: "ExportKeyEmitted",
      envelopeId: null,
      masterKeyFingerprint: null,
      actorHint: actor,
      outcome: "SUCCESS",
      detailJson: null,
    });
    await repo.append({
      eventId: EventId.from(EVENT_ID_2),
      occurredAt: later,
      eventType: "ExportKeyEmitted",
      envelopeId: null,
      masterKeyFingerprint: null,
      actorHint: actor,
      outcome: "SUCCESS",
      detailJson: null,
    });

    const result = await probe.lastExportAt();
    expect(result?.toEpochMs()).toBe(later.toEpochMs());
  });

  it("ignores FAILURE-outcome ExportKeyEmitted rows (defensive filter)", async () => {
    // The current export flow only emits SUCCESS rows, but the probe
    // SHOULD filter defensively so a future regression that records
    // FAILURE outcomes does not poison the health check.
    const failureAt = Timestamp.fromEpochMs(1_745_000_500_000);
    await repo.append({
      eventId: EventId.from(EVENT_ID_3),
      occurredAt: failureAt,
      eventType: "ExportKeyEmitted",
      envelopeId: null,
      masterKeyFingerprint: null,
      actorHint: actor,
      outcome: "FAILURE",
      detailJson: { reason: "synthetic-test" },
    });

    const result = await probe.lastExportAt();
    expect(result).toBeNull();
  });

  it("ignores other event types (UnlockSucceeded / UnlockFailed / KeyEnvelopeAdded)", async () => {
    const t = Timestamp.fromEpochMs(1_745_000_700_000);
    await repo.append({
      eventId: EventId.from(EVENT_ID_1),
      occurredAt: t,
      eventType: "UnlockSucceeded",
      envelopeId: null,
      masterKeyFingerprint: null,
      actorHint: actor,
      outcome: "SUCCESS",
      detailJson: null,
    });
    await repo.append({
      eventId: EventId.from(EVENT_ID_2),
      occurredAt: t,
      eventType: "UnlockFailed",
      envelopeId: null,
      masterKeyFingerprint: null,
      actorHint: actor,
      outcome: "FAILURE",
      detailJson: { reason: "invalid-passphrase" },
    });
    await repo.append({
      eventId: EventId.from(EVENT_ID_3),
      occurredAt: t,
      eventType: "KeyEnvelopeAdded",
      envelopeId: null,
      masterKeyFingerprint: null,
      actorHint: actor,
      outcome: "SUCCESS",
      detailJson: null,
    });

    const result = await probe.lastExportAt();
    expect(result).toBeNull();
  });

  it("returns the latest SUCCESS export even when newer FAILURE rows exist", async () => {
    const successAt = Timestamp.fromEpochMs(1_745_000_900_000);
    const laterFailureAt = Timestamp.fromEpochMs(1_745_001_000_000);
    await repo.append({
      eventId: EventId.from(EVENT_ID_1),
      occurredAt: successAt,
      eventType: "ExportKeyEmitted",
      envelopeId: null,
      masterKeyFingerprint: null,
      actorHint: actor,
      outcome: "SUCCESS",
      detailJson: null,
    });
    await repo.append({
      eventId: EventId.from(EVENT_ID_4),
      occurredAt: laterFailureAt,
      eventType: "ExportKeyEmitted",
      envelopeId: null,
      masterKeyFingerprint: null,
      actorHint: actor,
      outcome: "FAILURE",
      detailJson: { reason: "synthetic-test" },
    });

    const result = await probe.lastExportAt();
    expect(result?.toEpochMs()).toBe(successAt.toEpochMs());
  });
});
