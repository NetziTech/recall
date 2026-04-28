import { describe, it, expect } from "vitest";

import {
  ExportCommandHandler,
  ImportCommandHandler,
  ImportHandoffCommandHandler,
  ServerCommandHandler,
  StatsCommandHandler,
  WipeCommandHandler,
} from "../../../../../src/modules/cli/application/use-cases/handlers/maintenance-handlers.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";
import {
  ScriptedPrompt,
  SilentLogger,
  StubExportFacade,
  StubImportFacade,
  StubImportHandoffFacade,
  StubServerFacade,
  StubStatsFacade,
  StubWipeFacade,
} from "../../../../fixtures/cli-fixtures.ts";

describe("ImportHandoffCommandHandler", () => {
  it("returns success + counts", async () => {
    const facade = new StubImportHandoffFacade();
    const h = new ImportHandoffCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "import-handoff",
      workspacePath: "/tmp",
      nonInteractive: false,
      handoffPath: "/tmp/HANDOFF.md",
    });
    expect(facade.lastInput?.handoffPath).toBe("/tmp/HANDOFF.md");
    expect(out.stdout).toContain("3 decisiones");
    expect(out.stdout).toContain("5 aprendizajes");
  });
});

describe("ExportCommandHandler", () => {
  it("returns the output path + bytes", async () => {
    const facade = new StubExportFacade();
    const h = new ExportCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "export",
      workspacePath: "/tmp",
      nonInteractive: false,
      outputPath: "/tmp/exp.json",
    });
    expect(out.stdout).toContain("/tmp/exp.json");
    expect(out.stdout).toContain("1024");
  });
});

describe("ImportCommandHandler", () => {
  it("returns the imported row count", async () => {
    const facade = new StubImportFacade();
    const h = new ImportCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "import",
      workspacePath: "/tmp",
      nonInteractive: false,
      inputPath: "/tmp/imp.json",
    });
    expect(out.stdout).toContain("99 filas");
  });
});

describe("WipeCommandHandler", () => {
  it("non-interactive without --confirm: usage error, no facade call", async () => {
    const facade = new StubWipeFacade();
    const prompt = new ScriptedPrompt();
    const h = new WipeCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "wipe",
      workspacePath: "/tmp",
      nonInteractive: true,
      confirm: false,
    });
    expect(out.exitCode.toNumber()).toBe(2);
    expect(facade.lastInput).toBeUndefined();
  });

  it("interactive: cancels when user does not type WIPE", async () => {
    const facade = new StubWipeFacade();
    const prompt = new ScriptedPrompt({ lines: ["nope"] });
    const h = new WipeCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "wipe",
      workspacePath: "/tmp",
      nonInteractive: false,
      confirm: false,
    });
    expect(out.exitCode.toNumber()).toBe(2);
    expect(out.stderr).toContain("cancelada");
    expect(facade.lastInput).toBeUndefined();
  });

  it("interactive: typing WIPE confirms", async () => {
    const facade = new StubWipeFacade();
    const prompt = new ScriptedPrompt({ lines: ["WIPE"] });
    const h = new WipeCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "wipe",
      workspacePath: "/tmp",
      nonInteractive: false,
      confirm: false,
    });
    expect(facade.lastInput?.confirmed).toBe(true);
    expect(out.exitCode.isSuccess()).toBe(true);
    expect(out.stdout).toContain("/tmp/.mcp-memoria");
  });

  it("--confirm bypasses prompt", async () => {
    const facade = new StubWipeFacade();
    const prompt = new ScriptedPrompt();
    const h = new WipeCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "wipe",
      workspacePath: "/tmp",
      nonInteractive: true,
      confirm: true,
    });
    expect(facade.lastInput?.confirmed).toBe(true);
    expect(out.exitCode.isSuccess()).toBe(true);
  });
});

describe("StatsCommandHandler", () => {
  it("returns JSON-formatted stats", async () => {
    const facade = new StubStatsFacade();
    const h = new StatsCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "stats",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    const parsed = JSON.parse(out.stdout) as Record<string, number>;
    expect(parsed["decisions"]).toBe(1);
    expect(parsed["embeddingsQueued"]).toBe(7);
  });
});

describe("ServerCommandHandler", () => {
  it("forwards the facade's exit code", async () => {
    const facade = new StubServerFacade();
    facade.exitCode = 7;
    const h = new ServerCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "server",
      workspacePath: "/tmp",
      nonInteractive: true,
    });
    expect(out.exitCode.toNumber()).toBe(7);
  });

  it("wraps a thrown facade into invariant violation", async () => {
    const facade = new StubServerFacade();
    facade.throws = new Error("port in use");
    const h = new ServerCommandHandler(facade, new SilentLogger());
    await expect(
      h.handle({
        command: "server",
        workspacePath: "/tmp",
        nonInteractive: true,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("warns when invoked without --non-interactive (still runs)", async () => {
    const facade = new StubServerFacade();
    const h = new ServerCommandHandler(facade, new SilentLogger());
    await h.handle({
      command: "server",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(facade.callCount).toBe(1);
  });
});
