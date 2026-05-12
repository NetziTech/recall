/**
 * Coverage for secrets-domain events and the
 * `SecretDetectionFailedError`. The events are simple immutable
 * records but their constructors and stable `eventName` literals are
 * not yet directly tested.
 */
import { describe, expect, it } from "vitest";

import { SecretBlocked } from "../../../../src/modules/secrets/domain/events/secret-blocked.ts";
import { SecretDetected } from "../../../../src/modules/secrets/domain/events/secret-detected.ts";
import { SecretRedacted } from "../../../../src/modules/secrets/domain/events/secret-redacted.ts";
import { SecretDetectionFailedError } from "../../../../src/modules/secrets/domain/errors/secret-detection-failed-error.ts";

import { SecretFinding } from "../../../../src/modules/secrets/domain/value-objects/secret-finding.ts";
import { SecretMatch } from "../../../../src/modules/secrets/domain/value-objects/secret-match.ts";
import { SecretKind } from "../../../../src/modules/secrets/domain/value-objects/secret-kind.ts";
import { SecretSources } from "../../../../src/modules/secrets/domain/value-objects/secret-source.ts";
import { DetectorName } from "../../../../src/modules/secrets/domain/value-objects/detector-name.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";

import { ANCHOR_TIME_MS, FIXED_WORKSPACE_UUID } from "../../../helpers/factories.ts";

const finding = (): SecretFinding =>
  SecretFinding.create({
    kind: SecretKind.apiKey(),
    position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
    confidence: Confidence.full(),
    source: SecretSources.text("rationale"),
    detectedBy: DetectorName.from("regex.test"),
  });

const ts = (ms: number = ANCHOR_TIME_MS): Timestamp => Timestamp.fromEpochMs(ms);
const ws = (): WorkspaceId => WorkspaceId.from(FIXED_WORKSPACE_UUID);

describe("SecretDetected", () => {
  it("carries every field and the stable event name", () => {
    const f = finding();
    const e = new SecretDetected({
      workspaceId: ws(),
      finding: f,
      occurredAt: ts(),
    });
    expect(e.eventName).toBe("secrets.detected");
    expect(e.finding).toBe(f);
    expect(e.workspaceId.equals(ws())).toBe(true);
    expect(e.occurredAt.equals(ts())).toBe(true);
  });
});

describe("SecretBlocked", () => {
  it("carries every field and the stable event name", () => {
    const f = finding();
    const e = new SecretBlocked({
      workspaceId: ws(),
      finding: f,
      occurredAt: ts(),
    });
    expect(e.eventName).toBe("secrets.blocked");
    expect(e.finding).toBe(f);
  });
});

describe("SecretRedacted", () => {
  it("carries every field and the stable event name", () => {
    const f = finding();
    const e = new SecretRedacted({
      workspaceId: ws(),
      finding: f,
      occurredAt: ts(),
    });
    expect(e.eventName).toBe("secrets.redacted");
  });
});

describe("SecretDetectionFailedError", () => {
  it("has stable code + null jsonRpcCode + null detectorName when not given", () => {
    const e = new SecretDetectionFailedError("boom");
    expect(e.code).toBe("secrets.detection-failed");
    expect(e.jsonRpcCode).toBeNull();
    expect(e.detectorName).toBeNull();
    expect(e.message).toBe("boom");
  });

  it("captures detectorName + cause when supplied", () => {
    const cause = new Error("inner");
    const e = new SecretDetectionFailedError("boom", { detectorName: "regex.aws-key" }, cause);
    expect(e.detectorName).toBe("regex.aws-key");
    expect(e.cause).toBe(cause);
  });
});
