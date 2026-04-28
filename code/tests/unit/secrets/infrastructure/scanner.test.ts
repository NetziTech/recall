import { describe, it, expect } from "vitest";
import { BuiltInPatternRegistry } from "../../../../src/modules/secrets/infrastructure/scanner/built-in-pattern-registry.ts";
import { ShannonEntropyCalculator } from "../../../../src/modules/secrets/infrastructure/scanner/shannon-entropy-calculator.ts";
import { DefaultSecretsScanner } from "../../../../src/modules/secrets/infrastructure/scanner/default-secrets-scanner.ts";
import { EntropyThreshold } from "../../../../src/modules/secrets/domain/value-objects/entropy-threshold.ts";
import { PathSanitizerRule } from "../../../../src/modules/secrets/domain/value-objects/path-sanitizer-rule.ts";
import { DetectorName } from "../../../../src/modules/secrets/domain/value-objects/detector-name.ts";
import { SecretPattern } from "../../../../src/modules/secrets/domain/value-objects/secret-pattern.ts";
import { SecretKind } from "../../../../src/modules/secrets/domain/value-objects/secret-kind.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { isOk, isErr } from "../../../../src/shared/domain/types/result.ts";

const WS_ID = WorkspaceId.from("01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89");

describe("BuiltInPatternRegistry", () => {
  const registry = new BuiltInPatternRegistry();

  it("contains 7 built-in patterns", () => {
    const patterns = registry.getPatterns();
    expect(patterns.length).toBe(7);
  });

  it("each pattern is unique by name", () => {
    const names = new Set(
      registry.getPatterns().map((p) => p.name.toString()),
    );
    expect(names.size).toBe(7);
  });

  it("getPattern returns null for unknown", () => {
    const found = registry.getPattern(DetectorName.from("unknown"));
    expect(found).toBeNull();
  });

  it("getPattern resolves a known detector", () => {
    const found = registry.getPattern(DetectorName.from("regex.aws_access_key"));
    expect(found).not.toBeNull();
    expect(found?.name.toString()).toBe("regex.aws_access_key");
  });

  it("user-supplied extras come after built-ins", () => {
    const extra = SecretPattern.create({
      name: DetectorName.from("regex.custom_key"),
      kind: SecretKind.apiKey(),
      source: "custom_secret_[A-Z0-9]{10}",
    });
    const r = new BuiltInPatternRegistry([extra]);
    const patterns = r.getPatterns();
    expect(patterns.length).toBe(8);
    expect(patterns[7]?.name.toString()).toBe("regex.custom_key");
  });

  it("AWS access-key pattern matches AKIA... format", () => {
    const p = registry.getPattern(DetectorName.from("regex.aws_access_key"));
    expect(p).not.toBeNull();
    if (p !== null) {
      expect(p.matches("AKIAABCDEFGHIJKLMNOP").length).toBeGreaterThan(0);
      expect(p.matches("akialowercase").length).toBe(0);
    }
  });

  it("JWT pattern matches eyJ...eyJ...x format", () => {
    const p = registry.getPattern(DetectorName.from("regex.jwt"));
    expect(p).not.toBeNull();
    if (p !== null) {
      expect(
        p.matches(
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signed",
        ).length,
      ).toBe(1);
    }
  });

  it("GitHub token pattern matches ghp_/ghs_ format", () => {
    const p = registry.getPattern(DetectorName.from("regex.github_token"));
    expect(p).not.toBeNull();
    if (p !== null) {
      expect(
        p.matches("token=ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ").length,
      ).toBe(1);
      expect(p.matches("token=ghp_short").length).toBe(0);
    }
  });

  it("private key pattern matches PEM header", () => {
    const p = registry.getPattern(DetectorName.from("regex.private_key"));
    expect(p).not.toBeNull();
    if (p !== null) {
      expect(p.matches("-----BEGIN RSA PRIVATE KEY-----").length).toBe(1);
      expect(p.matches("-----BEGIN CERTIFICATE-----").length).toBe(0);
    }
  });

  it("password-in-url pattern matches user:pass@host", () => {
    const p = registry.getPattern(DetectorName.from("regex.password_in_url"));
    expect(p).not.toBeNull();
    if (p !== null) {
      expect(p.matches("https://user:secret@db.example.com").length).toBe(1);
    }
  });

  it("generic api key pattern", () => {
    const p = registry.getPattern(DetectorName.from("regex.generic_api_key"));
    expect(p).not.toBeNull();
    if (p !== null) {
      expect(
        p.matches('api_key = "abcdefghijklmnopqrstuvwx"').length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("ShannonEntropyCalculator", () => {
  const calc = new ShannonEntropyCalculator();

  it("returns 0 for empty text", () => {
    expect(calc.calculate("")).toBe(0);
  });

  it("returns 0 for single character", () => {
    expect(calc.calculate("a")).toBe(0);
  });

  it("returns 0 for all-identical characters", () => {
    expect(calc.calculate("aaaaaaa")).toBe(0);
  });

  it("returns 1 for two equally-distributed chars", () => {
    // "ab" is 50/50 → -2*(0.5*log2(0.5)) = 1
    expect(calc.calculate("ab")).toBe(1);
  });

  it("entropy of long random hex is high", () => {
    // Random-ish hex → entropy near 4 bits per char
    const e = calc.calculate("3a8f9c2e7b1d4f6a0e5c8b9d2a7f3e6c1b4d8a9e");
    expect(e).toBeGreaterThan(3);
  });

  it("entropy of natural English is moderate (< 5)", () => {
    const e = calc.calculate(
      "The quick brown fox jumps over the lazy dog while reading docs.",
    );
    expect(e).toBeLessThan(5);
  });

  it("returns 0 for non-string input", () => {
    expect(calc.calculate(123 as unknown as string)).toBe(0);
  });
});

describe("DefaultSecretsScanner", () => {
  const buildScanner = (
    extras: readonly SecretPattern[] = [],
  ): DefaultSecretsScanner =>
    new DefaultSecretsScanner({
      patternRegistry: new BuiltInPatternRegistry(extras),
      entropyCalculator: new ShannonEntropyCalculator(),
      entropyThreshold: EntropyThreshold.defaultThreshold(),
      pathSanitizerRule: PathSanitizerRule.relativeOnly(),
    });

  it("returns clean SanitizedText when no findings", async () => {
    const s = buildScanner();
    const result = await s.scan("nothing to see here", WS_ID);
    expect(result.hasFindings()).toBe(false);
  });

  it("returns clean SanitizedText for empty input", async () => {
    const s = buildScanner();
    const result = await s.scan("", WS_ID);
    expect(result.hasFindings()).toBe(false);
  });

  it("redacts AWS access key in text", async () => {
    const s = buildScanner();
    const result = await s.scan(
      "my key is AKIAABCDEFGHIJKLMNOP yes",
      WS_ID,
    );
    expect(result.hasFindings()).toBe(true);
    expect(result.findingCount()).toBeGreaterThan(0);
    expect(result.sanitized).toContain("[REDACTED:");
    expect(result.sanitized).not.toContain("AKIAABCDEFGHIJKLMNOP");
  });

  it("flags high-entropy long blob", async () => {
    const s = buildScanner();
    // High-entropy blob > 20 chars
    const text = "ZxQ8Vy3Lk7Mn4Op6Qr9Sp2Tw5Ux8Vy3Lk7M";
    const result = await s.scan(text, WS_ID);
    expect(result.hasFindings()).toBe(true);
  });

  it("scanPath uses configured rule", () => {
    const s = buildScanner();
    const result = s.scanPath("../traversal");
    expect(isErr(result)).toBe(true);
  });

  it("scanPath returns Ok for valid relative path", () => {
    const s = buildScanner();
    const result = s.scanPath("src/foo.ts");
    expect(isOk(result)).toBe(true);
  });
});
