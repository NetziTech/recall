import { describe, it, expectTypeOf } from "vitest";

import type {
  ChangeMode,
  DetectWorkspace,
  HealthCheck,
  InitializeWorkspace,
  LockWorkspace,
  UnlockWorkspace,
  DatabaseBootstrap,
  DestroyEncryptionFacade,
  EmbedderProbe,
  InitializeEncryptionFacade,
  LockEncryptionFacade,
  UnlockEncryptionFacade,
  WorkspaceFilesystem,
} from "../../../../../src/modules/workspace/application/ports/index.ts";

describe("workspace/application/ports surface", () => {
  it("driving ports expose the documented entry methods", () => {
    expectTypeOf<DetectWorkspace["detect"]>().toBeFunction();
    expectTypeOf<InitializeWorkspace["initialize"]>().toBeFunction();
    expectTypeOf<UnlockWorkspace["unlock"]>().toBeFunction();
    expectTypeOf<LockWorkspace["lock"]>().toBeFunction();
    expectTypeOf<ChangeMode["change"]>().toBeFunction();
    expectTypeOf<HealthCheck["check"]>().toBeFunction();
  });

  it("driven ports expose the documented out methods", () => {
    expectTypeOf<DatabaseBootstrap["bootstrap"]>().toBeFunction();
    expectTypeOf<DatabaseBootstrap["probe"]>().toBeFunction();
    expectTypeOf<DestroyEncryptionFacade["destroy"]>().toBeFunction();
    expectTypeOf<EmbedderProbe["probe"]>().toBeFunction();
    expectTypeOf<InitializeEncryptionFacade["initialize"]>().toBeFunction();
    expectTypeOf<LockEncryptionFacade["lock"]>().toBeFunction();
    expectTypeOf<UnlockEncryptionFacade["unlock"]>().toBeFunction();

    expectTypeOf<WorkspaceFilesystem["workspaceExists"]>().toBeFunction();
    expectTypeOf<WorkspaceFilesystem["createWorkspaceDirectory"]>().toBeFunction();
    expectTypeOf<WorkspaceFilesystem["readConfig"]>().toBeFunction();
    expectTypeOf<WorkspaceFilesystem["writeConfig"]>().toBeFunction();
    expectTypeOf<WorkspaceFilesystem["ensureGitignore"]>().toBeFunction();
  });
});
