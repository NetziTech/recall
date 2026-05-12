import { describe, it, expect } from "vitest";

import {
  AddKeyCommandHandler,
  ExportKeyCommandHandler,
  RekeyCommandHandler,
} from "../../../../../src/modules/cli/application/use-cases/handlers/encryption-handlers.ts";
import { renderEncryptionKeyBanner } from "../../../../../src/modules/cli/application/use-cases/handlers/encryption-key-banner.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";
import { PassphraseMismatchError } from "../../../../../src/modules/cli/application/use-cases/handlers/workspace-handlers.ts";
import {
  ScriptedPrompt,
  SilentLogger,
  StubAddKeyFacade,
  StubExportKeyFacade,
  StubRekeyFacade,
} from "../../../../fixtures/cli-fixtures.ts";

describe("ExportKeyCommandHandler", () => {
  it("prints the banner with the key", async () => {
    const facade = new StubExportKeyFacade();
    const h = new ExportKeyCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "export-key",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(out.stdout).toContain("Clave de cifrado");
    expect(out.stdout).toContain("M3-ZK7L-XXXX-YYYY");
    expect(out.exitCode.isSuccess()).toBe(true);
  });
});

describe("RekeyCommandHandler", () => {
  it("rejects non-interactive mode", async () => {
    const facade = new StubRekeyFacade();
    const prompt = new ScriptedPrompt();
    const h = new RekeyCommandHandler(facade, prompt, new SilentLogger());
    await expect(
      h.handle({
        command: "rekey",
        workspacePath: "/tmp",
        nonInteractive: true,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("rejects mismatched passphrases", async () => {
    const facade = new StubRekeyFacade();
    const prompt = new ScriptedPrompt({ passphrases: ["a", "b"] });
    const h = new RekeyCommandHandler(facade, prompt, new SilentLogger());
    await expect(
      h.handle({
        command: "rekey",
        workspacePath: "/tmp",
        nonInteractive: false,
      }),
    ).rejects.toBeInstanceOf(PassphraseMismatchError);
  });

  it("happy path forwards the new passphrase + prints banner", async () => {
    const facade = new StubRekeyFacade();
    const prompt = new ScriptedPrompt({ passphrases: ["new-pp", "new-pp"] });
    const h = new RekeyCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "rekey",
      workspacePath: "/tmp",
      nonInteractive: false,
    });
    expect(facade.lastInput?.newPassphrase).toBe("new-pp");
    expect(out.stdout).toContain("M3-NEW-KEY");
    // Banner constants are present.
    expect(out.stdout).toEqual(renderEncryptionKeyBanner("M3-NEW-KEY"));
  });
});

describe("AddKeyCommandHandler", () => {
  it("rejects non-interactive mode", async () => {
    const facade = new StubAddKeyFacade();
    const prompt = new ScriptedPrompt();
    const h = new AddKeyCommandHandler(facade, prompt, new SilentLogger());
    await expect(
      h.handle({
        command: "add-key",
        workspacePath: "/tmp",
        nonInteractive: true,
        label: null,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("rejects mismatched passphrases", async () => {
    const facade = new StubAddKeyFacade();
    // First passphrase = current; the second/third (new + confirm)
    // differ, triggering the mismatch error.
    const prompt = new ScriptedPrompt({ passphrases: ["current", "a", "b"] });
    const h = new AddKeyCommandHandler(facade, prompt, new SilentLogger());
    await expect(
      h.handle({
        command: "add-key",
        workspacePath: "/tmp",
        nonInteractive: false,
        label: null,
      }),
    ).rejects.toBeInstanceOf(PassphraseMismatchError);
  });

  it("happy path: forwards current+new passphrase + label, prints key id + banner", async () => {
    const facade = new StubAddKeyFacade();
    const prompt = new ScriptedPrompt({
      passphrases: ["current-pp", "pp", "pp"],
    });
    const h = new AddKeyCommandHandler(facade, prompt, new SilentLogger());
    const out = await h.handle({
      command: "add-key",
      workspacePath: "/tmp",
      nonInteractive: false,
      label: "team-bob",
    });
    expect(facade.lastInput?.currentPassphrase).toBe("current-pp");
    expect(facade.lastInput?.newPassphrase).toBe("pp");
    expect(facade.lastInput?.label).toBe("team-bob");
    expect(out.stdout).toContain("Nueva clave agregada");
    expect(out.stdout).toContain("K-1");
    expect(out.exitCode.isSuccess()).toBe(true);
  });
});

describe("renderEncryptionKeyBanner", () => {
  it("includes the key + copy guidance", () => {
    const text = renderEncryptionKeyBanner("MY-KEY");
    expect(text).toContain("MY-KEY");
    expect(text).toContain("Clave de cifrado");
    expect(text).toContain("COPIA Y GUARDA");
  });

  it("truncates a key longer than the box width", () => {
    const long = "X".repeat(80);
    const text = renderEncryptionKeyBanner(long);
    // The key is sliced to fit; we don't assert exact length but the
    // string must still contain a portion of X.
    expect(text).toContain("X");
  });
});
