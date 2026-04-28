import { describe, it, expect } from "vitest";

import { WorkspaceConfig } from "../../../../../src/modules/workspace/domain/value-objects/workspace-config.ts";
import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

const W_ID = "01952f3b-7d8c-7b4a-94f1-a3f8d12e5c89";

function makeConfig(overrides: {
  schemaVersion?: string;
  mode?: "shared" | "encrypted" | "private";
  display?: string;
} = {}): WorkspaceConfig {
  return WorkspaceConfig.create({
    schemaVersion: overrides.schemaVersion ?? "1.0.0",
    workspaceId: WorkspaceId.from(W_ID),
    displayName: DisplayName.create(overrides.display ?? "My Workspace"),
    mode: WorkspaceMode.create(overrides.mode ?? "shared"),
    embedder: EmbedderSpec.create({
      provider: "fastembed",
      model: "BGESmallEN15",
    }),
    createdAt: Timestamp.fromEpochMs(1_700_000_000_000),
  });
}

describe("WorkspaceConfig.create", () => {
  it("builds with valid inputs", () => {
    const cfg = makeConfig();
    expect(cfg.schemaVersion).toBe("1.0.0");
    expect(cfg.workspaceId.toString()).toBe(W_ID);
    expect(cfg.displayName.toString()).toBe("My Workspace");
    expect(cfg.mode.kind).toBe("shared");
    expect(cfg.embedder.dim).toBe(384);
    expect(cfg.createdAt.toEpochMs()).toBe(1_700_000_000_000);
  });

  it("rejects invalid schema_version (non-semver)", () => {
    expect(() => makeConfig({ schemaVersion: "1.0" })).toThrow(InvalidInputError);
    expect(() => makeConfig({ schemaVersion: "v1.0.0" })).toThrow(InvalidInputError);
    expect(() => makeConfig({ schemaVersion: "1.a.0" })).toThrow(InvalidInputError);
  });

  it("rejects non-string schema_version", () => {
    expect(() =>
      WorkspaceConfig.create({
        schemaVersion: 1 as unknown as string,
        workspaceId: WorkspaceId.from(W_ID),
        displayName: DisplayName.create("x"),
        mode: WorkspaceMode.sharedMode(),
        embedder: EmbedderSpec.create({
          provider: "fastembed",
          model: "BGESmallEN15",
        }),
        createdAt: Timestamp.fromEpochMs(0),
      }),
    ).toThrow(InvalidInputError);
  });
});

describe("WorkspaceConfig builders", () => {
  it("withMode replaces only mode", () => {
    const a = makeConfig({ mode: "shared" });
    const b = a.withMode(WorkspaceMode.privateMode());
    expect(b.mode.kind).toBe("private");
    expect(b.workspaceId.equals(a.workspaceId)).toBe(true);
    expect(b.displayName.equals(a.displayName)).toBe(true);
  });

  it("withMode is no-op when same mode", () => {
    const a = makeConfig({ mode: "shared" });
    const b = a.withMode(WorkspaceMode.sharedMode());
    expect(b).toBe(a);
  });

  it("withEmbedder replaces only embedder", () => {
    const a = makeConfig();
    const newEmb = EmbedderSpec.create({
      provider: "fastembed",
      model: "BGELargeEN",
      dim: 1024,
    });
    const b = a.withEmbedder(newEmb);
    expect(b.embedder.equals(newEmb)).toBe(true);
    expect(b.equals(a)).toBe(false);
  });

  it("withEmbedder is no-op when equal", () => {
    const a = makeConfig();
    const same = EmbedderSpec.create({
      provider: "fastembed",
      model: "BGESmallEN15",
    });
    const b = a.withEmbedder(same);
    expect(b).toBe(a);
  });

  it("withDisplayName replaces only displayName", () => {
    const a = makeConfig({ display: "First" });
    const b = a.withDisplayName(DisplayName.create("Second"));
    expect(b.displayName.toString()).toBe("Second");
  });

  it("withDisplayName is no-op when equal", () => {
    const a = makeConfig({ display: "Same" });
    const b = a.withDisplayName(DisplayName.create("Same"));
    expect(b).toBe(a);
  });
});

describe("WorkspaceConfig.equals", () => {
  it("equal when every field matches", () => {
    expect(makeConfig().equals(makeConfig())).toBe(true);
  });

  it("not equal when something differs", () => {
    const a = makeConfig();
    const b = a.withMode(WorkspaceMode.privateMode());
    expect(a.equals(b)).toBe(false);
  });

  it("identity short-circuit", () => {
    const a = makeConfig();
    expect(a.equals(a)).toBe(true);
  });
});
