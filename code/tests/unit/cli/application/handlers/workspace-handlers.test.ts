import { describe, it, expect } from "vitest";
import * as path from "node:path";

import {
  ForgetKeyCommandHandler,
  HealthCommandHandler,
  InitCommandHandler,
  ModeCommandHandler,
  PassphraseMismatchError,
  UnlockCommandHandler,
} from "../../../../../src/modules/cli/application/use-cases/handlers/workspace-handlers.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";
import {
  ScriptedPrompt,
  SilentLogger,
  StubChangeModeFacade,
  StubHealthCheckFacade,
  StubInitializeWorkspaceFacade,
  StubLockWorkspaceFacade,
  StubUnlockWorkspaceFacade,
} from "../../../../fixtures/cli-fixtures.ts";

describe("InitCommandHandler", () => {
  it("non-interactive shared init: defaults applied + facade called", async () => {
    const facade = new StubInitializeWorkspaceFacade();
    const prompt = new ScriptedPrompt();
    const h = new InitCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "init",
      workspacePath: "/tmp/ws",
      nonInteractive: true,
      mode: null,
      displayName: null,
    });
    expect(out.exitCode.isSuccess()).toBe(true);
    expect(facade.lastInput?.mode).toBe("shared");
    expect(facade.lastInput?.displayName).toBe("Workspace");
    expect(out.stdout).toContain("Workspace inicializado en modo \"shared\"");
  });

  it("interactive shared init prompts for mode + name", async () => {
    const facade = new StubInitializeWorkspaceFacade();
    const prompt = new ScriptedPrompt({ lines: ["private", "Cool Project"] });
    const h = new InitCommandHandler(facade, prompt, new SilentLogger());
    facade.output = {
      workspaceId: "00000000-0000-7000-8000-000000000001",
      mode: "private",
      wasCreated: true,
    };
    const out = await h.handle({
      command: "init",
      workspacePath: null,
      nonInteractive: false,
      mode: null,
      displayName: null,
    });
    expect(out.isSuccess()).toBe(true);
    expect(facade.lastInput?.mode).toBe("private");
    expect(facade.lastInput?.displayName).toBe("Cool Project");
  });

  it("interactive prompts default to shared / 'Workspace' on empty answers", async () => {
    const facade = new StubInitializeWorkspaceFacade();
    const prompt = new ScriptedPrompt({ lines: ["weird", "  "] });
    const h = new InitCommandHandler(facade, prompt, new SilentLogger());
    await h.handle({
      command: "init",
      workspacePath: null,
      nonInteractive: false,
      mode: null,
      displayName: null,
    });
    expect(facade.lastInput?.mode).toBe("shared");
    expect(facade.lastInput?.displayName).toBe("Workspace");
  });

  it("encrypted init in non-interactive mode without passphrase → invariant", async () => {
    const facade = new StubInitializeWorkspaceFacade();
    const prompt = new ScriptedPrompt();
    const h = new InitCommandHandler(facade, prompt, new SilentLogger());
    await expect(
      h.handle({
        command: "init",
        workspacePath: "/tmp/ws",
        nonInteractive: true,
        mode: "encrypted",
        displayName: "X",
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("encrypted init prompts twice and rejects mismatched passphrases", async () => {
    const facade = new StubInitializeWorkspaceFacade();
    const prompt = new ScriptedPrompt({ passphrases: ["one", "two"] });
    const h = new InitCommandHandler(facade, prompt, new SilentLogger());
    await expect(
      h.handle({
        command: "init",
        workspacePath: "/tmp/ws",
        nonInteractive: false,
        mode: "encrypted",
        displayName: "X",
      }),
    ).rejects.toBeInstanceOf(PassphraseMismatchError);
  });

  it("encrypted init forwards the matched passphrase", async () => {
    const facade = new StubInitializeWorkspaceFacade();
    const prompt = new ScriptedPrompt({ passphrases: ["pp", "pp"] });
    const h = new InitCommandHandler(facade, prompt, new SilentLogger());
    await h.handle({
      command: "init",
      workspacePath: "/tmp/ws",
      nonInteractive: false,
      mode: "encrypted",
      displayName: "X",
    });
    expect(facade.lastInput?.passphrase).toBe("pp");
  });

  it("idempotent rehydrate path: prints 'ya existia'", async () => {
    const facade = new StubInitializeWorkspaceFacade();
    facade.output = {
      workspaceId: "00000000-0000-7000-8000-000000000001",
      mode: "shared",
      wasCreated: false,
    };
    const prompt = new ScriptedPrompt();
    const h = new InitCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "init",
      workspacePath: "/tmp/ws",
      nonInteractive: true,
      mode: "shared",
      displayName: "X",
    });
    expect(out.stdout).toContain("Workspace ya existia");
  });

  it("rootPath defaults to cwd when --workspace omitted", async () => {
    const facade = new StubInitializeWorkspaceFacade();
    const prompt = new ScriptedPrompt();
    const h = new InitCommandHandler(facade, prompt, new SilentLogger());
    await h.handle({
      command: "init",
      workspacePath: null,
      nonInteractive: true,
      mode: "shared",
      displayName: "X",
    });
    expect(facade.lastInput?.rootPath).toBe(path.resolve(process.cwd()));
  });
});

describe("ModeCommandHandler", () => {
  it("non-interactive: encrypted-target without passphrase → invariant", async () => {
    const facade = new StubChangeModeFacade();
    const prompt = new ScriptedPrompt();
    const h = new ModeCommandHandler(facade, prompt, new SilentLogger());
    await expect(
      h.handle({
        command: "mode",
        workspacePath: "/tmp",
        nonInteractive: true,
        newMode: "encrypted",
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("interactive shared->encrypted prompts twice + forwards passphrase", async () => {
    const facade = new StubChangeModeFacade();
    facade.output = {
      workspaceId: "00000000-0000-7000-8000-000000000001",
      newMode: "encrypted",
    };
    const prompt = new ScriptedPrompt({ passphrases: ["x", "x"] });
    const h = new ModeCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "mode",
      workspacePath: "/tmp",
      nonInteractive: false,
      newMode: "encrypted",
    });
    expect(facade.lastInput?.passphrase).toBe("x");
    expect(out.stdout).toContain("encrypted");
  });

  it("interactive encrypted-target rejects mismatched passphrases", async () => {
    const facade = new StubChangeModeFacade();
    const prompt = new ScriptedPrompt({ passphrases: ["a", "b"] });
    const h = new ModeCommandHandler(facade, prompt, new SilentLogger());
    await expect(
      h.handle({
        command: "mode",
        workspacePath: "/tmp",
        nonInteractive: false,
        newMode: "encrypted",
      }),
    ).rejects.toBeInstanceOf(PassphraseMismatchError);
  });

  it("non-encrypted target needs no passphrase", async () => {
    const facade = new StubChangeModeFacade();
    const prompt = new ScriptedPrompt();
    const h = new ModeCommandHandler(facade, prompt, new SilentLogger());
    await h.handle({
      command: "mode",
      workspacePath: "/tmp",
      nonInteractive: true,
      newMode: "private",
    });
    expect(facade.lastInput?.passphrase).toBeNull();
  });
});

describe("UnlockCommandHandler", () => {
  it("uses the explicit --passphrase when provided", async () => {
    const facade = new StubUnlockWorkspaceFacade();
    const prompt = new ScriptedPrompt();
    const h = new UnlockCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "unlock",
      workspacePath: "/tmp",
      nonInteractive: false,
      passphrase: "topsecret",
    });
    expect(facade.lastInput?.passphrase).toBe("topsecret");
    expect(out.stdout).toContain("desbloqueado");
  });

  it("prompts when interactive + no passphrase", async () => {
    const facade = new StubUnlockWorkspaceFacade();
    const prompt = new ScriptedPrompt({ passphrases: ["typed-it"] });
    const h = new UnlockCommandHandler(facade, prompt, new SilentLogger());
    await h.handle({
      command: "unlock",
      workspacePath: "/tmp",
      nonInteractive: false,
      passphrase: null,
    });
    expect(facade.lastInput?.passphrase).toBe("typed-it");
  });

  it("non-interactive + null passphrase delegates to facade with null (cache-mode)", async () => {
    const facade = new StubUnlockWorkspaceFacade();
    const prompt = new ScriptedPrompt();
    const h = new UnlockCommandHandler(facade, prompt, new SilentLogger());
    await h.handle({
      command: "unlock",
      workspacePath: "/tmp",
      nonInteractive: true,
      passphrase: null,
    });
    expect(facade.lastInput?.passphrase).toBeNull();
  });

  it("wasUnlocked=false renders the no-op message", async () => {
    const facade = new StubUnlockWorkspaceFacade();
    facade.output = {
      workspaceId: "00000000-0000-7000-8000-000000000001",
      wasUnlocked: false,
      mode: "shared",
    };
    const prompt = new ScriptedPrompt();
    const h = new UnlockCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "unlock",
      workspacePath: "/tmp",
      nonInteractive: true,
      passphrase: null,
    });
    expect(out.stdout).toContain("ya estaba desbloqueado");
  });
});

describe("ForgetKeyCommandHandler", () => {
  it("wasLocked=true: prints reminder", async () => {
    const facade = new StubLockWorkspaceFacade();
    const h = new ForgetKeyCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "forget-key",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(out.stdout).toContain("Clave borrada");
  });

  it("wasLocked=false: prints already-locked", async () => {
    const facade = new StubLockWorkspaceFacade();
    facade.output = {
      workspaceId: "00000000-0000-7000-8000-000000000001",
      wasLocked: false,
    };
    const h = new ForgetKeyCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "forget-key",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(out.stdout).toContain("ya estaba bloqueado");
  });
});

describe("HealthCommandHandler", () => {
  it("renders pass/fail/skip markers", async () => {
    const facade = new StubHealthCheckFacade();
    facade.output = {
      checks: [
        { id: "a", status: "pass", message: "ok" },
        { id: "b", status: "fail", message: "broken" },
        { id: "c", status: "skipped", message: "n/a" },
      ],
      healthy: false,
    };
    const h = new HealthCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "health",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(out.stdout).toContain("[OK] a");
    expect(out.stdout).toContain("[FAIL] b");
    expect(out.stdout).toContain("[SKIP] c");
    expect(out.stdout).toContain("con fallos");
    expect(out.exitCode.toNumber()).toBe(1);
  });

  it("healthy=true returns exit success + 'saludable' message", async () => {
    const facade = new StubHealthCheckFacade();
    facade.output = {
      checks: [{ id: "a", status: "pass", message: "ok" }],
      healthy: true,
    };
    const h = new HealthCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "health",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(out.exitCode.isSuccess()).toBe(true);
    expect(out.stdout).toContain("saludable");
  });
});
