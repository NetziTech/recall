import { describe, it, expect } from "vitest";

import { CommandName } from "../../../../../src/modules/cli/domain/value-objects/command-name.ts";
import { UnknownCommandError } from "../../../../../src/modules/cli/domain/errors/unknown-command-error.ts";

const KNOWN = [
  "init",
  "mode",
  "unlock",
  "forget-key",
  "export-key",
  "rekey",
  "add-key",
  "audit",
  "sanitize",
  "curator-run",
  "curator-log",
  "reset-queue",
  "import-handoff",
  "export",
  "import",
  "wipe",
  "install-hook",
  "uninstall-hook",
  "stats",
  "health",
  "server",
] as const;

describe("CommandName", () => {
  it.each(KNOWN)("accepts %s", (name) => {
    const cn = CommandName.create(name);
    expect(cn.value).toBe(name);
    expect(cn.toString()).toBe(name);
  });

  it("trims whitespace", () => {
    expect(CommandName.create("  init  ").value).toBe("init");
  });

  it("rejects unknown commands", () => {
    expect(() => CommandName.create("innit")).toThrow(UnknownCommandError);
    expect(() => CommandName.create("INIT")).toThrow(UnknownCommandError);
  });

  it("rejects non-string", () => {
    expect(() => CommandName.create(undefined as unknown as string)).toThrow(
      UnknownCommandError,
    );
  });

  it("isValue type guard", () => {
    expect(CommandName.isValue("init")).toBe(true);
    expect(CommandName.isValue("nope")).toBe(false);
  });

  it("all() returns frozen catalog with every known command", () => {
    const list = CommandName.all();
    expect(Object.isFrozen(list)).toBe(true);
    expect(list.length).toBe(KNOWN.length);
    for (const k of KNOWN) {
      expect(list).toContain(k);
    }
  });

  it("equals compares value", () => {
    const a = CommandName.create("stats");
    const b = CommandName.create("stats");
    expect(a.equals(b)).toBe(true);
    expect(a.equals(CommandName.create("health"))).toBe(false);
  });
});
