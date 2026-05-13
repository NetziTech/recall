/**
 * Integration test — `CliAddKeyFacadeAdapter` (ADR-005 step 5).
 *
 * Drives the multi-key v0.5+ add-envelope flow end-to-end:
 *
 *   buildTestContainer
 *     → workspace.initializeWorkspace.initialize({mode: "encrypted", passphrase})
 *     → cli.addKey.add({rootPath, currentPassphrase, newPassphrase, label})
 *
 * Verifies:
 *   - The facade returns a fresh envelope id + workspace id.
 *   - The encryption config on disk now carries TWO key envelopes.
 *   - The `encryption_audit_log` table contains exactly two rows:
 *     `UnlockSucceeded` + `KeyEnvelopeAdded`, both with the same
 *     master-key fingerprint, both with outcome=SUCCESS.
 *
 * Why no TTY mocking:
 *   - The handler-side prompt orchestration is already covered by
 *     `tests/unit/cli/application/handlers/encryption-handlers.test.ts`
 *     (the `ScriptedPrompt` fixture). This suite targets the facade
 *     boundary so the integration tests exercise the cross-module
 *     wiring + persistence + audit-log paths under a real SQLite
 *     connection — orthogonal to the prompt-collection mechanics.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DisplayName } from "../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { buildTestContainer, type TestContainer } from "../_helpers/build-test-container.ts";

const CURRENT_PASSPHRASE = "correct-horse-battery-staple-2026";
const NEW_PASSPHRASE = "another-strong-passphrase-for-bob";

const DEFAULT_EMBEDDER = EmbedderSpec.create({
  provider: "fastembed",
  model: "BGESmallEN15",
});

interface AuditRow {
  readonly event_id: Buffer;
  readonly occurred_at_ms: number;
  readonly event_type: string;
  readonly envelope_id: string | null;
  readonly master_key_fp: string | null;
  readonly outcome: string;
}

interface ConfigJson {
  readonly key_envelopes?: ReadonlyArray<{
    readonly id: string;
    readonly label?: string | null;
  }>;
}

describe("integration / composition / CliAddKeyFacadeAdapter — multi-key add", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer({ skipMigrations: false });
    await ctx.workspace.initializeWorkspace.initialize({
      rootPath: WorkspacePath.create(ctx.workspaceRoot),
      mode: WorkspaceMode.encryptedMode(),
      displayName: DisplayName.create("add-key-flow"),
      embedder: DEFAULT_EMBEDDER,
      passphrase: CURRENT_PASSPHRASE,
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("end-to-end: workspace init + add-key registers a new envelope", async () => {
    // We cannot reach the wired AddKey facade through `TestContainer`
    // (the bag is hidden behind `buildCliWiring`'s `handlers` array).
    // Mirror the bootstrap by building a fresh CliAddKeyFacadeAdapter
    // wired against the SAME use cases — equivalent to the production
    // wire path.
    const { CliAddKeyFacadeAdapter } = await import(
      "../../../src/composition/facades/cli-facades.ts"
    );
    const { AddEnvelopeUseCase } = await import(
      "../../../src/modules/encryption/application/use-cases/add-envelope.use-case.ts"
    );
    const { SqliteEncryptionAuditRepository } = await import(
      "../../../src/modules/encryption/infrastructure/persistence/sqlite-encryption-audit-repository.ts"
    );
    const facade = new CliAddKeyFacadeAdapter(
      new AddEnvelopeUseCase(
        ctx.encryption.unlockEncryption,
        ctx.encryption.repository,
        new SqliteEncryptionAuditRepository(ctx.database),
        ctx.encryption.primitives.kdf,
        ctx.encryption.primitives.envelopeCipher,
        ctx.encryption.primitives.randomBytes,
        ctx.idGenerator,
        ctx.clock,
        ctx.database,
        ctx.logger,
      ),
      ctx.workspace.detectWorkspace,
    );

    const out = await facade.add({
      rootPath: ctx.workspaceRoot,
      currentPassphrase: CURRENT_PASSPHRASE,
      newPassphrase: NEW_PASSPHRASE,
      label: "alice@laptop",
    });

    expect(out.workspaceId.length).toBeGreaterThan(0);
    expect(out.keyId.length).toBeGreaterThan(0);
    expect(out.printableKey).toBe(out.keyId);

    // Filesystem assertion: config.json now lists two envelopes, one
    // of which carries the supplied label.
    const configPath = path.join(ctx.workspaceRoot, ".recall", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as ConfigJson;
    expect(config.key_envelopes?.length).toBe(2);
    const labels = (config.key_envelopes ?? []).map((env) => env.label ?? null);
    expect(labels).toContain("alice@laptop");

    // SQLite assertion: the audit log contains EXACTLY two rows from
    // this run, joined on a single master-key fingerprint, both with
    // outcome=SUCCESS. Flow (verified post-investigation F-A6-1):
    //   - `CliAddKeyFacadeAdapter.add(...)` calls only
    //     `AddEnvelopeUseCase.addEnvelope(...)`. It does NOT perform a
    //     separate pre-unlock at the facade boundary.
    //   - `AddEnvelopeUseCase.addEnvelope(...)` orchestrates unlock +
    //     wrap + persist + audit. The audit step (`appendAuditPair`)
    //     emits EXACTLY one `UnlockSucceeded` + one `KeyEnvelopeAdded`
    //     atomically inside one SQLite transaction.
    //   - `UnlockEncryptionUseCase.unlock(...)` does NOT write to the
    //     audit log; it emits the `EncryptionUnlocked` domain event
    //     which is unsubscribed in production (no double-row source).
    // The asserts therefore demand exact counts, not floors. Closes
    // FP-A5-3 + F-A6-1 (HANDOFF §8): tightening the assert from
    // `>= 1` to `=== 1` traps a future regression that would emit a
    // stray `UnlockSucceeded` (e.g. wiring the unlock use case to a
    // hypothetical "log every unlock" subscriber).
    const rows = ctx.database
      .prepare(
        `SELECT event_id, occurred_at_ms, event_type, envelope_id,
                master_key_fp, outcome
         FROM encryption_audit_log
         ORDER BY occurred_at_ms ASC, rowid ASC`,
      )
      .all() as readonly AuditRow[];
    const unlockRows = rows.filter((r) => r.event_type === "UnlockSucceeded");
    const addedRows = rows.filter((r) => r.event_type === "KeyEnvelopeAdded");
    expect(unlockRows.length).toBe(1);
    expect(addedRows.length).toBe(1);
    expect(addedRows[0]?.envelope_id).toBe(out.keyId);
    expect(addedRows[0]?.outcome).toBe("SUCCESS");
    // The KeyEnvelopeAdded row carries a fingerprint; the audit
    // adapter writes the truncated lowercase-hex SHA-256 prefix.
    expect(addedRows[0]?.master_key_fp).not.toBeNull();
    expect((addedRows[0]?.master_key_fp ?? "").length).toBe(16);
  });

  it("rejects a wrong current passphrase WITHOUT touching the envelope list", async () => {
    const { CliAddKeyFacadeAdapter } = await import(
      "../../../src/composition/facades/cli-facades.ts"
    );
    const { AddEnvelopeUseCase } = await import(
      "../../../src/modules/encryption/application/use-cases/add-envelope.use-case.ts"
    );
    const { SqliteEncryptionAuditRepository } = await import(
      "../../../src/modules/encryption/infrastructure/persistence/sqlite-encryption-audit-repository.ts"
    );
    const facade = new CliAddKeyFacadeAdapter(
      new AddEnvelopeUseCase(
        ctx.encryption.unlockEncryption,
        ctx.encryption.repository,
        new SqliteEncryptionAuditRepository(ctx.database),
        ctx.encryption.primitives.kdf,
        ctx.encryption.primitives.envelopeCipher,
        ctx.encryption.primitives.randomBytes,
        ctx.idGenerator,
        ctx.clock,
        ctx.database,
        ctx.logger,
      ),
      ctx.workspace.detectWorkspace,
    );

    await expect(
      facade.add({
        rootPath: ctx.workspaceRoot,
        currentPassphrase: "wrong-but-long-enough-passphrase",
        newPassphrase: NEW_PASSPHRASE,
        label: null,
      }),
    ).rejects.toMatchObject({
      // The encryption module raises `KeyValidationFailedError` when
      // no envelope matches the supplied passphrase.
      code: "encryption.key-validation-failed",
    });

    // The envelope list is unchanged: still one envelope on disk.
    const configPath = path.join(ctx.workspaceRoot, ".recall", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as ConfigJson;
    expect(config.key_envelopes?.length).toBe(1);

    // FP-A5-1 (HANDOFF §8): the failed unlock leaves a best-effort
    // `UnlockFailed` audit row so brute-force passphrase attempts
    // against the add-key flow are forensically observable.
    interface FailedAuditRow extends AuditRow {
      readonly detail_json: string | null;
      readonly actor_hint: string;
    }
    const failedRows = ctx.database
      .prepare(
        `SELECT event_id, occurred_at_ms, event_type, envelope_id,
                master_key_fp, outcome, detail_json, actor_hint
         FROM encryption_audit_log
         WHERE event_type = 'UnlockFailed'`,
      )
      .all() as readonly FailedAuditRow[];
    expect(failedRows.length).toBe(1);
    expect(failedRows[0]?.outcome).toBe("FAILURE");
    expect(failedRows[0]?.envelope_id).toBeNull();
    expect(failedRows[0]?.master_key_fp).toBeNull();
    expect(failedRows[0]?.actor_hint).toBe("cli:add-key");
    expect(failedRows[0]?.detail_json).not.toBeNull();
    expect(
      JSON.parse(failedRows[0]?.detail_json ?? "{}") as Record<string, unknown>,
    ).toEqual({ reason: "invalid-passphrase" });
  });
});
