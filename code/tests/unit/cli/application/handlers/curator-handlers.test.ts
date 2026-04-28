import { describe, it, expect } from "vitest";

import {
  CuratorLogCommandHandler,
  CuratorRunCommandHandler,
} from "../../../../../src/modules/cli/application/use-cases/handlers/curator-handlers.ts";
import {
  SilentLogger,
  StubCuratorLogFacade,
  StubCuratorRunFacade,
} from "../../../../fixtures/cli-fixtures.ts";

describe("CuratorRunCommandHandler", () => {
  it("dryRun=false: forwards + renders run summary", async () => {
    const facade = new StubCuratorRunFacade();
    const h = new CuratorRunCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "curator-run",
      workspacePath: "/tmp",
      nonInteractive: false,
      dryRun: false,
    });
    expect(facade.lastInput?.dryRun).toBe(false);
    expect(out.stdout).toContain("run-1");
    expect(out.stdout).toContain("Entradas escaneadas: 100");
    expect(out.stdout).not.toContain("dry-run");
  });

  it("dryRun=true marks the output", async () => {
    const facade = new StubCuratorRunFacade();
    const h = new CuratorRunCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "curator-run",
      workspacePath: "/tmp",
      nonInteractive: false,
      dryRun: true,
    });
    expect(out.stdout).toContain("dry-run");
  });
});

describe("CuratorLogCommandHandler", () => {
  it("empty entries: prints 'Sin runs registrados'", async () => {
    const facade = new StubCuratorLogFacade();
    const h = new CuratorLogCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "curator-log",
      workspacePath: "/tmp",
      nonInteractive: false,
      last: null,
    });
    expect(out.stdout).toContain("Sin runs registrados");
  });

  it("non-empty entries: includes runId, trigger, started, ended", async () => {
    const facade = new StubCuratorLogFacade();
    facade.output = {
      entries: [
        {
          runId: "r1",
          trigger: "manual",
          startedAtMs: 1000,
          endedAtMs: 2000,
          entriesScanned: 50,
          entriesPruned: 3,
        },
        {
          runId: "r2",
          trigger: "scheduled",
          startedAtMs: 3000,
          endedAtMs: null,
          entriesScanned: 10,
          entriesPruned: 0,
        },
      ],
    };
    const h = new CuratorLogCommandHandler(facade, new SilentLogger());
    const out = await h.handle({
      command: "curator-log",
      workspacePath: "/tmp",
      nonInteractive: false,
      last: 5,
    });
    expect(facade.lastInput?.last).toBe(5);
    expect(out.stdout).toContain("r1");
    expect(out.stdout).toContain("manual");
    expect(out.stdout).toContain("r2");
    expect(out.stdout).toContain("in-flight");
  });
});
