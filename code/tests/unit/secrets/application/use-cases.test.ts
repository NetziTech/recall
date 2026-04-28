import { describe, it, expect } from "vitest";
import { ScanTextUseCase } from "../../../../src/modules/secrets/application/use-cases/scan-text.use-case.ts";
import { SanitizePathUseCase } from "../../../../src/modules/secrets/application/use-cases/sanitize-path.use-case.ts";
import { RecordSecretEventUseCase } from "../../../../src/modules/secrets/application/use-cases/record-secret-event.use-case.ts";
import { InstallPreCommitHookUseCase } from "../../../../src/modules/secrets/application/use-cases/install-pre-commit-hook.use-case.ts";
import { SanitizedText } from "../../../../src/modules/secrets/domain/value-objects/sanitized-text.ts";
import { SanitizedPath } from "../../../../src/modules/secrets/domain/value-objects/sanitized-path.ts";
import { SecretFinding } from "../../../../src/modules/secrets/domain/value-objects/secret-finding.ts";
import { SecretMatch } from "../../../../src/modules/secrets/domain/value-objects/secret-match.ts";
import { SecretKind } from "../../../../src/modules/secrets/domain/value-objects/secret-kind.ts";
import { SecretActions } from "../../../../src/modules/secrets/domain/value-objects/secret-action.ts";
import { SecretSources } from "../../../../src/modules/secrets/domain/value-objects/secret-source.ts";
import { DetectorName } from "../../../../src/modules/secrets/domain/value-objects/detector-name.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { ok, err, isOk, isErr } from "../../../../src/shared/domain/types/result.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { RecordingLogger } from "../../../_fixtures/silent-logger.ts";
import { PathSanitizerError } from "../../../../src/modules/secrets/domain/errors/path-sanitizer-error.ts";
import type { SecretsScanner } from "../../../../src/modules/secrets/domain/services/secrets-scanner.ts";
import type { SecretAuditRepository } from "../../../../src/modules/secrets/domain/repositories/secret-audit-repository.ts";
import type { SecretAuditEntry } from "../../../../src/modules/secrets/domain/aggregates/secret-audit-entry.ts";
import type {
  PreCommitHookInstaller,
  PreCommitHookInstallReceipt,
} from "../../../../src/modules/secrets/application/ports/out/pre-commit-hook-installer.port.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";

const cleanScanner: SecretsScanner = {
  scan: async (text) => Promise.resolve(SanitizedText.clean(text)),
  scanPath: () => ok(SanitizedPath.create("foo/bar")),
};

const findingScanner: SecretsScanner = {
  scan: async (text) => {
    const finding = SecretFinding.create({
      kind: SecretKind.apiKey(),
      position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
      confidence: Confidence.full(),
      source: SecretSources.text("rationale"),
      detectedBy: DetectorName.from("regex.test"),
    });
    return Promise.resolve(
      SanitizedText.create({
        original: text,
        sanitized: `[REDACTED]${text.slice(4)}`,
        findings: [finding],
      }),
    );
  },
  scanPath: () => err(new PathSanitizerError({ kind: "path-traversal", rawPath: ".." })),
};

describe("ScanTextUseCase", () => {
  it("returns clean SanitizedText when scanner finds nothing", async () => {
    const logger = new RecordingLogger();
    const useCase = new ScanTextUseCase(cleanScanner, logger);
    const result = await useCase.scan({
      text: "nothing",
      workspaceId: WorkspaceId.from(WS_ID),
    });
    expect(result.hasFindings()).toBe(false);
    const debug = logger.entries.find((e) => e.level === "debug");
    expect(debug?.message).toBe("secrets scan clean");
  });

  it("logs warn when findings present", async () => {
    const logger = new RecordingLogger();
    const useCase = new ScanTextUseCase(findingScanner, logger);
    await useCase.scan({
      text: "AKIAFOO",
      workspaceId: WorkspaceId.from(WS_ID),
    });
    const warn = logger.entries.find((e) => e.level === "warn");
    expect(warn?.message).toBe("secrets scan produced findings");
  });
});

describe("SanitizePathUseCase", () => {
  it("returns Ok on valid path", () => {
    const useCase = new SanitizePathUseCase(cleanScanner);
    const result = useCase.sanitize("foo/bar");
    expect(isOk(result)).toBe(true);
  });

  it("forwards Err from scanner", () => {
    const useCase = new SanitizePathUseCase(findingScanner);
    const result = useCase.sanitize("../bad");
    expect(isErr(result)).toBe(true);
  });
});

describe("RecordSecretEventUseCase", () => {
  it("records and persists an audit entry", async () => {
    const saved: SecretAuditEntry[] = [];
    const repo: SecretAuditRepository = {
      findById: async () => Promise.resolve(null),
      findByWorkspace: async () => Promise.resolve([]),
      save: async (entry) => {
        saved.push(entry);
      },
    };
    const useCase = new RecordSecretEventUseCase(
      repo,
      new FakeIdGenerator(),
      new FakeClock({ initialMs: 1_700_000_000_000 }),
      new RecordingLogger(),
    );
    const finding = SecretFinding.create({
      kind: SecretKind.apiKey(),
      position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
      confidence: Confidence.full(),
      source: SecretSources.text("rationale"),
      detectedBy: DetectorName.from("regex.test"),
    });
    const entry = await useCase.record({
      workspaceId: WorkspaceId.from(WS_ID),
      finding,
      action: SecretActions.blocked(),
    });
    expect(saved.length).toBe(1);
    expect(saved[0]).toBe(entry);
    expect(entry.getAction().kind).toBe("blocked");
  });

  it("logs at info level with workspace id and finding kind", async () => {
    const repo: SecretAuditRepository = {
      findById: async () => Promise.resolve(null),
      findByWorkspace: async () => Promise.resolve([]),
      save: async () => {},
    };
    const logger = new RecordingLogger();
    const useCase = new RecordSecretEventUseCase(
      repo,
      new FakeIdGenerator(),
      new FakeClock({ initialMs: 1 }),
      logger,
    );
    const finding = SecretFinding.create({
      kind: SecretKind.privateKey(),
      position: SecretMatch.create({ start: 0, end: 4, evidence: "[R:4]" }),
      confidence: Confidence.full(),
      source: SecretSources.text("rationale"),
      detectedBy: DetectorName.from("regex.test"),
    });
    await useCase.record({
      workspaceId: WorkspaceId.from(WS_ID),
      finding,
      action: SecretActions.redacted(),
    });
    const info = logger.entries.find((e) => e.level === "info");
    expect(info?.message).toBe("secret audit entry recorded");
  });
});

describe("InstallPreCommitHookUseCase", () => {
  it("forwards installer Ok and logs at info", async () => {
    const receipt: PreCommitHookInstallReceipt = {
      hookPath: SanitizedPath.create(".git/hooks/pre-commit"),
      status: "installed",
    };
    const installer: PreCommitHookInstaller = {
      install: async () => Promise.resolve(ok(receipt)),
    };
    const logger = new RecordingLogger();
    const useCase = new InstallPreCommitHookUseCase(installer, logger);
    const result = await useCase.install({ workspaceRoot: "/tmp/ws" });
    expect(isOk(result)).toBe(true);
    expect(logger.entries.some((e) => e.message?.includes("installed"))).toBe(
      true,
    );
  });

  it("forwards installer Err and logs at warn", async () => {
    const installer: PreCommitHookInstaller = {
      install: async () =>
        Promise.resolve(
          err(new PathSanitizerError({ kind: "path-traversal", rawPath: ".." })),
        ),
    };
    const logger = new RecordingLogger();
    const useCase = new InstallPreCommitHookUseCase(installer, logger);
    const result = await useCase.install({ workspaceRoot: "/tmp/ws" });
    expect(isErr(result)).toBe(true);
    expect(logger.entries.some((e) => e.level === "warn")).toBe(true);
  });
});
