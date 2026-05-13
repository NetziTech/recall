import { describe, it, expect } from "vitest";

import { appendUnlockFailedAudit } from "../../../../../../src/modules/encryption/application/use-cases/_helpers/append-unlock-failed-audit.ts";
import type {
  EncryptionAuditEvent,
  EncryptionAuditLogRepository,
} from "../../../../../../src/modules/encryption/domain/repositories/encryption-audit-log-repository.ts";
import type { DatabaseConnection } from "../../../../../../src/shared/application/ports/database-connection.port.ts";
import { Timestamp } from "../../../../../../src/shared/domain/value-objects/timestamp.ts";
import { FakeIdGenerator } from "../../../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { RecordingLogger } from "../../../../../_fixtures/silent-logger.ts";

const EV_ID = "00000000-0000-7000-8000-0000000000aa";
const OCCURRED_AT = 1_700_000_900_000;

/**
 * Minimal in-memory `EncryptionAuditLogRepository` that records every
 * `append` call.
 */
class RecordingAuditRepo implements EncryptionAuditLogRepository {
  public events: EncryptionAuditEvent[] = [];
  public failures: number = 0;
  public override?: () => Promise<void>;
  public append(event: EncryptionAuditEvent): Promise<void> {
    if (this.override !== undefined) {
      this.failures += 1;
      return this.override();
    }
    this.events.push(event);
    return Promise.resolve();
  }
}

/**
 * Stub `DatabaseConnection` that only honours `transaction(fn)` — the
 * only operation the helper invokes. Counts call sites for asserts.
 */
class StubDatabase implements DatabaseConnection {
  public transactionCalls = 0;
  public prepare(): never {
    throw new Error("not used in this test");
  }
  public exec(): void {
    /* no-op */
  }
  public transaction<T>(fn: () => T): T {
    this.transactionCalls += 1;
    return fn();
  }
  public close(): void {
    /* no-op */
  }
}

describe("appendUnlockFailedAudit", () => {
  it("appends a single UnlockFailed row with the canonical shape", async () => {
    const audit = new RecordingAuditRepo();
    const db = new StubDatabase();
    const logger = new RecordingLogger();
    const idGen = new FakeIdGenerator({ sequence: [EV_ID] });

    await appendUnlockFailedAudit({
      auditLogRepository: audit,
      database: db,
      idGenerator: idGen,
      logger,
      occurredAt: Timestamp.fromEpochMs(OCCURRED_AT),
      actorHint: "cli:add-key",
      reason: "invalid-passphrase",
    });

    expect(audit.events).toHaveLength(1);
    const row = audit.events[0];
    expect(row?.eventType).toBe("UnlockFailed");
    expect(row?.outcome).toBe("FAILURE");
    expect(row?.envelopeId).toBeNull();
    expect(row?.masterKeyFingerprint).toBeNull();
    expect(row?.actorHint.toString()).toBe("cli:add-key");
    expect(row?.detailJson).toEqual({ reason: "invalid-passphrase" });
    expect(row?.occurredAt.toEpochMs()).toBe(OCCURRED_AT);
    expect(db.transactionCalls).toBe(1);
  });

  it("supports every multi-key actor-hint without changing the row shape", async () => {
    for (const actorHint of [
      "cli:add-key",
      "cli:rekey",
      "cli:export-key",
    ] as const) {
      const audit = new RecordingAuditRepo();
      const db = new StubDatabase();
      const logger = new RecordingLogger();
      const idGen = new FakeIdGenerator({ sequence: [EV_ID] });
      await appendUnlockFailedAudit({
        auditLogRepository: audit,
        database: db,
        idGenerator: idGen,
        logger,
        occurredAt: Timestamp.fromEpochMs(OCCURRED_AT),
        actorHint,
        reason: "invalid-passphrase",
      });
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]?.actorHint.toString()).toBe(actorHint);
    }
  });

  it("swallows an audit-append failure and logs a warn (best-effort)", async () => {
    const audit = new RecordingAuditRepo();
    audit.override = () => Promise.reject(new Error("audit infra broken"));
    const db = new StubDatabase();
    const logger = new RecordingLogger();
    const idGen = new FakeIdGenerator({ sequence: [EV_ID] });

    // The helper MUST NOT throw; the caller observes a clean resolution
    // and falls through to its own `throw unlockResult.error` line.
    await expect(
      appendUnlockFailedAudit({
        auditLogRepository: audit,
        database: db,
        idGenerator: idGen,
        logger,
        occurredAt: Timestamp.fromEpochMs(OCCURRED_AT),
        actorHint: "cli:rekey",
        reason: "invalid-passphrase",
      }),
    ).resolves.toBeUndefined();

    expect(audit.failures).toBe(1);
    expect(audit.events).toHaveLength(0);

    // A warn entry was emitted carrying the actor-hint and the error
    // message. NO secret material in the payload (no passphrase,
    // derived key, master key, or workspace path).
    const warnEntries = logger.entries.filter((e) => e.level === "warn");
    expect(warnEntries).toHaveLength(1);
    const payload = warnEntries[0]?.payload as Record<string, unknown>;
    expect(payload["actorHint"]).toBe("cli:rekey");
    expect(payload["auditError"]).toBe("audit infra broken");
  });

  it("rejects an empty actorHint via the NonEmptyString VO (defense in depth)", async () => {
    const audit = new RecordingAuditRepo();
    const db = new StubDatabase();
    const logger = new RecordingLogger();
    const idGen = new FakeIdGenerator({ sequence: [EV_ID] });

    // The VO constructor throws synchronously when the actor-hint is
    // empty. The helper does NOT wrap that throw in its best-effort
    // catch (the catch only protects the audit-append step), so the
    // caller observes an InvalidInputError. This is intentional —
    // an empty actor-hint is a caller bug, not a runtime audit
    // infrastructure failure.
    await expect(
      appendUnlockFailedAudit({
        auditLogRepository: audit,
        database: db,
        idGenerator: idGen,
        logger,
        occurredAt: Timestamp.fromEpochMs(OCCURRED_AT),
        actorHint: "",
        reason: "invalid-passphrase",
      }),
    ).rejects.toThrow();
  });
});
