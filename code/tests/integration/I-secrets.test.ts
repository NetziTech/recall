/**
 * Integration test — Flow I: secrets scanning + audit log.
 *
 * Walks the wired `ScanTextUseCase` and `RecordSecretEventUseCase`
 * end-to-end. Verifies:
 *
 *   - The default scanner detects an AWS access-key pattern in
 *     free-form text via the `BuiltInPatternRegistry`.
 *   - The scan output redacts the original token (the sanitised text
 *     does NOT contain the literal `AKIA...` string).
 *   - The `RecordSecretEventUseCase` persists a secret-audit row
 *     (table created by migration 001).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SecretActions } from "../../src/modules/secrets/domain/value-objects/secret-action.ts";
import { buildTestContainer, type TestContainer } from "./_helpers/build-test-container.ts";

const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

describe("integration / I / secrets — defence-in-depth detection", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("detects an AWS access-key in free-form text and redacts it", async () => {
    const sanitised = await ctx.secrets.scanText.scan({
      text: `Here is a fake key: ${FAKE_AWS_KEY} — please rotate.`,
      workspaceId: ctx.workspaceId,
    });
    expect(sanitised.hasFindings()).toBe(true);
    expect(sanitised.findingCount()).toBeGreaterThan(0);
    // Sanitised text MUST NOT contain the literal token.
    expect(sanitised.sanitized).not.toContain(FAKE_AWS_KEY);
  });

  it("returns 0 findings on a clean text", async () => {
    const sanitised = await ctx.secrets.scanText.scan({
      text: "this is just plain text with no secrets",
      workspaceId: ctx.workspaceId,
    });
    expect(sanitised.hasFindings()).toBe(false);
  });

  it("`RecordSecretEventUseCase` persists an audit-log row", async () => {
    const sanitised = await ctx.secrets.scanText.scan({
      text: `Bad: ${FAKE_AWS_KEY}`,
      workspaceId: ctx.workspaceId,
    });
    expect(sanitised.hasFindings()).toBe(true);

    for (const finding of sanitised.findings) {
      await ctx.secrets.recordSecretEvent.record({
        workspaceId: ctx.workspaceId,
        finding,
        action: SecretActions.redacted(),
      });
    }

    const rows = ctx.database
      .prepare(
        "SELECT id, workspace_id, action, finding_json FROM secret_audit_log",
      )
      .all() as readonly {
        id: string;
        workspace_id: string;
        action: string;
        finding_json: string;
      }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.workspace_id).toBe(ctx.workspaceId.toString());
    expect(rows[0]?.action).toBe("redacted");
    // The finding_json must be valid JSON.
    expect(() => JSON.parse(rows[0]?.finding_json ?? "")).not.toThrow();
  });
});
