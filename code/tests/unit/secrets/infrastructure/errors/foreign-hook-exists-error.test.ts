import { describe, expect, it } from "vitest";

import { ForeignHookExistsError } from "../../../../../src/modules/secrets/infrastructure/errors/foreign-hook-exists-error.ts";
import { SecretsInfrastructureError } from "../../../../../src/modules/secrets/infrastructure/errors/secrets-infrastructure-error.ts";

describe("ForeignHookExistsError (W-3.5-SEC-L2 redaction)", () => {
  const HOOK_PATH = "/abs/secret/repo/.git/hooks/pre-commit";

  it("keeps the absolute hook path out of message and into details.path", () => {
    const e = new ForeignHookExistsError(HOOK_PATH);
    expect(e).toBeInstanceOf(SecretsInfrastructureError);
    expect(e.code).toBe("secrets.foreign-hook-exists");
    expect(e.message).not.toContain(HOOK_PATH);
    expect(e.message).toContain("--force");
    expect(e.details).toEqual({ path: HOOK_PATH });
  });

  it("preserves cause when provided", () => {
    const cause = new Error("u");
    const e = new ForeignHookExistsError(HOOK_PATH, cause);
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
    expect(e.details).toEqual({ path: HOOK_PATH });
  });

  it("details is read via dot-access without an undefined-guard", () => {
    const e = new ForeignHookExistsError(HOOK_PATH);
    // Hot path used by adapters / loggers: `error.details.path` is
    // always defined for this class.
    expect(e.details.path).toBe(HOOK_PATH);
  });
});
