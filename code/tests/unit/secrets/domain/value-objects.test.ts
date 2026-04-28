import { describe, it, expect } from "vitest";
import { SecretKind } from "../../../../src/modules/secrets/domain/value-objects/secret-kind.ts";
import { SecretActions } from "../../../../src/modules/secrets/domain/value-objects/secret-action.ts";
import { SecretSources } from "../../../../src/modules/secrets/domain/value-objects/secret-source.ts";
import { DetectorName } from "../../../../src/modules/secrets/domain/value-objects/detector-name.ts";
import { SecretMatch } from "../../../../src/modules/secrets/domain/value-objects/secret-match.ts";
import { SanitizedText } from "../../../../src/modules/secrets/domain/value-objects/sanitized-text.ts";
import { EntropyThreshold } from "../../../../src/modules/secrets/domain/value-objects/entropy-threshold.ts";
import { SecretPattern } from "../../../../src/modules/secrets/domain/value-objects/secret-pattern.ts";
import { SecretFinding } from "../../../../src/modules/secrets/domain/value-objects/secret-finding.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import { InvalidPatternError } from "../../../../src/modules/secrets/domain/errors/invalid-pattern-error.ts";

describe("SecretKind", () => {
  it("create() accepts every known kind", () => {
    const kinds = [
      "api_key",
      "oauth_token",
      "private_key",
      "password",
      "credential",
      "high_entropy_blob",
    ];
    for (const k of kinds) {
      expect(SecretKind.create(k).toString()).toBe(k);
    }
  });

  it("trims whitespace", () => {
    expect(SecretKind.create("  api_key  ").toString()).toBe("api_key");
  });

  it("rejects empty / non-string / unknown", () => {
    expect(() => SecretKind.create("")).toThrow(InvalidInputError);
    expect(() =>
      SecretKind.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
    expect(() => SecretKind.create("unknown_kind")).toThrow(InvalidInputError);
    expect(() => SecretKind.create("    ")).toThrow(InvalidInputError);
  });

  it("isKindValue type guard", () => {
    expect(SecretKind.isKindValue("api_key")).toBe(true);
    expect(SecretKind.isKindValue("zzz")).toBe(false);
  });

  it("isHardReject() — every kind except high_entropy_blob", () => {
    expect(SecretKind.apiKey().isHardReject()).toBe(true);
    expect(SecretKind.oauthToken().isHardReject()).toBe(true);
    expect(SecretKind.privateKey().isHardReject()).toBe(true);
    expect(SecretKind.password().isHardReject()).toBe(true);
    expect(SecretKind.credential().isHardReject()).toBe(true);
    expect(SecretKind.highEntropyBlob().isHardReject()).toBe(false);
  });

  it("equals", () => {
    expect(SecretKind.apiKey().equals(SecretKind.apiKey())).toBe(true);
    expect(SecretKind.apiKey().equals(SecretKind.oauthToken())).toBe(false);
  });
});

describe("SecretActions", () => {
  it("constructors return expected kinds", () => {
    expect(SecretActions.blocked().kind).toBe("blocked");
    expect(SecretActions.redacted().kind).toBe("redacted");
    expect(SecretActions.warnedUser().kind).toBe("warned_user");
  });

  it("fromKind accepts valid", () => {
    expect(SecretActions.fromKind("blocked").kind).toBe("blocked");
    expect(SecretActions.fromKind(" blocked ").kind).toBe("blocked");
    expect(SecretActions.fromKind("redacted").kind).toBe("redacted");
    expect(SecretActions.fromKind("warned_user").kind).toBe("warned_user");
  });

  it("fromKind rejects unknown / non-string", () => {
    expect(() => SecretActions.fromKind("something_else")).toThrow(
      InvalidInputError,
    );
    expect(() =>
      SecretActions.fromKind(1 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("isKind type guard", () => {
    expect(SecretActions.isKind("blocked")).toBe(true);
    expect(SecretActions.isKind("xyz")).toBe(false);
  });

  it("equals", () => {
    expect(SecretActions.equals(SecretActions.blocked(), SecretActions.blocked())).toBe(
      true,
    );
    expect(
      SecretActions.equals(SecretActions.blocked(), SecretActions.redacted()),
    ).toBe(false);
  });
});

describe("SecretSources", () => {
  it("text() builds a text source", () => {
    const s = SecretSources.text("rationale");
    expect(s.kind).toBe("text");
    if (s.kind === "text") expect(s.field).toBe("rationale");
  });

  it("text() trims & rejects empty / huge", () => {
    expect(SecretSources.text("  field  ")).toEqual({
      kind: "text",
      field: "field",
    });
    expect(() => SecretSources.text("")).toThrow(InvalidInputError);
    expect(() => SecretSources.text("   ")).toThrow(InvalidInputError);
    expect(() => SecretSources.text("a".repeat(201))).toThrow(InvalidInputError);
    expect(() =>
      SecretSources.text(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("filePath() builds & validates", () => {
    expect(SecretSources.filePath("/foo/bar")).toEqual({
      kind: "filePath",
      path: "/foo/bar",
    });
    expect(() => SecretSources.filePath("")).toThrow(InvalidInputError);
    expect(() => SecretSources.filePath("a".repeat(4097))).toThrow(
      InvalidInputError,
    );
    expect(() =>
      SecretSources.filePath(123 as unknown as string),
    ).toThrow(InvalidInputError);
    expect(() => SecretSources.filePath("foo\0bar")).toThrow(InvalidInputError);
  });

  it("logLine() builds & validates", () => {
    expect(SecretSources.logLine(42)).toEqual({ kind: "logLine", line: 42 });
    expect(() => SecretSources.logLine(0)).toThrow(InvalidInputError);
    expect(() => SecretSources.logLine(-1)).toThrow(InvalidInputError);
    expect(() => SecretSources.logLine(1.5)).toThrow(InvalidInputError);
    expect(() => SecretSources.logLine(NaN)).toThrow(InvalidInputError);
    expect(() => SecretSources.logLine(Infinity)).toThrow(InvalidInputError);
  });

  it("isKind", () => {
    expect(SecretSources.isKind("text")).toBe(true);
    expect(SecretSources.isKind("xyz")).toBe(false);
  });

  it("equals across variants", () => {
    expect(
      SecretSources.equals(
        SecretSources.text("a"),
        SecretSources.text("a"),
      ),
    ).toBe(true);
    expect(
      SecretSources.equals(
        SecretSources.text("a"),
        SecretSources.text("b"),
      ),
    ).toBe(false);
    expect(
      SecretSources.equals(
        SecretSources.text("a"),
        SecretSources.filePath("/a"),
      ),
    ).toBe(false);
    expect(
      SecretSources.equals(
        SecretSources.filePath("/a"),
        SecretSources.filePath("/a"),
      ),
    ).toBe(true);
    expect(
      SecretSources.equals(
        SecretSources.filePath("/a"),
        SecretSources.filePath("/b"),
      ),
    ).toBe(false);
    expect(
      SecretSources.equals(
        SecretSources.logLine(1),
        SecretSources.logLine(1),
      ),
    ).toBe(true);
    expect(
      SecretSources.equals(
        SecretSources.logLine(1),
        SecretSources.logLine(2),
      ),
    ).toBe(false);
  });
});

describe("DetectorName", () => {
  it("from() accepts canonical names", () => {
    expect(DetectorName.from("regex.aws_key").toString()).toBe("regex.aws_key");
    expect(DetectorName.from("entropy").toString()).toBe("entropy");
    expect(DetectorName.from("regex.foo-bar").toString()).toBe("regex.foo-bar");
  });

  it("rejects names not matching pattern", () => {
    expect(() => DetectorName.from("123abc")).toThrow(InvalidInputError);
    expect(() => DetectorName.from("foo bar")).toThrow(InvalidInputError);
    expect(() => DetectorName.from("foo/bar")).toThrow(InvalidInputError);
    expect(() => DetectorName.from("")).toThrow(InvalidInputError);
  });

  it("rejects too long", () => {
    expect(() => DetectorName.from("a" + "x".repeat(100))).toThrow(
      InvalidInputError,
    );
  });
});

describe("SecretMatch", () => {
  it("create with valid range", () => {
    const m = SecretMatch.create({
      start: 10,
      end: 20,
      evidence: "[REDACTED:10]",
    });
    expect(m.start).toBe(10);
    expect(m.end).toBe(20);
    expect(m.length).toBe(10);
  });

  it("rejects negative start / non-integer / non-finite", () => {
    expect(() =>
      SecretMatch.create({ start: -1, end: 1, evidence: "x" }),
    ).toThrow(InvalidInputError);
    expect(() =>
      SecretMatch.create({ start: 1.5, end: 5, evidence: "x" }),
    ).toThrow(InvalidInputError);
    expect(() =>
      SecretMatch.create({ start: NaN, end: 5, evidence: "x" }),
    ).toThrow(InvalidInputError);
  });

  it("rejects end <= start", () => {
    expect(() =>
      SecretMatch.create({ start: 5, end: 5, evidence: "x" }),
    ).toThrow(InvalidInputError);
    expect(() =>
      SecretMatch.create({ start: 5, end: 3, evidence: "x" }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-finite end", () => {
    expect(() =>
      SecretMatch.create({ start: 0, end: Infinity, evidence: "x" }),
    ).toThrow(InvalidInputError);
    expect(() =>
      SecretMatch.create({ start: 0, end: 5.5, evidence: "x" }),
    ).toThrow(InvalidInputError);
  });

  it("rejects empty / non-string / overlong evidence", () => {
    expect(() =>
      SecretMatch.create({ start: 0, end: 1, evidence: "" }),
    ).toThrow(InvalidInputError);
    expect(() =>
      SecretMatch.create({
        start: 0,
        end: 1,
        evidence: 123 as unknown as string,
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      SecretMatch.create({ start: 0, end: 1, evidence: "x".repeat(121) }),
    ).toThrow(InvalidInputError);
  });

  it("equals", () => {
    const a = SecretMatch.create({ start: 0, end: 5, evidence: "x" });
    const b = SecretMatch.create({ start: 0, end: 5, evidence: "x" });
    const c = SecretMatch.create({ start: 0, end: 5, evidence: "y" });
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});

describe("SanitizedText", () => {
  it("clean() yields no findings", () => {
    const t = SanitizedText.clean("hello world");
    expect(t.hasFindings()).toBe(false);
    expect(t.findingCount()).toBe(0);
    expect(t.original).toBe("hello world");
    expect(t.sanitized).toBe("hello world");
  });

  it("create rejects mismatched fields when no findings", () => {
    expect(() =>
      SanitizedText.create({
        original: "a",
        sanitized: "b",
        findings: [],
      }),
    ).toThrow(InvalidInputError);
  });

  it("create rejects non-string fields", () => {
    expect(() =>
      SanitizedText.create({
        original: 1 as unknown as string,
        sanitized: "x",
        findings: [],
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      SanitizedText.create({
        original: "x",
        sanitized: 1 as unknown as string,
        findings: [],
      }),
    ).toThrow(InvalidInputError);
  });

  it("equals across instances", () => {
    const a = SanitizedText.clean("foo");
    const b = SanitizedText.clean("foo");
    const c = SanitizedText.clean("bar");
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("equals returns false when sanitized differs", () => {
    const finding = SecretFinding.create({
      kind: SecretKind.apiKey(),
      position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
      confidence: Confidence.full(),
      source: SecretSources.text("rationale"),
      detectedBy: DetectorName.from("regex.test"),
    });
    const a = SanitizedText.create({
      original: "AKIA1234567890",
      sanitized: "[REDACTED]567890",
      findings: [finding],
    });
    const b = SanitizedText.create({
      original: "AKIA1234567890",
      sanitized: "[REDACTED]567890",
      findings: [finding],
    });
    expect(a.equals(b)).toBe(true);
  });
});

describe("EntropyThreshold", () => {
  it("defaultThreshold is 4.5", () => {
    expect(EntropyThreshold.defaultThreshold().toNumber()).toBe(4.5);
  });

  it("of() accepts valid range", () => {
    expect(EntropyThreshold.of(0).toNumber()).toBe(0);
    expect(EntropyThreshold.of(8).toNumber()).toBe(8);
    expect(EntropyThreshold.of(4.5).toNumber()).toBe(4.5);
  });

  it("of() rejects out-of-range / non-finite", () => {
    expect(() => EntropyThreshold.of(-1)).toThrow(InvalidInputError);
    expect(() => EntropyThreshold.of(9)).toThrow(InvalidInputError);
    expect(() => EntropyThreshold.of(NaN)).toThrow(InvalidInputError);
    expect(() => EntropyThreshold.of(Infinity)).toThrow(InvalidInputError);
  });

  it("isHighEntropy: enforces minimum length", () => {
    const t = EntropyThreshold.defaultThreshold();
    expect(t.isHighEntropy("short", 8)).toBe(false);
    expect(t.minimumLength()).toBe(20);
  });

  it("isHighEntropy: returns true above threshold and long enough", () => {
    const t = EntropyThreshold.of(4.5);
    expect(t.isHighEntropy("a".repeat(20), 5)).toBe(true);
  });

  it("isHighEntropy: returns false at or below threshold", () => {
    const t = EntropyThreshold.of(4.5);
    expect(t.isHighEntropy("a".repeat(20), 4.5)).toBe(false);
    expect(t.isHighEntropy("a".repeat(20), 4.4)).toBe(false);
  });

  it("isHighEntropy: rejects negative entropy", () => {
    const t = EntropyThreshold.of(4.5);
    expect(() => t.isHighEntropy("a".repeat(20), -0.1)).toThrow(
      InvalidInputError,
    );
  });

  it("isHighEntropy: rejects non-finite entropy", () => {
    const t = EntropyThreshold.of(4.5);
    expect(() => t.isHighEntropy("a".repeat(20), NaN)).toThrow(
      InvalidInputError,
    );
  });

  it("isHighEntropy: returns false for non-string input", () => {
    const t = EntropyThreshold.of(4.5);
    expect(t.isHighEntropy(123 as unknown as string, 5)).toBe(false);
  });

  it("equals", () => {
    expect(
      EntropyThreshold.of(4.5).equals(EntropyThreshold.of(4.5)),
    ).toBe(true);
    expect(EntropyThreshold.of(4.5).equals(EntropyThreshold.of(5))).toBe(false);
  });
});

describe("SecretPattern", () => {
  it("create() builds valid pattern", () => {
    const p = SecretPattern.create({
      name: DetectorName.from("regex.test"),
      kind: SecretKind.apiKey(),
      source: "AKIA[A-Z0-9]{16}",
    });
    expect(p.name.toString()).toBe("regex.test");
    expect(p.kind.toString()).toBe("api_key");
  });

  it("rejects empty / non-string source", () => {
    expect(() =>
      SecretPattern.create({
        name: DetectorName.from("regex.test"),
        kind: SecretKind.apiKey(),
        source: "",
      }),
    ).toThrow(InvalidPatternError);
    expect(() =>
      SecretPattern.create({
        name: DetectorName.from("regex.test"),
        kind: SecretKind.apiKey(),
        source: 1 as unknown as string,
      }),
    ).toThrow(InvalidPatternError);
  });

  it("rejects oversized source", () => {
    expect(() =>
      SecretPattern.create({
        name: DetectorName.from("regex.test"),
        kind: SecretKind.apiKey(),
        source: "a".repeat(4097),
      }),
    ).toThrow(InvalidPatternError);
  });

  it("rejects unparseable regex", () => {
    expect(() =>
      SecretPattern.create({
        name: DetectorName.from("regex.test"),
        kind: SecretKind.apiKey(),
        source: "[invalid",
      }),
    ).toThrow(InvalidPatternError);
  });

  it("matches() returns matches with redacted evidence", () => {
    const p = SecretPattern.create({
      name: DetectorName.from("regex.test"),
      kind: SecretKind.apiKey(),
      source: "AKIA[A-Z0-9]{16}",
    });
    const matches = p.matches("aws_key=AKIAABCDEFGHIJKLMNOP");
    expect(matches.length).toBe(1);
    expect(matches[0]?.evidence).toBe("[REDACTED:20]");
  });

  it("matches() returns empty for non-string / empty input", () => {
    const p = SecretPattern.create({
      name: DetectorName.from("regex.test"),
      kind: SecretKind.apiKey(),
      source: "AKIA[A-Z0-9]{16}",
    });
    expect(p.matches("").length).toBe(0);
    expect(p.matches(123 as unknown as string).length).toBe(0);
  });

  it("matches() handles multiple matches", () => {
    const p = SecretPattern.create({
      name: DetectorName.from("regex.test"),
      kind: SecretKind.apiKey(),
      source: "AKIA[A-Z0-9]{16}",
    });
    const matches = p.matches(
      "AKIAABCDEFGHIJKLMNOP and AKIAZZZZZZZZZZZZZZZZ here",
    );
    expect(matches.length).toBe(2);
  });

  it("matches() returns empty when pattern doesn't match", () => {
    const p = SecretPattern.create({
      name: DetectorName.from("regex.test"),
      kind: SecretKind.apiKey(),
      source: "AKIA[A-Z0-9]{16}",
    });
    expect(p.matches("nothing here").length).toBe(0);
  });

  it("equals based on name", () => {
    const a = SecretPattern.create({
      name: DetectorName.from("regex.test"),
      kind: SecretKind.apiKey(),
      source: "x",
    });
    const b = SecretPattern.create({
      name: DetectorName.from("regex.test"),
      kind: SecretKind.oauthToken(),
      source: "y",
    });
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
  });
});

describe("SecretFinding", () => {
  const make = (): SecretFinding =>
    SecretFinding.create({
      kind: SecretKind.apiKey(),
      position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
      confidence: Confidence.full(),
      source: SecretSources.text("rationale"),
      detectedBy: DetectorName.from("regex.test"),
    });

  it("create() builds complete finding", () => {
    const f = make();
    expect(f.kind.kind).toBe("api_key");
    expect(f.detectedBy.toString()).toBe("regex.test");
  });

  it("equals", () => {
    const a = make();
    const b = make();
    expect(a.equals(a)).toBe(true);
    expect(a.equals(b)).toBe(true);
  });

  it("equals returns false when kind/position/confidence/source/detector differs", () => {
    const a = make();
    const b = SecretFinding.create({
      kind: SecretKind.oauthToken(),
      position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
      confidence: Confidence.full(),
      source: SecretSources.text("rationale"),
      detectedBy: DetectorName.from("regex.test"),
    });
    expect(a.equals(b)).toBe(false);

    const diffPos = SecretFinding.create({
      kind: SecretKind.apiKey(),
      position: SecretMatch.create({ start: 1, end: 5, evidence: "[R:4]" }),
      confidence: Confidence.full(),
      source: SecretSources.text("rationale"),
      detectedBy: DetectorName.from("regex.test"),
    });
    expect(a.equals(diffPos)).toBe(false);

    const diffSource = SecretFinding.create({
      kind: SecretKind.apiKey(),
      position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
      confidence: Confidence.full(),
      source: SecretSources.text("other"),
      detectedBy: DetectorName.from("regex.test"),
    });
    expect(a.equals(diffSource)).toBe(false);

    const diffDetector = SecretFinding.create({
      kind: SecretKind.apiKey(),
      position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
      confidence: Confidence.full(),
      source: SecretSources.text("rationale"),
      detectedBy: DetectorName.from("regex.other"),
    });
    expect(a.equals(diffDetector)).toBe(false);

    const diffConfidence = SecretFinding.create({
      kind: SecretKind.apiKey(),
      position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
      confidence: Confidence.of(0.5),
      source: SecretSources.text("rationale"),
      detectedBy: DetectorName.from("regex.test"),
    });
    expect(a.equals(diffConfidence)).toBe(false);
  });
});
