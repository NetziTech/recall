/**
 * Public surface of `modules/memory/application/ports/in/`.
 *
 * Re-exports every driving (input) port the memory module exposes to
 * the rest of the codebase (the MCP tool layer, the CLI, the curator
 * orchestrator). Each port is a contract: a use case implementation
 * lives alongside in `application/use-cases/`.
 */

export type {
  AuditMemory,
  AuditIssue,
  AuditMemoryResult,
} from "./audit-memory.port.ts";
export type { EndSession, EndSessionResult } from "./end-session.port.ts";
export type {
  ExportMemory,
  ExportMemoryResult,
} from "./export-memory.port.ts";
export type {
  ImportHandoff,
  ImportHandoffResult,
} from "./import-handoff.port.ts";
export type {
  ImportMemory,
  ImportMemoryResult,
  ImportConflictStrategy,
} from "./import-memory.port.ts";
export type {
  RecordDecision,
  RecordDecisionResult,
} from "./record-decision.port.ts";
export type {
  RecordEntity,
  RecordEntityResult,
} from "./record-entity.port.ts";
export type {
  RecordLearning,
  RecordLearningResult,
} from "./record-learning.port.ts";
export type {
  RecordRelation,
  RecordRelationResult,
} from "./record-relation.port.ts";
export type { RecordTurn, RecordTurnResult } from "./record-turn.port.ts";
export type {
  StartSession,
  StartSessionResult,
} from "./start-session.port.ts";
export type { StatsMemory, StatsMemoryResult } from "./stats-memory.port.ts";
export type {
  TrackTask,
  CreateTaskResult,
  UpdateTaskStatusResult,
} from "./track-task.port.ts";
export type { WipeMemory, WipeMemoryResult } from "./wipe-memory.port.ts";
