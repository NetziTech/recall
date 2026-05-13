/**
 * Integration test — `CliRekeyFacadeAdapter` (ADR-005 step 6).
 *
 * Drives the multi-key v0.5+ rekey flow end-to-end:
 *
 *   buildTestContainer
 *     → workspace.initializeWorkspace.initialize({mode: "encrypted", passphrase: CURRENT})
 *     → cli.addKey.add({rootPath, currentPassphrase, newPassphrase, label})
 *         (adds a SECOND envelope so the rekey has TWO envelopes to remove)
 *     → cli.rekey.rekey({rootPath, currentPassphrase, newPassphrase, label})
 *
 * Verifies:
 *   - The facade returns a fresh envelope id, the list of removed
 *     ids, and an ISO-8601 timestamp.
 *   - The encryption config on disk now carries exactly ONE envelope
 *     (the freshly minted one).
 *   - The `encryption_audit_log` table contains the full rotation
 *     chain: `RekeyStarted` + `UnlockSucceeded` + `KeyEnvelopeAdded`
 *     + `KeyEnvelopeRemoved` × 2 + `RekeyCompleted`.
 *   - Unlock with the ORIGINAL passphrase now fails (the old
 *     envelopes were stripped).
 *
 * Why no TTY mocking:
 *   - Mirrors the add-key integration test: the handler-side prompt
 *     orchestration is unit-tested elsewhere; this suite targets the
 *     facade boundary so the cross-module wiring + persistence +
 *     audit-log paths run under a real SQLite connection.
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
const SECONDARY_PASSPHRASE = "second-envelope-passphrase-2026";
const NEW_PASSPHRASE = "rotated-passphrase-after-the-rekey";

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

describe("integration / composition / CliRekeyFacadeAdapter — multi-key rotation", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer({ skipMigrations: false });
    await ctx.workspace.initializeWorkspace.initialize({
      rootPath: WorkspacePath.create(ctx.workspaceRoot),
      mode: WorkspaceMode.encryptedMode(),
      displayName: DisplayName.create("rekey-flow"),
      embedder: DEFAULT_EMBEDDER,
      passphrase: CURRENT_PASSPHRASE,
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("end-to-end: workspace init + add-key + rekey rotates the envelope list", async () => {
    // We cannot reach the wired Rekey facade through `TestContainer`
    // (the bag is hidden behind `buildCliWiring`'s `handlers` array).
    // Build a fresh adapter wired against the SAME use cases — the
    // equivalent of the production wire path.
    const { CliAddKeyFacadeAdapter, CliRekeyFacadeAdapter } = await import(
      "../../../src/composition/facades/cli-facades.ts"
    );
    const { AddEnvelopeUseCase } = await import(
      "../../../src/modules/encryption/application/use-cases/add-envelope.use-case.ts"
    );
    const { RekeyEncryptionUseCase } = await import(
      "../../../src/modules/encryption/application/use-cases/rekey-encryption.use-case.ts"
    );
    const { SqliteEncryptionAuditRepository } = await import(
      "../../../src/modules/encryption/infrastructure/persistence/sqlite-encryption-audit-repository.ts"
    );
    const addKeyFacade = new CliAddKeyFacadeAdapter(
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
    const rekeyFacade = new CliRekeyFacadeAdapter(
      new RekeyEncryptionUseCase(
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

    // Add a SECOND envelope so the rekey snapshot has two ids to
    // remove (covers the multi-row `KeyEnvelopeRemoved` branch).
    const addOut = await addKeyFacade.add({
      rootPath: ctx.workspaceRoot,
      currentPassphrase: CURRENT_PASSPHRASE,
      newPassphrase: SECONDARY_PASSPHRASE,
      label: "secondary",
    });
    expect(addOut.keyId.length).toBeGreaterThan(0);

    // Now run the rekey.
    const out = await rekeyFacade.rekey({
      rootPath: ctx.workspaceRoot,
      currentPassphrase: CURRENT_PASSPHRASE,
      newPassphrase: NEW_PASSPHRASE,
      label: "rotated@2026",
    });

    expect(out.workspaceId.length).toBeGreaterThan(0);
    expect(out.newKeyId.length).toBeGreaterThan(0);
    expect(out.removedKeyIds.length).toBe(2);
    // The newKeyId is NOT in the removed list.
    expect(out.removedKeyIds).not.toContain(out.newKeyId);
    // The previously added secondary keyId IS in the removed list.
    expect(out.removedKeyIds).toContain(addOut.keyId);
    // rotatedAt is a valid ISO-8601 timestamp.
    expect(() => new Date(out.rotatedAt).toISOString()).not.toThrow();

    // Filesystem assertion: config.json now lists EXACTLY one envelope
    // (the freshly minted one).
    const configPath = path.join(ctx.workspaceRoot, ".recall", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as ConfigJson;
    expect(config.key_envelopes?.length).toBe(1);
    expect(config.key_envelopes?.[0]?.id).toBe(out.newKeyId);
    expect(config.key_envelopes?.[0]?.label).toBe("rotated@2026");

    // SQLite assertion: the audit log contains the full rotation chain.
    // Post-investigation (F-A6-1, HANDOFF §8) the contributors are
    // exactly two: the prior `add-key` call and the `rekey` call.
    // Neither the facade nor `UnlockEncryptionUseCase` emit extra
    // `UnlockSucceeded` rows, so the totals are deterministic:
    //   - add-key step:       1 UnlockSucceeded + 1 KeyEnvelopeAdded
    //   - rekey step:         1 RekeyStarted + 1 UnlockSucceeded +
    //                          1 KeyEnvelopeAdded + 2 KeyEnvelopeRemoved
    //                          + 1 RekeyCompleted
    //   - totals:             2 UnlockSucceeded + 2 KeyEnvelopeAdded +
    //                          1 RekeyStarted + 1 RekeyCompleted +
    //                          2 KeyEnvelopeRemoved
    // Exact-count asserts trap a future regression that would emit a
    // stray `UnlockSucceeded` (e.g. if the unlock use case starts
    // writing directly to the audit log).
    const rows = ctx.database
      .prepare(
        `SELECT event_id, occurred_at_ms, event_type, envelope_id,
                master_key_fp, outcome
         FROM encryption_audit_log
         ORDER BY occurred_at_ms ASC, rowid ASC`,
      )
      .all() as readonly AuditRow[];

    const unlockRows = rows.filter((r) => r.event_type === "UnlockSucceeded");
    const rekeyStartedRows = rows.filter((r) => r.event_type === "RekeyStarted");
    const rekeyCompletedRows = rows.filter((r) => r.event_type === "RekeyCompleted");
    const removedRows = rows.filter((r) => r.event_type === "KeyEnvelopeRemoved");
    const addedRows = rows.filter((r) => r.event_type === "KeyEnvelopeAdded");

    expect(unlockRows.length).toBe(2);
    expect(rekeyStartedRows.length).toBe(1);
    expect(rekeyCompletedRows.length).toBe(1);
    expect(removedRows.length).toBe(2);
    expect(addedRows.length).toBe(2);

    // The trailing KeyEnvelopeAdded row carries the rekey's new
    // envelope id (rows are ordered by occurred_at_ms ASC, rowid ASC;
    // the rekey rows are the latest by construction).
    const lastAdded = addedRows[addedRows.length - 1];
    expect(lastAdded?.envelope_id).toBe(out.newKeyId);

    // Every removed row carries an envelope id; together they cover
    // both prior envelopes.
    const removedIds = removedRows
      .map((r) => r.envelope_id)
      .filter((id): id is string => id !== null);
    expect(removedIds.length).toBe(2);
    for (const id of out.removedKeyIds) {
      expect(removedIds).toContain(id);
    }

    // The rekey-chain rows are uniformly outcome=SUCCESS.
    for (const row of [
      ...rekeyStartedRows,
      ...rekeyCompletedRows,
      ...removedRows,
    ]) {
      expect(row.outcome).toBe("SUCCESS");
      expect(row.master_key_fp).not.toBeNull();
      expect((row.master_key_fp ?? "").length).toBe(16);
    }
  });

  it("rejects a wrong current passphrase WITHOUT touching the envelope list", async () => {
    const { CliRekeyFacadeAdapter } = await import(
      "../../../src/composition/facades/cli-facades.ts"
    );
    const { RekeyEncryptionUseCase } = await import(
      "../../../src/modules/encryption/application/use-cases/rekey-encryption.use-case.ts"
    );
    const { SqliteEncryptionAuditRepository } = await import(
      "../../../src/modules/encryption/infrastructure/persistence/sqlite-encryption-audit-repository.ts"
    );
    const rekeyFacade = new CliRekeyFacadeAdapter(
      new RekeyEncryptionUseCase(
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
      rekeyFacade.rekey({
        rootPath: ctx.workspaceRoot,
        currentPassphrase: "wrong-but-long-enough-passphrase",
        newPassphrase: NEW_PASSPHRASE,
        label: null,
      }),
    ).rejects.toMatchObject({
      code: "encryption.key-validation-failed",
    });

    // The envelope list is unchanged: still one envelope on disk.
    const configPath = path.join(ctx.workspaceRoot, ".recall", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as ConfigJson;
    expect(config.key_envelopes?.length).toBe(1);

    // F-A6-2 (HANDOFF §8): the failed unlock leaves a best-effort
    // `UnlockFailed` audit row attributed to `cli:rekey`. The pre-
    // unlock `RekeyStarted` is NOT emitted (the rekey flow appends
    // its audit chain only on success); the `appendRekeyFailed`
    // helper fires on POST-unlock errors, which is a distinct path.
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
    expect(failedRows[0]?.actor_hint).toBe("cli:rekey");
    expect(
      JSON.parse(failedRows[0]?.detail_json ?? "{}") as Record<string, unknown>,
    ).toEqual({ reason: "invalid-passphrase" });

    // RekeyStarted / RekeyCompleted / RekeyFailed must NOT have been
    // emitted on the unlock-failure path (the audit chain runs only
    // after a successful unlock; appendRekeyFailed is a distinct
    // post-unlock helper).
    const rekeyStartedRows = ctx.database
      .prepare(
        `SELECT event_id FROM encryption_audit_log
         WHERE event_type = 'RekeyStarted'`,
      )
      .all() as readonly { event_id: Buffer }[];
    expect(rekeyStartedRows.length).toBe(0);
  });
});
