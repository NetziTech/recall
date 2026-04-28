import { describe, it, expectTypeOf } from "vitest";

import type {
  CommandHandler,
  ErasedCommandHandler,
  RunCliCommand,
  ChangeModeFacade,
  HealthCheckFacade,
  InitializeWorkspaceFacade,
  LockWorkspaceFacade,
  UnlockWorkspaceFacade,
  AddKeyFacade,
  ExportKeyFacade,
  RekeyFacade,
  AuditFacade,
  InstallHookFacade,
  SanitizeFacade,
  UninstallHookFacade,
  CuratorLogFacade,
  CuratorRunFacade,
  ExportFacade,
  ImportFacade,
  ImportHandoffFacade,
  ServerFacade,
  StatsFacade,
  WipeFacade,
  Prompt,
  Stdout,
  Stderr,
} from "../../../../../src/modules/cli/application/ports/index.ts";

describe("cli/application/ports surface", () => {
  it("driving ports exist", () => {
    expectTypeOf<RunCliCommand["run"]>().toBeFunction();
    expectTypeOf<CommandHandler<"stats">>().toMatchTypeOf<ErasedCommandHandler>();
  });

  it("workspace facades exist", () => {
    expectTypeOf<InitializeWorkspaceFacade["initialize"]>().toBeFunction();
    expectTypeOf<UnlockWorkspaceFacade["unlock"]>().toBeFunction();
    expectTypeOf<LockWorkspaceFacade["lock"]>().toBeFunction();
    expectTypeOf<ChangeModeFacade["change"]>().toBeFunction();
    expectTypeOf<HealthCheckFacade["check"]>().toBeFunction();
  });

  it("encryption facades exist", () => {
    expectTypeOf<ExportKeyFacade["export"]>().toBeFunction();
    expectTypeOf<RekeyFacade["rekey"]>().toBeFunction();
    expectTypeOf<AddKeyFacade["add"]>().toBeFunction();
  });

  it("secrets facades exist", () => {
    expectTypeOf<AuditFacade["audit"]>().toBeFunction();
    expectTypeOf<SanitizeFacade["sanitize"]>().toBeFunction();
    expectTypeOf<InstallHookFacade["install"]>().toBeFunction();
    expectTypeOf<UninstallHookFacade["uninstall"]>().toBeFunction();
  });

  it("curator facades exist", () => {
    expectTypeOf<CuratorRunFacade["run"]>().toBeFunction();
    expectTypeOf<CuratorLogFacade["log"]>().toBeFunction();
  });

  it("maintenance facades exist", () => {
    expectTypeOf<ImportHandoffFacade["importHandoff"]>().toBeFunction();
    expectTypeOf<ExportFacade["export"]>().toBeFunction();
    expectTypeOf<ImportFacade["import"]>().toBeFunction();
    expectTypeOf<WipeFacade["wipe"]>().toBeFunction();
    expectTypeOf<StatsFacade["stats"]>().toBeFunction();
    expectTypeOf<ServerFacade["start"]>().toBeFunction();
  });

  it("tty ports", () => {
    expectTypeOf<Stdout["write"]>().toBeFunction();
    expectTypeOf<Stderr["write"]>().toBeFunction();
    expectTypeOf<Prompt["confirm"]>().toBeFunction();
    expectTypeOf<Prompt["readLine"]>().toBeFunction();
    expectTypeOf<Prompt["readPassphrase"]>().toBeFunction();
  });
});
