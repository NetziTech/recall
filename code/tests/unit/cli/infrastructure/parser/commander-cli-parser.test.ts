import { describe, it, expect } from "vitest";

import { CommanderCliParser } from "../../../../../src/modules/cli/infrastructure/parser/commander-cli-parser.ts";
import { UnknownCommandError } from "../../../../../src/modules/cli/domain/errors/unknown-command-error.ts";
import { InvalidCommandArgsError } from "../../../../../src/modules/cli/domain/errors/invalid-command-args-error.ts";

const p = new CommanderCliParser();

describe("CommanderCliParser — happy paths", () => {
  it("init with --mode + --display-name + --workspace + --non-interactive", () => {
    const r = p.parse([
      "--workspace",
      "/tmp/ws",
      "--non-interactive",
      "init",
      "--mode",
      "encrypted",
      "--display-name",
      "My WS",
    ]);
    expect(r.command).toBe("init");
    if (r.command === "init") {
      expect(r.mode).toBe("encrypted");
      expect(r.displayName).toBe("My WS");
      expect(r.workspacePath).toBe("/tmp/ws");
      expect(r.nonInteractive).toBe(true);
    }
  });

  it("init: defaults when options omitted", () => {
    const r = p.parse(["init"]);
    expect(r.command).toBe("init");
    if (r.command === "init") {
      expect(r.mode).toBeNull();
      expect(r.displayName).toBeNull();
      expect(r.workspacePath).toBeNull();
      expect(r.nonInteractive).toBe(false);
    }
  });

  it("mode <new>", () => {
    const r = p.parse(["mode", "private"]);
    expect(r.command).toBe("mode");
    if (r.command === "mode") expect(r.newMode).toBe("private");
  });

  it("unlock with --passphrase", () => {
    const r = p.parse(["unlock", "--passphrase", "topsecret"]);
    expect(r.command).toBe("unlock");
    if (r.command === "unlock") expect(r.passphrase).toBe("topsecret");
  });

  it("unlock without --passphrase yields null", () => {
    const r = p.parse(["unlock"]);
    expect(r.command).toBe("unlock");
    if (r.command === "unlock") expect(r.passphrase).toBeNull();
  });

  it("simple verbs: forget-key, export-key, rekey, install-hook, uninstall-hook, stats, health, server", () => {
    expect(p.parse(["forget-key"]).command).toBe("forget-key");
    expect(p.parse(["export-key"]).command).toBe("export-key");
    expect(p.parse(["rekey"]).command).toBe("rekey");
    expect(p.parse(["install-hook"]).command).toBe("install-hook");
    expect(p.parse(["uninstall-hook"]).command).toBe("uninstall-hook");
    expect(p.parse(["stats"]).command).toBe("stats");
    expect(p.parse(["health"]).command).toBe("health");
    expect(p.parse(["server"]).command).toBe("server");
  });

  it("add-key with --label", () => {
    const r = p.parse(["add-key", "--label", "team-a"]);
    expect(r.command).toBe("add-key");
    if (r.command === "add-key") expect(r.label).toBe("team-a");
  });

  it("add-key without --label yields null", () => {
    const r = p.parse(["add-key"]);
    expect(r.command).toBe("add-key");
    if (r.command === "add-key") expect(r.label).toBeNull();
  });

  it("audit with flags", () => {
    const r = p.parse(["audit", "--check-secrets", "--strict"]);
    expect(r.command).toBe("audit");
    if (r.command === "audit") {
      expect(r.checkSecrets).toBe(true);
      expect(r.strict).toBe(true);
    }
  });

  it("audit defaults", () => {
    const r = p.parse(["audit"]);
    expect(r.command).toBe("audit");
    if (r.command === "audit") {
      expect(r.checkSecrets).toBe(false);
      expect(r.strict).toBe(false);
    }
  });

  it("sanitize requires --entry-id", () => {
    const r = p.parse(["sanitize", "--entry-id", "id-1"]);
    expect(r.command).toBe("sanitize");
    if (r.command === "sanitize") expect(r.entryId).toBe("id-1");
  });

  it("sanitize without --entry-id throws InvalidCommandArgsError", () => {
    expect(() => p.parse(["sanitize"])).toThrow(InvalidCommandArgsError);
  });

  it("curator-run with --dry-run", () => {
    const r = p.parse(["curator-run", "--dry-run"]);
    expect(r.command).toBe("curator-run");
    if (r.command === "curator-run") expect(r.dryRun).toBe(true);
  });

  it("curator-log with --last (positive integer)", () => {
    const r = p.parse(["curator-log", "--last", "5"]);
    expect(r.command).toBe("curator-log");
    if (r.command === "curator-log") expect(r.last).toBe(5);
  });

  it("curator-log with invalid --last throws InvalidCommandArgsError", () => {
    expect(() => p.parse(["curator-log", "--last", "0"])).toThrow(
      InvalidCommandArgsError,
    );
    expect(() => p.parse(["curator-log", "--last", "abc"])).toThrow(
      InvalidCommandArgsError,
    );
  });

  it("import-handoff requires --handoff", () => {
    const r = p.parse(["import-handoff", "--handoff", "/tmp/h.md"]);
    expect(r.command).toBe("import-handoff");
    if (r.command === "import-handoff")
      expect(r.handoffPath).toBe("/tmp/h.md");
  });

  it("export requires --output", () => {
    const r = p.parse(["export", "--output", "/tmp/x.json"]);
    expect(r.command).toBe("export");
    if (r.command === "export") expect(r.outputPath).toBe("/tmp/x.json");
  });

  it("import requires --input", () => {
    const r = p.parse(["import", "--input", "/tmp/i.json"]);
    expect(r.command).toBe("import");
    if (r.command === "import") expect(r.inputPath).toBe("/tmp/i.json");
  });

  it("wipe with --confirm", () => {
    const r = p.parse(["wipe", "--confirm"]);
    expect(r.command).toBe("wipe");
    if (r.command === "wipe") expect(r.confirm).toBe(true);
  });
});

describe("CommanderCliParser — error mapping", () => {
  it("unknown command → UnknownCommandError", () => {
    expect(() => p.parse(["innit"])).toThrow(UnknownCommandError);
  });

  it("init with invalid --mode → InvalidCommandArgsError", () => {
    expect(() => p.parse(["init", "--mode", "weird"])).toThrow(
      InvalidCommandArgsError,
    );
  });

  it("mode with invalid value → InvalidCommandArgsError", () => {
    expect(() => p.parse(["mode", "weird"])).toThrow(InvalidCommandArgsError);
  });

  it("missing positional argument for `mode` is an InvalidCommandArgsError", () => {
    expect(() => p.parse(["mode"])).toThrow(InvalidCommandArgsError);
  });

  it("no command + no flags → throws (commander.help)", () => {
    // commander emits a CommanderError(`commander.help`) on []`. The
    // parser re-throws it untouched (it isn't `commander.unknownCommand`
    // nor a missing-arg code), so we only assert that *something* is
    // thrown. The CliEntrypoint downstream maps any parser throw to
    // `usageError`.
    expect(() => p.parse([])).toThrow();
  });
});
