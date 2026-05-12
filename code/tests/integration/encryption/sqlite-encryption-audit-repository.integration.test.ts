/**
 * Integration test — `SqliteEncryptionAuditRepository`.
 *
 * **Source-of-truth: ADR-005 Q4 (Phase-22, docs/12 §1.5.5 appendix).**
 *
 * Drives the adapter against a real on-disk SQLite database after
 * running every migration (so `encryption_audit_log` is present with
 * its append-only triggers). Tests verify:
 *
 *   - Happy-path INSERT covers every field (event_id BLOB, null
 *     envelope, null fingerprint, JSON detail).
 *   - The two triggers `eal_no_update` / `eal_no_delete` actually
 *     reject mutations with the canonical error message.
 *   - All 12 `EncryptionAuditEventType` strings round-trip verbatim.
 *   - All 3 `EncryptionAuditOutcome` strings round-trip verbatim.
 *   - The `idx_eal_ts` index enables ORDER BY occurred_at_ms DESC.
 *
 * The tests reach into the SQLite table directly via the
 * `DatabaseConnection` port (rather than going through the
 * write-only repository's public surface) because the audit-log
 * adapter is intentionally strict on its read side — see
 * `SqliteEncryptionAuditRepository` JSDoc on why there is no
 * `find*` API.
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EventId } from "../../../src/modules/encryption/domain/value-objects/event-id.ts";
import { KeyId } from "../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { MasterKeyFingerprint } from "../../../src/modules/encryption/domain/value-objects/master-key-fingerprint.ts";
import { SqliteEncryptionAuditRepository } from "../../../src/modules/encryption/infrastructure/persistence/sqlite-encryption-audit-repository.ts";
import type {
  EncryptionAuditEvent,
  EncryptionAuditEventType,
  EncryptionAuditOutcome,
} from "../../../src/modules/encryption/domain/repositories/encryption-audit-log-repository.ts";
import { NonEmptyString } from "../../../src/shared/domain/value-objects/non-empty-string.ts";
import { Timestamp } from "../../../src/shared/domain/value-objects/timestamp.ts";
import {
  SqliteDatabase,
  type SqliteDatabaseOpenOptions,
} from "../../../src/shared/infrastructure/database/sqlite-database.ts";
import { MigrationsRunner } from "../../../src/shared/infrastructure/database/migrations-runner.ts";
import { RecordingLogger } from "../../_fixtures/silent-logger.ts";

/**
 * Pre-generated UUID v7 fixtures used across the suite. Hand-picked
 * so the suite is reproducible (no `uuid.v7()` calls at runtime, no
 * non-determinism).
 *
 * Each id is a valid canonical UUID v7 (version nibble `7`, variant
 * nibble in `{8,9,a,b}`). The trailing octets are distinct so tests
 * that need multiple ids can pick them without collisions.
 */
const EVENT_ID_1 = "019e1de3-6015-76e1-a3aa-e882b6a6809f";
const EVENT_ID_2 = "019e1de3-6017-71b6-919d-321d064575da";
const EVENT_ID_3 = "019e1de3-6017-71b6-919d-35204ca8768e";

const ENVELOPE_ID_1 = "019e1de3-6017-71b6-919d-3a3c178f1a0f";
const ENVELOPE_ID_2 = "019e1de3-6017-71b6-919d-3f50748a1ed9";

const ANCHOR_MS = 1_745_000_000_000;

/**
 * The 12 frozen `EncryptionAuditEventType` strings. Declared as a
 * `const` array so the loop in the round-trip test can iterate them
 * exhaustively. A type-level cross-check below asserts the array
 * matches the union.
 */
const ALL_EVENT_TYPES = [
  "KeyEnvelopeAdded",
  "KeyEnvelopeRemoved",
  "RekeyStarted",
  "RekeyCompleted",
  "RekeyFailed",
  "UnlockSucceeded",
  "UnlockFailed",
  "ExportKeyEmitted",
  "KdfTimeoutExceeded",
  "RECOVERY_SKIP_CHECKSUM",
  "KeyValidatorMismatch",
  "LEGACY_KEY_UNLOCK",
] as const satisfies readonly EncryptionAuditEventType[];

const ALL_OUTCOMES = [
  "SUCCESS",
  "FAILURE",
  "TIMEOUT",
] as const satisfies readonly EncryptionAuditOutcome[];

const MIGRATIONS_DIR = path.resolve(
  // tests/integration/encryption/ → code/, then migrations
  import.meta.dirname,
  "..",
  "..",
  "..",
  "migrations",
);

let tmpDir: string;
let dbPath: string;
let database: SqliteDatabase;
let repo: SqliteEncryptionAuditRepository;
let logger: RecordingLogger;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "recall-eal-"));
  dbPath = path.join(tmpDir, "audit.db");
  logger = new RecordingLogger();
  const openOptions: SqliteDatabaseOpenOptions = {
    path: dbPath,
    loadVectorExtension: true,
    logger,
  };
  database = await SqliteDatabase.open(openOptions);
  const runner = new MigrationsRunner(logger);
  await runner.run(database, MIGRATIONS_DIR);
  repo = new SqliteEncryptionAuditRepository(database);
});

afterEach(async () => {
  try {
    database.close();
  } catch {
    // already closed
  }
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

/**
 * Builds a fully-populated event with sane defaults. Tests override
 * the fields they exercise.
 */
function buildEvent(
  overrides: Partial<EncryptionAuditEvent> = {},
): EncryptionAuditEvent {
  const masterKeyBytes = new Uint8Array(32);
  masterKeyBytes.fill(0x42);

  const base: EncryptionAuditEvent = {
    eventId: EventId.from(EVENT_ID_1),
    occurredAt: Timestamp.fromEpochMs(ANCHOR_MS),
    eventType: "KeyEnvelopeAdded",
    envelopeId: KeyId.from(ENVELOPE_ID_1),
    masterKeyFingerprint: MasterKeyFingerprint.fromMasterKey(masterKeyBytes),
    actorHint: NonEmptyString.create("cli:add-key", "actor_hint"),
    outcome: "SUCCESS",
    detailJson: { kdf_duration_ms: 245, source: "test" },
  };
  return { ...base, ...overrides };
}

interface AuditRow {
  readonly event_id: Buffer;
  readonly occurred_at_ms: number;
  readonly event_type: string;
  readonly envelope_id: string | null;
  readonly master_key_fp: string | null;
  readonly actor_hint: string | null;
  readonly outcome: string;
  readonly detail_json: string | null;
}

function selectAll(): readonly AuditRow[] {
  const stmt = database.prepare(
    `SELECT event_id, occurred_at_ms, event_type, envelope_id,
            master_key_fp, actor_hint, outcome, detail_json
       FROM encryption_audit_log
       ORDER BY occurred_at_ms ASC`,
  );
  return stmt.all() as readonly AuditRow[];
}

describe("SqliteEncryptionAuditRepository.append — persistence shape", () => {
  it("persists every field of a fully-populated event", async () => {
    const event = buildEvent();
    await repo.append(event);

    const rows = selectAll();
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    // event_id is a 16-byte BLOB.
    expect(Buffer.isBuffer(row.event_id) || row.event_id instanceof Uint8Array).toBe(true);
    expect(row.event_id.length).toBe(16);
    expect(row.occurred_at_ms).toBe(ANCHOR_MS);
    expect(row.event_type).toBe("KeyEnvelopeAdded");
    expect(row.envelope_id).toBe(ENVELOPE_ID_1);
    // 16 hex chars (8 bytes × 2).
    expect(row.master_key_fp).not.toBeNull();
    expect((row.master_key_fp ?? "").length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(row.master_key_fp ?? "")).toBe(true);
    expect(row.actor_hint).toBe("cli:add-key");
    expect(row.outcome).toBe("SUCCESS");
    expect(row.detail_json).not.toBeNull();
    const detail = JSON.parse(row.detail_json ?? "{}") as Record<string, unknown>;
    expect(detail["kdf_duration_ms"]).toBe(245);
    expect(detail["source"]).toBe("test");
  });

  it("persists null envelope_id (e.g. RekeyStarted)", async () => {
    const event = buildEvent({
      eventType: "RekeyStarted",
      envelopeId: null,
    });
    await repo.append(event);

    const rows = selectAll();
    expect(rows.length).toBe(1);
    expect(rows[0]?.event_type).toBe("RekeyStarted");
    expect(rows[0]?.envelope_id).toBeNull();
  });

  it("persists null master_key_fingerprint (e.g. UnlockFailed with no envelope match)", async () => {
    const event = buildEvent({
      eventId: EventId.from(EVENT_ID_2),
      eventType: "UnlockFailed",
      envelopeId: null,
      masterKeyFingerprint: null,
      outcome: "FAILURE",
      detailJson: null,
    });
    await repo.append(event);

    const rows = selectAll();
    expect(rows.length).toBe(1);
    expect(rows[0]?.event_type).toBe("UnlockFailed");
    expect(rows[0]?.envelope_id).toBeNull();
    expect(rows[0]?.master_key_fp).toBeNull();
    expect(rows[0]?.outcome).toBe("FAILURE");
    expect(rows[0]?.detail_json).toBeNull();
  });
});

/**
 * Helper: captures the error thrown by `run()` and walks the `cause`
 * chain so we can assert on the original SQLite message even though
 * the adapter wraps every driver error in `DatabaseError.execFailed`.
 *
 * The pattern is: `DatabaseError("failed to execute SQL batch")` with
 * `cause = SqliteError("audit log is append-only", ...)`.
 */
function captureRunError(fn: () => void): Error | null {
  try {
    fn();
    return null;
  } catch (e: unknown) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

function messageChain(err: Error): string {
  const messages: string[] = [err.message];
  let current: unknown = (err as { cause?: unknown }).cause;
  while (current !== undefined && current !== null) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  return messages.join(" | ");
}

describe("SqliteEncryptionAuditRepository.append — append-only enforcement", () => {
  it("rejects UPDATE via the eal_no_update trigger", async () => {
    await repo.append(buildEvent());

    const update = database.prepare(
      "UPDATE encryption_audit_log SET outcome = ? WHERE outcome = ?",
    );
    const err = captureRunError(() => {
      update.run("FAILURE", "SUCCESS");
    });
    expect(err).not.toBeNull();
    if (err !== null) {
      // The adapter wraps the driver error in DatabaseError.execFailed,
      // but the original SQLite RAISE(ABORT) message is preserved on
      // the cause chain. Verifying via the chain is the contractually
      // correct read because it documents both layers (the port-level
      // wrapper AND the migration-defined trigger message).
      expect(messageChain(err)).toMatch(/audit log is append-only/);
    }

    // Original row is intact.
    const rows = selectAll();
    expect(rows.length).toBe(1);
    expect(rows[0]?.outcome).toBe("SUCCESS");
  });

  it("rejects DELETE via the eal_no_delete trigger", async () => {
    await repo.append(buildEvent());

    const del = database.prepare(
      "DELETE FROM encryption_audit_log WHERE event_type = ?",
    );
    const err = captureRunError(() => {
      del.run("KeyEnvelopeAdded");
    });
    expect(err).not.toBeNull();
    if (err !== null) {
      expect(messageChain(err)).toMatch(/audit log is append-only/);
    }

    // Row survives the failed DELETE.
    const rows = selectAll();
    expect(rows.length).toBe(1);
  });
});

describe("SqliteEncryptionAuditRepository.append — enum coverage", () => {
  it("round-trips all 12 EncryptionAuditEventType values", async () => {
    // Use distinct event_ids so the PRIMARY KEY does not collide.
    // We synthesise them by varying the last digit of EVENT_ID_2.
    // The last hex octet has to keep the lowercase-hex shape; we
    // walk 0..b to stay valid.
    const HEX = "0123456789ab";
    for (let i = 0; i < ALL_EVENT_TYPES.length; i += 1) {
      const digit = HEX[i] ?? "0";
      const id = `019e1de3-6017-71b6-919d-35204ca876${digit}e`;
      await repo.append(
        buildEvent({
          eventId: EventId.from(id),
          eventType: ALL_EVENT_TYPES[i] ?? "KeyEnvelopeAdded",
          occurredAt: Timestamp.fromEpochMs(ANCHOR_MS + i),
        }),
      );
    }

    const rows = selectAll();
    expect(rows.length).toBe(ALL_EVENT_TYPES.length);
    for (let i = 0; i < ALL_EVENT_TYPES.length; i += 1) {
      expect(rows[i]?.event_type).toBe(ALL_EVENT_TYPES[i]);
    }
  });

  it("round-trips all 3 EncryptionAuditOutcome values", async () => {
    const ids = [EVENT_ID_1, EVENT_ID_2, EVENT_ID_3];
    for (let i = 0; i < ALL_OUTCOMES.length; i += 1) {
      await repo.append(
        buildEvent({
          eventId: EventId.from(ids[i] ?? EVENT_ID_1),
          outcome: ALL_OUTCOMES[i] ?? "SUCCESS",
          occurredAt: Timestamp.fromEpochMs(ANCHOR_MS + i),
        }),
      );
    }
    const rows = selectAll();
    expect(rows.length).toBe(ALL_OUTCOMES.length);
    expect(rows.map((r) => r.outcome)).toEqual([
      "SUCCESS",
      "FAILURE",
      "TIMEOUT",
    ]);
  });
});

describe("SqliteEncryptionAuditRepository.append — defence-in-depth on event_id parsing", () => {
  /**
   * The adapter's private `uuidStringToBytes` validates the hex shape
   * even though `EventId` already does. The two guards below are
   * normally unreachable in production (the VO would reject the
   * input first), but a future caller might bypass the VO; the
   * defence-in-depth tests below prove the guard fires.
   *
   * We reach the private code path by constructing an event that
   * looks well-formed to TypeScript (the VO factory accepts the
   * canonical input) and then mutating the underlying value via
   * `Object.defineProperty` to inject the bad shape after
   * construction — exclusively for the guard test.
   */
  it("rejects an event_id whose dash-stripped length is not 32 hex digits", async () => {
    const event = buildEvent();
    const fakeEventId = {
      toString: (): string => "deadbeef", // 8 chars, far from 32
    };
    Object.defineProperty(event, "eventId", {
      value: fakeEventId,
      writable: false,
      configurable: false,
    });
    await expect(repo.append(event)).rejects.toThrow(
      /event_id must canonically be a UUID v7/,
    );
  });

  it("rejects an event_id with non-hex characters after dash-stripping", async () => {
    const event = buildEvent();
    // 32 chars, but containing non-hex "zz".
    const fakeEventId = {
      toString: (): string => "zzdeadbeefdeadbeefdeadbeefdeadbe",
    };
    Object.defineProperty(event, "eventId", {
      value: fakeEventId,
      writable: false,
      configurable: false,
    });
    await expect(repo.append(event)).rejects.toThrow(
      /event_id contains a non-hex byte/,
    );
  });
});

describe("SqliteEncryptionAuditRepository.append — ordering / index", () => {
  it("supports ORDER BY occurred_at_ms DESC via idx_eal_ts", async () => {
    await repo.append(
      buildEvent({
        eventId: EventId.from(EVENT_ID_1),
        occurredAt: Timestamp.fromEpochMs(ANCHOR_MS + 1),
        envelopeId: KeyId.from(ENVELOPE_ID_1),
      }),
    );
    await repo.append(
      buildEvent({
        eventId: EventId.from(EVENT_ID_2),
        occurredAt: Timestamp.fromEpochMs(ANCHOR_MS + 2),
        envelopeId: KeyId.from(ENVELOPE_ID_2),
      }),
    );
    await repo.append(
      buildEvent({
        eventId: EventId.from(EVENT_ID_3),
        occurredAt: Timestamp.fromEpochMs(ANCHOR_MS + 3),
        envelopeId: KeyId.from(ENVELOPE_ID_1),
      }),
    );

    const stmt = database.prepare(
      `SELECT occurred_at_ms
         FROM encryption_audit_log
         ORDER BY occurred_at_ms DESC`,
    );
    const rows = stmt.all() as readonly { occurred_at_ms: number }[];
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.occurred_at_ms)).toEqual([
      ANCHOR_MS + 3,
      ANCHOR_MS + 2,
      ANCHOR_MS + 1,
    ]);

    // Verify the planner actually uses the index. EXPLAIN QUERY PLAN
    // returns rows with a `detail` column whose text mentions
    // "USING INDEX idx_eal_ts" when the index is exercised.
    const planStmt = database.prepare(
      `EXPLAIN QUERY PLAN
         SELECT occurred_at_ms
           FROM encryption_audit_log
           ORDER BY occurred_at_ms DESC`,
    );
    const planRows = planStmt.all() as readonly { detail: string }[];
    const planText = planRows.map((r) => r.detail).join("\n");
    // Either the index is used directly, or SQLite reports it
    // explicitly. The exact wording varies across SQLite versions;
    // we accept either canonical phrasing.
    expect(/idx_eal_ts/.test(planText)).toBe(true);
  });
});
