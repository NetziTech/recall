import { describe, expect, it } from "vitest";

import { ResetQueueCommandHandler } from "../../../../../src/modules/cli/application/use-cases/handlers/embedding-queue-handlers.ts";
import {
  SilentLogger,
  StubResetQueueFacade,
} from "../../../../fixtures/cli-fixtures.ts";

describe("ResetQueueCommandHandler", () => {
  it("forwards rootPath and threshold (null = use default)", async () => {
    const facade = new StubResetQueueFacade();
    facade.output = { resetCount: 12, thresholdApplied: 5 };
    const h = new ResetQueueCommandHandler(facade, new SilentLogger());

    const out = await h.handle({
      command: "reset-queue",
      workspacePath: "/tmp/work",
      nonInteractive: false,
      threshold: null,
    });

    expect(facade.lastInput?.rootPath).toBe("/tmp/work");
    expect(facade.lastInput?.threshold).toBeNull();
    expect(out.stdout).toContain("Cola de embeddings restablecida");
    expect(out.stdout).toContain("Filas restablecidas: 12");
    expect(out.stdout).toContain("Umbral aplicado (attempts >=): 5");
    expect(out.stdout).toContain(
      "El worker re-intentara estas entradas en su proximo drain.",
    );
  });

  it("forwards a custom threshold to the facade", async () => {
    const facade = new StubResetQueueFacade();
    facade.output = { resetCount: 0, thresholdApplied: 3 };
    const h = new ResetQueueCommandHandler(facade, new SilentLogger());

    await h.handle({
      command: "reset-queue",
      workspacePath: null,
      nonInteractive: true,
      threshold: 3,
    });

    expect(facade.lastInput?.threshold).toBe(3);
  });

  it("emits a 'nothing to do' line when resetCount is 0", async () => {
    const facade = new StubResetQueueFacade();
    facade.output = { resetCount: 0, thresholdApplied: 5 };
    const h = new ResetQueueCommandHandler(facade, new SilentLogger());

    const out = await h.handle({
      command: "reset-queue",
      workspacePath: "/tmp/work",
      nonInteractive: false,
      threshold: null,
    });

    expect(out.stdout).toContain("Filas restablecidas: 0");
    expect(out.stdout).toContain(
      "Nada que hacer: ninguna entrada superaba el umbral.",
    );
  });

  it("declares its command discriminator as the literal 'reset-queue'", () => {
    const h = new ResetQueueCommandHandler(
      new StubResetQueueFacade(),
      new SilentLogger(),
    );
    expect(h.command).toBe("reset-queue");
  });
});
