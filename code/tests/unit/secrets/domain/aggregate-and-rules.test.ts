import { describe, it, expect } from "vitest";
import { SecretAuditEntry } from "../../../../src/modules/secrets/domain/aggregates/secret-audit-entry.ts";
import { AuditEventId } from "../../../../src/modules/secrets/domain/value-objects/audit-event-id.ts";
import { PathSanitizerRule } from "../../../../src/modules/secrets/domain/value-objects/path-sanitizer-rule.ts";
import { SanitizedPath } from "../../../../src/modules/secrets/domain/value-objects/sanitized-path.ts";
import { SecretFinding } from "../../../../src/modules/secrets/domain/value-objects/secret-finding.ts";
import { SecretMatch } from "../../../../src/modules/secrets/domain/value-objects/secret-match.ts";
import { SecretKind } from "../../../../src/modules/secrets/domain/value-objects/secret-kind.ts";
import { SecretActions } from "../../../../src/modules/secrets/domain/value-objects/secret-action.ts";
import { SecretSources } from "../../../../src/modules/secrets/domain/value-objects/secret-source.ts";
import { DetectorName } from "../../../../src/modules/secrets/domain/value-objects/detector-name.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { isOk, isErr } from "../../../../src/shared/domain/types/result.ts";
import { PathSanitizerError } from "../../../../src/modules/secrets/domain/errors/path-sanitizer-error.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const AUDIT_ID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

const finding = (): SecretFinding =>
  SecretFinding.create({
    kind: SecretKind.apiKey(),
    position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
    confidence: Confidence.full(),
    source: SecretSources.text("rationale"),
    detectedBy: DetectorName.from("regex.test"),
  });

describe("SecretAuditEntry", () => {
  it("record() creates and emits SecretAuditEntryRecorded", () => {
    const entry = SecretAuditEntry.record({
      id: AuditEventId.from(AUDIT_ID),
      workspaceId: WorkspaceId.from(WS_ID),
      finding: finding(),
      action: SecretActions.blocked(),
      occurredAt: Timestamp.fromEpochMs(1_700_000_000_000),
    });
    expect(entry.getId().toString()).toBe(AUDIT_ID);
    expect(entry.getWorkspaceId().toString()).toBe(WS_ID);
    expect(entry.getAction().kind).toBe("blocked");
    const events = entry.pullEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.eventName).toBe("secrets.audit-entry-recorded");
  });

  it("rehydrate() does NOT emit events", () => {
    const entry = SecretAuditEntry.rehydrate({
      id: AuditEventId.from(AUDIT_ID),
      workspaceId: WorkspaceId.from(WS_ID),
      finding: finding(),
      action: SecretActions.redacted(),
      occurredAt: Timestamp.fromEpochMs(1_700_000_000_000),
    });
    expect(entry.pullEvents().length).toBe(0);
  });

  it("pullEvents() drains buffer and returns frozen", () => {
    const entry = SecretAuditEntry.record({
      id: AuditEventId.from(AUDIT_ID),
      workspaceId: WorkspaceId.from(WS_ID),
      finding: finding(),
      action: SecretActions.warnedUser(),
      occurredAt: Timestamp.fromEpochMs(1),
    });
    expect(entry.pullEvents().length).toBe(1);
    const second = entry.pullEvents();
    expect(second.length).toBe(0);
    expect(Object.isFrozen(second)).toBe(true);
  });

  it("getFinding/getOccurredAt return values", () => {
    const f = finding();
    const ts = Timestamp.fromEpochMs(123);
    const entry = SecretAuditEntry.record({
      id: AuditEventId.from(AUDIT_ID),
      workspaceId: WorkspaceId.from(WS_ID),
      finding: f,
      action: SecretActions.blocked(),
      occurredAt: ts,
    });
    expect(entry.getFinding()).toBe(f);
    expect(entry.getOccurredAt()).toBe(ts);
  });
});

describe("PathSanitizerRule", () => {
  describe("relativeOnly()", () => {
    const rule = PathSanitizerRule.relativeOnly();

    it("accepts a relative path", () => {
      const result = rule.apply("src/foo.ts");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.toString()).toBe("src/foo.ts");
      }
    });

    it("rejects empty / whitespace", () => {
      expect(isErr(rule.apply(""))).toBe(true);
      expect(isErr(rule.apply("   "))).toBe(true);
    });

    it("rejects non-string", () => {
      expect(isErr(rule.apply(123 as unknown as string))).toBe(true);
    });

    it("rejects oversized", () => {
      expect(isErr(rule.apply("a".repeat(5000)))).toBe(true);
    });

    it("rejects NUL byte", () => {
      expect(isErr(rule.apply("foo\0bar"))).toBe(true);
    });

    it("rejects path-traversal '..' segment", () => {
      const result = rule.apply("foo/../bar");
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("path-traversal");
      }
    });

    it("rejects absolute paths", () => {
      const result = rule.apply("/Users/foo/bar");
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("absolute-path-not-allowed");
      }
    });

    it("rejects Windows drive paths", () => {
      const result = rule.apply("C:\\foo\\bar");
      expect(isErr(result)).toBe(true);
    });
  });

  describe("tildeRewrite()", () => {
    it("rewrites /Users/<segment>", () => {
      const rule = PathSanitizerRule.tildeRewrite("alice");
      const result = rule.apply("/Users/alice/projects/foo");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.toString()).toBe("~/projects/foo");
      }
    });

    it("rewrites /home/<segment>", () => {
      const rule = PathSanitizerRule.tildeRewrite("alice");
      const result = rule.apply("/home/alice/work/x");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.toString()).toBe("~/work/x");
      }
    });

    it("rewrites bare /Users/<segment> to ~", () => {
      const rule = PathSanitizerRule.tildeRewrite("alice");
      const result = rule.apply("/Users/alice");
      if (isOk(result)) {
        expect(result.value.toString()).toBe("~");
      }
    });

    it("rewrites Windows /Users/<segment>", () => {
      const rule = PathSanitizerRule.tildeRewrite("alice");
      const result = rule.apply("C:\\Users\\alice\\proj");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.toString()).toBe("~\\proj");
      }
    });

    it("does not rewrite when userSegment is null", () => {
      const rule = PathSanitizerRule.tildeRewrite(null);
      const result = rule.apply("/Users/alice/foo");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.toString()).toBe("/Users/alice/foo");
      }
    });

    it("treats empty userSegment as null", () => {
      const rule = PathSanitizerRule.tildeRewrite("");
      expect(rule.userSegment).toBeNull();
    });

    it("treats userSegment with separators as null", () => {
      const rule = PathSanitizerRule.tildeRewrite("foo/bar");
      expect(rule.userSegment).toBeNull();
      const ruleWin = PathSanitizerRule.tildeRewrite("foo\\bar");
      expect(ruleWin.userSegment).toBeNull();
    });

    it("rejects path-traversal", () => {
      const rule = PathSanitizerRule.tildeRewrite("alice");
      expect(isErr(rule.apply("../foo"))).toBe(true);
    });

    it("rejects NUL byte and oversized", () => {
      const rule = PathSanitizerRule.tildeRewrite("alice");
      expect(isErr(rule.apply("foo\0bar"))).toBe(true);
      expect(isErr(rule.apply("a".repeat(5000)))).toBe(true);
    });

    it("rejects empty input", () => {
      const rule = PathSanitizerRule.tildeRewrite("alice");
      expect(isErr(rule.apply(""))).toBe(true);
    });
  });

  describe("static helpers", () => {
    it("isPolicy", () => {
      expect(PathSanitizerRule.isPolicy("relative-only")).toBe(true);
      expect(PathSanitizerRule.isPolicy("tilde-rewrite")).toBe(true);
      expect(PathSanitizerRule.isPolicy("xyz")).toBe(false);
    });

    it("equals", () => {
      const a = PathSanitizerRule.relativeOnly();
      const b = PathSanitizerRule.relativeOnly();
      const c = PathSanitizerRule.tildeRewrite("alice");
      expect(a.equals(a)).toBe(true);
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });
  });
});

describe("SanitizedPath", () => {
  it("create() accepts valid paths", () => {
    const p = SanitizedPath.create("foo/bar.ts");
    expect(p.toString()).toBe("foo/bar.ts");
  });

  it("rejects empty / oversized", () => {
    expect(() => SanitizedPath.create("")).toThrow();
    expect(() => SanitizedPath.create("a".repeat(5000))).toThrow();
  });

  it("rejects path-traversal", () => {
    expect(() => SanitizedPath.create("foo/../bar")).toThrow();
  });

  it("rejects NUL byte", () => {
    expect(() => SanitizedPath.create("foo\0")).toThrow();
  });

  it("equals", () => {
    const a = SanitizedPath.create("foo");
    const b = SanitizedPath.create("foo");
    const c = SanitizedPath.create("bar");
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});

describe("PathSanitizerError", () => {
  it("carries kind and rawPath, redacts in message", () => {
    const err = new PathSanitizerError({
      kind: "path-traversal",
      rawPath: "/some/path",
    });
    expect(err.kind).toBe("path-traversal");
  });

  it("carries cause", () => {
    const cause = new Error("root");
    const err = new PathSanitizerError({
      kind: "invalid-separator",
      rawPath: "x",
    }, cause);
    expect(err.cause).toBe(cause);
  });
});
