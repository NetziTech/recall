import { describe, it, expect } from "vitest";

import {
  AuditCommandHandler,
  InstallHookCommandHandler,
  SanitizeCommandHandler,
  UninstallHookCommandHandler,
} from "../../../../../src/modules/cli/application/use-cases/handlers/secrets-handlers.ts";
import {
  SilentLogger,
  StubAuditFacade,
  StubInstallHookFacade,
  StubSanitizeFacade,
  StubUninstallHookFacade,
} from "../../../../fixtures/cli-fixtures.ts";

describe("AuditCommandHandler", () => {
  it("no critical findings: success exit", async () => {
    const facade = new StubAuditFacade();
    facade.output = {
      findings: [
        { id: "1", kind: "decision", severity: "info", summary: "fine" },
      ],
      hasCritical: false,
    };
    const h = new AuditCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "audit",
      workspacePath: "/tmp",
      nonInteractive: false,
      checkSecrets: false,
      strict: false,
    });
    expect(out.exitCode.isSuccess()).toBe(true);
    expect(out.stdout).toContain("[INFO]");
    expect(out.stdout).toContain("Total: 1 hallazgos");
  });

  it("critical without --strict: generic error exit", async () => {
    const facade = new StubAuditFacade();
    facade.output = {
      findings: [
        { id: "1", kind: "decision", severity: "critical", summary: "leak" },
      ],
      hasCritical: true,
    };
    const h = new AuditCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "audit",
      workspacePath: "/tmp",
      nonInteractive: false,
      checkSecrets: true,
      strict: false,
    });
    expect(out.exitCode.toNumber()).toBe(1);
  });

  it("critical with --strict: secretDetected exit (7)", async () => {
    const facade = new StubAuditFacade();
    facade.output = {
      findings: [
        { id: "1", kind: "decision", severity: "critical", summary: "leak" },
      ],
      hasCritical: true,
    };
    const h = new AuditCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "audit",
      workspacePath: "/tmp",
      nonInteractive: false,
      checkSecrets: true,
      strict: true,
    });
    expect(out.exitCode.toNumber()).toBe(7);
  });

  it("forwards rootPath + checkSecrets + strict to facade", async () => {
    const facade = new StubAuditFacade();
    const h = new AuditCommandHandler(facade, new SilentLogger());
    await h.handle({
      command: "audit",
      workspacePath: "/tmp",
      nonInteractive: false,
      checkSecrets: true,
      strict: true,
    });
    expect(facade.lastInput?.checkSecrets).toBe(true);
    expect(facade.lastInput?.strict).toBe(true);
  });
});

describe("SanitizeCommandHandler", () => {
  it("forwards entryId + reports redacted count", async () => {
    const facade = new StubSanitizeFacade();
    const h = new SanitizeCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "sanitize",
      workspacePath: "/tmp",
      nonInteractive: false,
      entryId: "id-1",
    });
    expect(facade.lastInput?.entryId).toBe("id-1");
    expect(out.stdout).toContain("id-1");
    expect(out.stdout).toContain("2 campos");
  });
});

describe("InstallHookCommandHandler", () => {
  it("returns success + path", async () => {
    const facade = new StubInstallHookFacade();
    const h = new InstallHookCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "install-hook",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(out.stdout).toContain("/path/.git/hooks/pre-commit");
  });
});

describe("UninstallHookCommandHandler", () => {
  it("removedAt=null: idempotent message", async () => {
    const facade = new StubUninstallHookFacade();
    const h = new UninstallHookCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "uninstall-hook",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(out.stdout).toContain("No habia hook");
  });

  it("removedAt is set: confirms removal", async () => {
    const facade = new StubUninstallHookFacade();
    facade.output = { removedAt: "/path/.git/hooks/pre-commit" };
    const h = new UninstallHookCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "uninstall-hook",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(out.stdout).toContain("eliminado");
  });
});
