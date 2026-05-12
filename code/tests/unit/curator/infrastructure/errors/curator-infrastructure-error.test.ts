import { describe, expect, it } from "vitest";

import { CuratorInfrastructureError } from "../../../../../src/modules/curator/infrastructure/errors/curator-infrastructure-error.ts";
import { InfrastructureError } from "../../../../../src/shared/infrastructure/errors/infrastructure-error.ts";

describe("CuratorInfrastructureError factories", () => {
  const cause = new Error("u");

  it("rowMalformed exposes table + detail in details (sql identifiers are not paths)", () => {
    const e = CuratorInfrastructureError.rowMalformed("decisions", "bad shape", cause);
    expect(e).toBeInstanceOf(InfrastructureError);
    expect(e.code).toBe("curator.persistence.row-malformed");
    expect(e.message).toContain("decisions");
    expect(e.message).toContain("bad shape");
    expect(e.details).toEqual({ table: "decisions", detail: "bad shape" });
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("upsertFailed exposes table in details", () => {
    const e = CuratorInfrastructureError.upsertFailed("learnings", cause);
    expect(e.code).toBe("curator.persistence.upsert-failed");
    expect(e.details).toEqual({ table: "learnings" });
  });

  it("unsupportedKind exposes operation + kind in details", () => {
    const e = CuratorInfrastructureError.unsupportedKind("prune", "ephemeral");
    expect(e.code).toBe("curator.persistence.unsupported-kind");
    expect(e.details).toEqual({ operation: "prune", kind: "ephemeral" });
  });

  it("scanFailed (W-3.5-SEC-L2) keeps the absolute path out of message", () => {
    const ROOT = "/abs/secret/curated/workspace";
    const e = CuratorInfrastructureError.scanFailed(ROOT, cause);
    expect(e.code).toBe("curator.filesystem.scan-failed");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });
});
