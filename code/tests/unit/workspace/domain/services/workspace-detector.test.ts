import { describe, it, expectTypeOf } from "vitest";

import type {
  WorkspaceDetectionResult,
  WorkspaceDetector,
} from "../../../../../src/modules/workspace/domain/services/workspace-detector.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";

/**
 * The WorkspaceDetector is a port. Coverage on the port itself comes
 * from its adapter (`MarkerBasedWorkspaceDetector`). Here we lock
 * down the discriminated-union shape so a wrong refactor is caught
 * at compile-time.
 */
describe("WorkspaceDetector port surface", () => {
  it("WorkspaceDetectionResult has the discriminated union shape", () => {
    const hit: WorkspaceDetectionResult = {
      exists: true,
      configPath: WorkspacePath.create("/foo"),
    };
    const miss: WorkspaceDetectionResult = {
      exists: false,
      configPath: null,
    };
    expectTypeOf(hit).toEqualTypeOf<WorkspaceDetectionResult>();
    expectTypeOf(miss).toEqualTypeOf<WorkspaceDetectionResult>();
  });

  it("WorkspaceDetector exposes detect()", () => {
    expectTypeOf<WorkspaceDetector["detect"]>().parameters.toEqualTypeOf<
      [WorkspacePath]
    >();
  });
});
