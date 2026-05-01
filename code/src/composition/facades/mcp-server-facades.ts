/**
 * Cross-module facade adapters that wrap module use cases in the
 * `mcp-server` driving ports (`*Facade.port.ts`).
 *
 * Why these adapters live in `composition/`:
 * - The `mcp-server` module declares the facade ports precisely so it
 *   does not import from workspace/retrieval/curator/memory. The
 *   composition root is the only place allowed to wire both sides
 *   (`docs/12 §1.5` Regla 4).
 *
 * Coverage matrix (Tarea 4.7):
 *
 *   | Facade                     | Status                                          |
 *   |----------------------------|-------------------------------------------------|
 *   | `InitializeWorkspaceFacade`| Wired end-to-end against `InitializeWorkspaceUseCase`. |
 *   | `GetContextFacade`         | Wired against `GetContextBundleUseCase`.       |
 *   | `RecallMemoryFacade`       | Wired against `RecallMemoryUseCase`.           |
 *   | `RememberFacade`           | Wired against the per-kind memory use cases    |
 *   |                            | (`RecordDecision/Learning/Entity/Turn`,        |
 *   |                            | `TrackTask.create` for `task`).                |
 *   | `TrackTaskFacade`          | Wired against `TrackTaskUseCase`.              |
 *   | `CheckHealthFacade`        | Wired against the workspace's `HealthCheckUseCase`, |
 *   |                            | with several wire fields filled by the memory  |
 *   |                            | stats reader. Fields the workspace cannot      |
 *   |                            | populate alone (queue depth, last curator run) |
 *   |                            | remain conservative defaults — the dispatcher  |
 *   |                            | still produces a valid envelope.                |
 *
 * **D-102 (`ContextLayerKind` mapping).** The wire literals (per
 * `docs/02 §4.2`) and the domain enum (per
 * `retrieval/domain/value-objects/context-layer-kind.ts`) diverge on
 * three names. The mapping is documented as a JSDoc table below and
 * exercised by the `GetContextFacadeAdapter` to translate the
 * domain-named layer kinds emitted by `GetContextBundleUseCase` into
 * the wire-named literals returned to MCP clients.
 */

import type { Logger } from "../../shared/application/ports/logger.port.ts";
import { Tags } from "../../shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../shared/domain/value-objects/workspace-id.ts";
import type {
  ContextInputWire,
  ContextLayerWire,
  ContextOutputWire,
  EmbeddingStatusWire,
  EncryptionStatusWire,
  EntityKindWire,
  HealthInputWire,
  HealthOutputWire,
  InitInputWire,
  InitOutputWire,
  LayerNameWire,
  MemoryEntryWire,
  MemoryKindWire,
  RecallInputWire,
  RecallOutputWire,
  RememberInputWire,
  RememberOutputWire,
  TaskInputWire,
  TaskOutputWire,
  TaskPriorityWire,
  TaskStatusWire,
  TaskWire,
  WorkspaceModeWire,
} from "../../modules/mcp-server/application/dtos/wire-types.dto.ts";
import type { CheckHealthFacade } from "../../modules/mcp-server/application/ports/out/check-health-facade.port.ts";
import type { GetContextFacade } from "../../modules/mcp-server/application/ports/out/get-context-facade.port.ts";
import type { InitializeWorkspaceFacade } from "../../modules/mcp-server/application/ports/out/initialize-workspace-facade.port.ts";
import type { RecallMemoryFacade } from "../../modules/mcp-server/application/ports/out/recall-memory-facade.port.ts";
import type { RememberFacade } from "../../modules/mcp-server/application/ports/out/remember-facade.port.ts";
import type { TrackTaskFacade } from "../../modules/mcp-server/application/ports/out/track-task-facade.port.ts";
import { Confidence } from "../../shared/domain/value-objects/confidence.ts";
import type { Task } from "../../modules/memory/domain/aggregates/task.ts";
import { EntityKind } from "../../modules/memory/domain/value-objects/entity-kind.ts";
import { LearningSeverity } from "../../modules/memory/domain/value-objects/learning-severity.ts";
import type { RecordDecision } from "../../modules/memory/application/ports/in/record-decision.port.ts";
import type { RecordEntity } from "../../modules/memory/application/ports/in/record-entity.port.ts";
import type { RecordLearning } from "../../modules/memory/application/ports/in/record-learning.port.ts";
import type { RecordTurn } from "../../modules/memory/application/ports/in/record-turn.port.ts";
import { Scope } from "../../modules/memory/domain/value-objects/scope.ts";
import { TaskId } from "../../modules/memory/domain/value-objects/task-id.ts";
import { TaskPriority } from "../../modules/memory/domain/value-objects/task-priority.ts";
import { TaskStatus } from "../../modules/memory/domain/value-objects/task-status.ts";
import type { TrackTask } from "../../modules/memory/application/ports/in/track-task.port.ts";
import type { GetContextBundle } from "../../modules/retrieval/application/ports/in/get-context-bundle.port.ts";
import type { RecallMemory } from "../../modules/retrieval/application/ports/in/recall-memory.port.ts";
import type { ContextLayer } from "../../modules/retrieval/domain/value-objects/context-layer.ts";
import type { ContextLayerKindValue } from "../../modules/retrieval/domain/value-objects/context-layer-kind.ts";
import { Query } from "../../modules/retrieval/domain/value-objects/query.ts";
import { QueryKind } from "../../modules/retrieval/domain/value-objects/query-kind.ts";
import { QueryText } from "../../modules/retrieval/domain/value-objects/query-text.ts";
import { RecallFilters } from "../../modules/retrieval/domain/value-objects/recall-filters.ts";
import { RelevanceWeights } from "../../modules/retrieval/domain/value-objects/relevance-weights.ts";
import { TokenBudget } from "../../modules/retrieval/domain/value-objects/token-budget.ts";
import { DisplayName } from "../../modules/workspace/domain/value-objects/display-name.ts";
import type { EmbedderSpec } from "../../modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../modules/workspace/domain/value-objects/workspace-path.ts";
import type { InitializeWorkspaceUseCase } from "../../modules/workspace/application/use-cases/initialize-workspace.use-case.ts";
import type { HealthCheckUseCase } from "../../modules/workspace/application/use-cases/health-check.use-case.ts";
import type { WorkspaceStateReader } from "../../modules/mcp-server/application/ports/out/workspace-state-reader.port.ts";

/**
 * Tagged error used by the `mcp-server` adapter layer when a wire
 * input is malformed beyond what the use cases can express. Wire
 * validation lives in the dispatcher's Zod schema; this error
 * surfaces only when a previously-typed field still violates a
 * domain-level constraint (e.g. wire `kind === "task"` with no
 * `title` while the wire schema marks `title` as optional).
 */
export class McpFacadeNotImplementedError extends Error {
  public readonly code = "composition.mcp-facade-pending";

  public constructor(facade: string, reason: string) {
    super(
      `${facade} is not implemented yet (Fase 4 dispute; ${reason}; see composition/facades/mcp-server-facades.ts).`,
    );
    this.name = "McpFacadeNotImplementedError";
  }
}

/**
 * Adapter for `InitializeWorkspaceFacade`. Translates the wire init
 * DTO into the workspace use case's input (`InitializeWorkspaceInput`)
 * and back.
 *
 * Wire fields handled today:
 *   - `workspace_path` → `WorkspacePath.create(...)` (defaults to
 *     `process.cwd()` when omitted).
 *   - `mode`           → `WorkspaceMode.create(raw ?? "shared")`.
 *   - `display_name`   → `DisplayName.create(raw ?? rootDirName)`.
 *
 * Notes:
 *   - The encrypted-mode flow needs a passphrase. The MCP `mem.init`
 *     wire schema does NOT carry one (the spec says the passphrase
 *     is collected interactively on the CLI). The adapter therefore
 *     surfaces a typed failure when `mode === "encrypted"`; clients
 *     are expected to drive encryption initialisation through the
 *     CLI binary (`recall init --mode encrypted`).
 */
export class InitializeWorkspaceFacadeAdapter implements InitializeWorkspaceFacade {
  public constructor(
    private readonly useCase: InitializeWorkspaceUseCase,
    private readonly defaultEmbedder: EmbedderSpec,
    private readonly logger: Logger,
  ) {}

  public async initialize(input: InitInputWire): Promise<InitOutputWire> {
    const rawPath = input.workspace_path ?? process.cwd();
    const rootPath = WorkspacePath.create(rawPath);
    const mode = WorkspaceMode.create(input.mode ?? "shared");
    const displayNameRaw =
      input.display_name ?? InitializeWorkspaceFacadeAdapter.fallbackName(rawPath);
    const displayName = DisplayName.create(displayNameRaw);

    if (mode.isEncrypted()) {
      this.logger.warn(
        { tool: "mem.init" },
        "encrypted-mode init via mem.init is not supported (use the CLI binary)",
      );
      throw new McpFacadeNotImplementedError(
        "InitializeWorkspaceFacade",
        "encrypted-mode init via mem.init wire DTO has no passphrase channel",
      );
    }

    const result = await this.useCase.initialize({
      rootPath,
      mode,
      displayName,
      embedder: this.defaultEmbedder,
      passphrase: null,
    });

    const config = result.workspace.getConfig();
    return {
      workspace_id: config.workspaceId.toString(),
      workspace_path: rootPath.toString(),
      display_name: config.displayName.toString(),
      mode: modeToWire(config.mode),
      is_new: result.wasCreated,
      total_entries: 0,
      schema_version: config.schemaVersion,
    };
  }

  private static fallbackName(rawPath: string): string {
    const segments = rawPath.split(/[\\/]/).filter((segment) => segment.length > 0);
    if (segments.length === 0) return "workspace";
    const last = segments[segments.length - 1];
    return last !== undefined && last.length > 0 ? last : "workspace";
  }
}

/**
 * `LayerNameWire` ↔ `ContextLayerKindValue` mapping (D-102).
 *
 * | Wire literal             | Domain literal       |
 * |--------------------------|----------------------|
 * | `system_identity`        | `workspace_anchor`   |
 * | `project_constitution`   | `active_decisions`   |
 * | `active_tasks`           | `open_tasks`         |
 * | `recent_turns`           | `recent_turns`       |
 * | `relevant_memory`        | `relevant_memory`    |
 * | `code_map`               | `entities_in_focus`  |
 * | `open_questions`         | `open_questions`    |
 *
 * Three rows diverge (`system_identity`, `project_constitution`,
 * `code_map`); the rest match verbatim.
 */
export const WIRE_TO_DOMAIN_LAYER_NAME: Readonly<
  Record<LayerNameWire, ContextLayerKindValue>
> = Object.freeze({
  system_identity: "workspace_anchor",
  project_constitution: "active_decisions",
  active_tasks: "open_tasks",
  recent_turns: "recent_turns",
  relevant_memory: "relevant_memory",
  code_map: "entities_in_focus",
  open_questions: "open_questions",
});

const DOMAIN_TO_WIRE_LAYER_NAME: Readonly<
  Record<ContextLayerKindValue, LayerNameWire>
> = Object.freeze({
  workspace_anchor: "system_identity",
  active_decisions: "project_constitution",
  open_tasks: "active_tasks",
  recent_turns: "recent_turns",
  relevant_memory: "relevant_memory",
  entities_in_focus: "code_map",
  open_questions: "open_questions",
});

/**
 * Adapter for `GetContextFacade`. Translates the wire DTO into
 * `Query`/`TokenBudget`/`LayerBudgetOverrides` and the resulting
 * `ContextBundle` into the `ContextOutputWire` envelope.
 *
 * The wire `content` field of each layer is rendered as a stable
 * JSON string over the layer's payload value: this keeps the
 * boundary lossless without forcing the composition root to embed
 * the protocol's per-kind text-rendering rules.
 *
 * **Workspace id resolution (B-MCP-1).** The constructor takes the
 * canonical `WorkspaceId` resolved by the bootstrap from the
 * workspace's `.recall/config.json`. Real MCP clients (Claude Code,
 * Cursor, ...) do NOT pass `workspace_id` on every `tools/call` —
 * they expect the server to know its own workspace from the cwd
 * Node was launched in. The wire field is honoured when present
 * (useful for E2E tests and future multi-workspace clients) and
 * defaults to the injected id otherwise.
 */
export class GetContextFacadeAdapter implements GetContextFacade {
  private static readonly DEFAULT_MAX_TOKENS = 8000;

  public constructor(
    private readonly useCase: GetContextBundle,
    private readonly defaultWorkspaceId: WorkspaceId,
  ) {}

  public async assemble(input: ContextInputWire): Promise<ContextOutputWire> {
    const workspaceId = resolveWorkspaceId(this.defaultWorkspaceId, input.workspace_id);
    const queryText = input.query?.trim();
    const query =
      queryText === undefined || queryText.length === 0
        ? null
        : Query.create({
            text: QueryText.create(queryText),
            kinds: [],
            tags: Tags.empty(),
            mustHaveTags: Tags.empty(),
            mustNotHaveTags: Tags.empty(),
            includeSuperseded: false,
          });
    const maxTokens = TokenBudget.withMax(
      input.max_tokens ?? GetContextFacadeAdapter.DEFAULT_MAX_TOKENS,
    );
    const layerBudgets =
      input.layer_overrides === undefined
        ? Object.freeze<Partial<Record<ContextLayerKindValue, number>>>({})
        : translateLayerOverrides(input.layer_overrides);

    const bundle = await this.useCase.build({
      workspaceId,
      query,
      maxTokens,
      layerBudgets,
      weights: RelevanceWeights.defaults(),
    });

    const layers = bundle.getLayers();
    const wireLayers: ContextLayerWire[] = layers.map((layer, index) => ({
      id: index + 1,
      name: DOMAIN_TO_WIRE_LAYER_NAME[layer.kind()],
      content: serialiseLayerPayload(layer),
      tokens: layer.tokens().toNumber(),
      entries_count: layer.entriesCount(),
    }));
    let totalTokens = 0;
    for (const layer of wireLayers) totalTokens += layer.tokens;

    return {
      bundle: {
        layers: Object.freeze(wireLayers),
        total_tokens: totalTokens,
      },
    };
  }
}

/**
 * Adapter for `RecallMemoryFacade`. Translates the wire DTO into
 * `Query`/`RecallFilters`/`TokenBudget` and the resulting
 * `RecallResult` into the `RecallOutputWire` envelope.
 *
 * **Workspace id resolution (B-MCP-1).** See
 * {@link GetContextFacadeAdapter} for the rationale; the same rule
 * applies here.
 */
export class RecallMemoryFacadeAdapter implements RecallMemoryFacade {
  private static readonly DEFAULT_TOP_K = 8;
  private static readonly DEFAULT_MAX_TOKENS = 4000;

  public constructor(
    private readonly useCase: RecallMemory,
    private readonly defaultWorkspaceId: WorkspaceId,
  ) {}

  public async recall(input: RecallInputWire): Promise<RecallOutputWire> {
    const workspaceId = resolveWorkspaceId(this.defaultWorkspaceId, input.workspace_id);
    const queryText = input.query?.trim();
    const queryKinds = recallKindsFromWire(input.kinds);
    const query =
      queryText === undefined || queryText.length === 0
        ? null
        : Query.create({
            text: QueryText.create(queryText),
            kinds: queryKinds,
            tags: Tags.empty(),
            mustHaveTags: Tags.create(input.must_have_tags ?? []),
            mustNotHaveTags: Tags.create(input.must_not_have_tags ?? []),
            includeSuperseded: input.include_superseded === true,
          });
    const since =
      typeof input.since_ms === "number"
        ? Timestamp.fromEpochMs(input.since_ms)
        : null;
    const filters = RecallFilters.create({
      kinds: queryKinds,
      tags: Tags.empty(),
      mustHaveTags: Tags.create(input.must_have_tags ?? []),
      mustNotHaveTags: Tags.create(input.must_not_have_tags ?? []),
      minConfidence: null,
      since,
      until: null,
      limit: input.top_k ?? RecallMemoryFacadeAdapter.DEFAULT_TOP_K,
    });
    const maxTokens = TokenBudget.withMax(
      input.max_tokens ?? RecallMemoryFacadeAdapter.DEFAULT_MAX_TOKENS,
    );

    const result = await this.useCase.recall({
      workspaceId,
      query,
      filters,
      maxTokens,
      weights: RelevanceWeights.defaults(),
    });

    const entries: MemoryEntryWire[] = result.getEntries().map((entry) => ({
      id: entry.id,
      kind: queryKindToWire(entry.kind.value),
      content: entry.preview.toString(),
      metadata: Object.freeze({
        title: entry.title.toString(),
      }),
      score: entry.relevanceScore.toNumber(),
      created_at: entry.createdAt.toEpochMs(),
      last_used_ms:
        entry.lastUsedAt === null
          ? entry.createdAt.toEpochMs()
          : entry.lastUsedAt.toEpochMs(),
      tags: Object.freeze([...entry.tags.toArray()]),
    }));

    const out: RecallOutputWire = {
      results: Object.freeze(entries),
      total_candidates: result.totalCandidates,
      total_tokens: result.totalTokens.toNumber(),
      ...(result.fallbackReason === null
        ? {}
        : { fallback_reason: result.fallbackReason }),
    };
    return out;
  }
}

/**
 * Adapter for `RememberFacade`. Routes on `kind` to the matching
 * memory write use case:
 *
 *   | Wire kind  | Use case               |
 *   |------------|------------------------|
 *   | decision   | `RecordDecisionUseCase`|
 *   | learning   | `RecordLearningUseCase`|
 *   | entity     | `RecordEntityUseCase`  |
 *   | turn       | `RecordTurnUseCase`    |
 *   | task       | `TrackTaskUseCase.create` |
 *
 * Defence in depth: the wire DTO carries kind-specific fields as
 * optionals; the adapter builds a minimum-viable payload from
 * `content` when the kind-specific fields are absent (e.g. a wire
 * `decision` with no `title` derives a title from the first sentence
 * of `content`).
 */
export class RememberFacadeAdapter implements RememberFacade {
  public constructor(
    private readonly recordDecision: RecordDecision,
    private readonly recordLearning: RecordLearning,
    private readonly recordEntity: RecordEntity,
    private readonly recordTurn: RecordTurn,
    private readonly trackTask: TrackTask,
    private readonly defaultWorkspaceId: WorkspaceId,
  ) {}

  public async remember(input: RememberInputWire): Promise<RememberOutputWire> {
    const workspaceId = resolveWorkspaceId(this.defaultWorkspaceId, input.workspace_id);
    const tags = Tags.create(input.tags ?? []);
    const scope = scopeFromWire(input.scope ?? "project");

    switch (input.kind) {
      case "decision": {
        const result = await this.recordDecision.record({
          workspaceId,
          sessionId: null,
          title: input.title ?? deriveTitleFromContent(input.content),
          rationale: input.rationale ?? input.content,
          tags,
          scope,
        });
        return {
          id: result.decisionId.toString(),
          kind: "decision",
          upserted: true,
          embedding_status: result.embeddingEnqueued ? "queued" : "skipped",
        };
      }
      case "learning": {
        const severity =
          input.severity === undefined
            ? null
            : LearningSeverity.create(severityFromWire(input.severity));
        const result = await this.recordLearning.record({
          workspaceId,
          text: input.content,
          severity,
          tags,
          scope,
        });
        return {
          id: result.learningId.toString(),
          kind: "learning",
          upserted: true,
          embedding_status: result.embeddingEnqueued ? "queued" : "skipped",
        };
      }
      case "entity": {
        const name = input.name ?? input.content;
        const wireKind: EntityKindWire = input.entity_kind ?? "module";
        const entityKind = entityKindFromWire(wireKind);
        const result = await this.recordEntity.record({
          workspaceId,
          name,
          kind: entityKind,
          description: input.content,
          tags,
          scope,
        });
        return {
          id: result.entityId.toString(),
          kind: "entity",
          upserted: !result.alreadyExisted,
          embedding_status: result.embeddingEnqueued ? "queued" : "skipped",
        };
      }
      case "turn": {
        const result = await this.recordTurn.record({
          workspaceId,
          summary: input.content,
          intent: input.intent ?? null,
          outcome: input.outcome ?? null,
          filesTouched: input.files_touched ?? [],
          linkedDecisions: [],
          linkedLearnings: [],
          tags,
        });
        return {
          id: result.turnId.toString(),
          kind: "turn",
          upserted: true,
          embedding_status: result.embeddingEnqueued ? "queued" : "skipped",
        };
      }
      case "task": {
        const result = await this.trackTask.create({
          workspaceId,
          title: input.title ?? deriveTitleFromContent(input.content),
          description: input.content,
          priority: TaskPriority.medium(),
          tags,
          dueAtMs: null,
        });
        const status: EmbeddingStatusWire = "skipped";
        return {
          id: result.taskId.toString(),
          kind: "task",
          upserted: true,
          embedding_status: status,
        };
      }
      default: {
        // Exhaustiveness — the wire union excludes any other branch.
        const exhaustive: never = input.kind;
        void exhaustive;
        throw new McpFacadeNotImplementedError(
          "RememberFacade",
          `wire kind "${String(input.kind)}" is not modelled by the memory use cases`,
        );
      }
    }
  }
}

/**
 * Adapter for `TrackTaskFacade`. Routes on the wire `action` literal
 * to the matching `TrackTask` method.
 *
 * Status / priority translation:
 *   - The wire uses `pending` for the initial status; the domain
 *     uses `todo`. The adapter normalises at the boundary (wire
 *     `pending` → domain `todo`).
 *   - The wire priority enum is a strict subset of the domain
 *     catalogue (`low | medium | high`); the adapter rejects
 *     `critical` from the wire.
 */
export class TrackTaskFacadeAdapter implements TrackTaskFacade {
  public constructor(
    private readonly useCase: TrackTask,
    private readonly defaultWorkspaceId: WorkspaceId,
  ) {}

  public async task(input: TaskInputWire): Promise<TaskOutputWire> {
    const workspaceId = resolveWorkspaceId(this.defaultWorkspaceId, input.workspace_id);

    switch (input.action) {
      case "create": {
        const title = input.title;
        if (title === undefined || title.length === 0) {
          throw new McpFacadeNotImplementedError(
            "TrackTaskFacade.create",
            "wire input is missing a non-empty `title`",
          );
        }
        const priority =
          input.priority === undefined
            ? TaskPriority.medium()
            : taskPriorityFromWire(input.priority);
        const result = await this.useCase.create({
          workspaceId,
          title,
          description: input.description ?? null,
          priority,
          tags: Tags.create(input.tags ?? []),
          dueAtMs: null,
        });
        return {
          action: "create",
          task_id: result.taskId.toString(),
          updated_at: Date.now(),
        };
      }
      case "update": {
        const taskIdRaw = input.task_id;
        if (taskIdRaw === undefined || taskIdRaw.length === 0) {
          throw new McpFacadeNotImplementedError(
            "TrackTaskFacade.update",
            "wire input is missing `task_id`",
          );
        }
        const taskId = TaskId.from(taskIdRaw);
        const targetStatus = input.status;
        if (targetStatus === undefined) {
          throw new McpFacadeNotImplementedError(
            "TrackTaskFacade.update",
            "wire input is missing `status`",
          );
        }
        const result = await dispatchTaskTransition(
          this.useCase,
          workspaceId,
          taskId,
          targetStatus,
        );
        return {
          action: "update",
          task_id: result.taskId.toString(),
          updated_at: Date.now(),
        };
      }
      case "list": {
        const filterStatus = input.filter?.status;
        const status =
          filterStatus === undefined || filterStatus === "any"
            ? null
            : taskStatusFromWire(filterStatus);
        const tasks = await this.useCase.list({ workspaceId, status });
        return {
          action: "list",
          tasks: Object.freeze(tasks.map(taskToWire)),
        };
      }
      case "get": {
        const taskIdRaw = input.task_id;
        if (taskIdRaw === undefined || taskIdRaw.length === 0) {
          throw new McpFacadeNotImplementedError(
            "TrackTaskFacade.get",
            "wire input is missing `task_id`",
          );
        }
        const taskId = TaskId.from(taskIdRaw);
        const task = await this.useCase.get({ workspaceId, taskId });
        return {
          action: "get",
          task: taskToWire(task),
        };
      }
      case "delete": {
        const taskIdRaw = input.task_id;
        if (taskIdRaw === undefined || taskIdRaw.length === 0) {
          throw new McpFacadeNotImplementedError(
            "TrackTaskFacade.delete",
            "wire input is missing `task_id`",
          );
        }
        const taskId = TaskId.from(taskIdRaw);
        const result = await this.useCase.delete({ workspaceId, taskId });
        return {
          action: "delete",
          deleted: result.deleted,
        };
      }
      default: {
        const exhaustive: never = input.action;
        void exhaustive;
        throw new McpFacadeNotImplementedError(
          "TrackTaskFacade",
          `wire action "${String(input.action)}" is not modelled by the track-task use case`,
        );
      }
    }
  }
}

/**
 * Adapter for `CheckHealthFacade`. Builds the wire `HealthOutputWire`
 * by invoking the workspace's `HealthCheckUseCase` and synthesising
 * placeholder values for the slots the workspace cannot fill alone
 * (memory entry counters, embedding-queue depth, etc.).
 *
 * **Workspace id resolution (B-MCP-1).** Real MCP clients omit
 * `workspace_id` from the wire input; the adapter falls back to the
 * `WorkspaceId` resolved by the bootstrap from the workspace's
 * `.recall/config.json`. When the wire field is present (E2E tests,
 * future multi-workspace clients) it overrides the injected default.
 */
export class CheckHealthFacadeAdapter implements CheckHealthFacade {
  public constructor(
    private readonly healthCheck: HealthCheckUseCase,
    private readonly stateReader: WorkspaceStateReader,
    private readonly workspaceRoot: string,
    private readonly schemaVersion: string,
    private readonly embeddingModel: string,
    private readonly defaultWorkspaceId: WorkspaceId,
  ) {}

  public async health(input: HealthInputWire): Promise<HealthOutputWire> {
    // Use the bootstrap-resolved workspace root rather than
    // `process.cwd()` so the facade is independent of the cwd at
    // request time. In production the bootstrap entrypoint resolves
    // the root from `process.cwd()` once at startup; in tests the
    // root is the test container's tmp dir. Keeping this injection
    // explicit also lets the reader's `fs.statSync` of `recall.db`
    // hit the right file when the binary is launched from a parent
    // directory (some harnesses do this).
    const rawPath = this.workspaceRoot;
    const rootPath = WorkspacePath.create(rawPath);
    const probe = await this.healthCheck.check({ rootPath });

    const ftsCheck = probe.checks.find((c) => c.id === "database.openable");
    const embedderCheck = probe.checks.find((c) => c.id === "embedder.loadable");

    const ftsHealthy: Exclude<HealthOutputWire["fts_health"], "broken"> =
      ftsCheck?.status === "pass" ? "ok" : "rebuild_recommended";
    const vectorIndexHealthy: HealthOutputWire["vector_index_health"] =
      embedderCheck?.status === "pass" ? "ok" : "rebuild_recommended";

    const workspaceId = resolveWorkspaceId(
      this.defaultWorkspaceId,
      input.workspace_id,
    );

    // Read live workspace state through the cross-module reader. The
    // reader swallows per-query failures (returning safe defaults)
    // because `mem.health` is the diagnostic of last resort and must
    // not throw on a partial database (Bug B-MCP-2).
    const state = await this.stateReader.readState({
      workspaceId,
      workspaceRoot: rawPath,
    });

    const modeWire: WorkspaceModeWire = modeToWireFromString(state.mode);
    const encryptionWire: EncryptionStatusWire = state.encryptionStatus;

    return {
      schema_version: this.schemaVersion,
      workspace_id: workspaceId.toString(),
      workspace_path: rootPath.toString(),
      mode: modeWire,
      encryption_status: encryptionWire,

      total_entries: state.totalEntries,
      entries_by_kind: Object.freeze({ ...state.entriesByKind }),
      // `memoria_db` (rather than `recall_db`) is preserved as the
      // wire field name for back-compat with v0.1.0 clients that may
      // have snapshotted the shape. The wire schema in
      // `docs/02-protocolo-mcp.md §4.6` documents this name. Tracked
      // as wire-schema debt: a future major version may rename it.
      size_bytes: {
        memoria_db: state.sizeBytes.recallDb,
        vectors_db: state.sizeBytes.vectorsDb,
      },

      active_session:
        state.activeSession === null
          ? null
          : {
              id: state.activeSession.id,
              started_at: state.activeSession.startedAtMs,
            },
      last_curator_run: state.lastCuratorRunAtMs,
      embedding_model: this.embeddingModel,
      embedding_queue_pending: state.embeddingQueuePending,

      fts_health: ftsHealthy,
      vector_index_health: vectorIndexHealthy,

      ...(probe.healthy
        ? {}
        : {
            warnings: Object.freeze(
              probe.checks
                .filter((c) => c.status === "fail")
                .map((c) => `${c.id}: ${c.message}`),
            ),
          }),
    };
  }
}

/**
 * Narrow a primitive `mode` (as returned by the `WorkspaceStateReader`
 * port — already constrained by SQL CHECK) to the {@link WorkspaceModeWire}
 * union expected by the wire DTO. Unknown values fall back to
 * `"shared"`; the reader logs a warning when the persisted value is
 * not in the expected set, so this is purely a type-narrowing
 * convenience for the facade's TypeScript caller.
 */
function modeToWireFromString(
  raw: "shared" | "encrypted" | "private",
): WorkspaceModeWire {
  if (raw === "encrypted") return "encrypted";
  if (raw === "private") return "private";
  return "shared";
}

// ── Helpers ──────────────────────────────────────────────────────────

function modeToWire(mode: WorkspaceMode): WorkspaceModeWire {
  if (mode.isShared()) return "shared";
  if (mode.isEncrypted()) return "encrypted";
  return "private";
}

/**
 * Resolves the canonical {@link WorkspaceId} for an MCP `tools/call`
 * invocation, unifying the bootstrap-injected default with the
 * (optional) wire override.
 *
 * Resolution rules (B-MCP-1):
 *   - **Wire absent or empty** → return `injected`. This is the
 *     overwhelmingly common case: real MCP clients (Claude Code,
 *     Cursor, ...) do not pass `workspace_id` on every call; they
 *     expect the server to know its own workspace from the cwd it
 *     was launched in. The bootstrap reads the canonical id from
 *     `<workspaceRoot>/.recall/config.json` and threads it into
 *     every facade adapter at construction.
 *   - **Wire present and valid** → return `WorkspaceId.from(wire)`.
 *     This permits explicit overrides (E2E tests, future
 *     multi-workspace clients).
 *   - **Wire present but malformed** → propagate the
 *     `InvalidInputError` raised by `WorkspaceId.from`. The
 *     dispatcher's error mapper translates it into JSON-RPC
 *     `-32602 INVALID_PARAMS`.
 *
 * The previous behaviour — throwing
 * {@link McpFacadeNotImplementedError} on absent wire input — broke
 * every standard MCP client and is the regression closed by
 * B-MCP-1.
 */
function resolveWorkspaceId(
  injected: WorkspaceId,
  wire: string | undefined,
): WorkspaceId {
  if (wire === undefined || wire.length === 0) return injected;
  return WorkspaceId.from(wire);
}

function recallKindsFromWire(
  raw: RecallInputWire["kinds"],
): readonly QueryKind[] {
  if (raw === undefined) return [];
  const out: QueryKind[] = [];
  for (const kind of raw) {
    if (kind === "any") continue; // protocol's catch-all → empty filter.
    out.push(QueryKind.create(kind));
  }
  return Object.freeze(out);
}

function queryKindToWire(value: QueryKind["value"]): MemoryKindWire {
  // The catalogues match 1:1; this exists for type-system clarity.
  return value;
}

function scopeFromWire(value: "project" | "module"): Scope {
  if (value === "project") return Scope.project();
  // The wire DTO does not carry a per-module name; use a placeholder
  // string the persistence layer accepts (matches how the CLI handles
  // "module" until the full wire shape lands per `docs/02 §4.4`).
  return Scope.module("default");
}

function severityFromWire(value: "tip" | "warning" | "critical"): string {
  return value;
}

const ENTITY_KIND_WIRE_TO_DOMAIN: Readonly<Record<EntityKindWire, string>> =
  Object.freeze({
    struct: "class",
    module: "module",
    service: "service",
    agent: "concept",
    file: "module",
  });

function entityKindFromWire(value: EntityKindWire): EntityKind {
  return EntityKind.create(ENTITY_KIND_WIRE_TO_DOMAIN[value]);
}

function taskPriorityFromWire(value: TaskPriorityWire): TaskPriority {
  if (value === "low") return TaskPriority.low();
  if (value === "medium") return TaskPriority.medium();
  return TaskPriority.high();
}

const WIRE_STATUS_TO_DOMAIN: Readonly<Record<TaskStatusWire, string>> =
  Object.freeze({
    pending: "todo",
    in_progress: "in_progress",
    blocked: "blocked",
    done: "done",
  });

function taskStatusFromWire(value: TaskStatusWire): TaskStatus {
  return TaskStatus.create(WIRE_STATUS_TO_DOMAIN[value]);
}

function taskStatusToWire(status: TaskStatus): TaskStatusWire {
  if (status.isInProgress()) return "in_progress";
  if (status.isBlocked()) return "blocked";
  if (status.isDone()) return "done";
  return "pending";
}

function taskPriorityToWire(priority: TaskPriority): TaskPriorityWire {
  if (priority.kind === "low") return "low";
  if (priority.kind === "high" || priority.kind === "critical") return "high";
  return "medium";
}

function taskToWire(task: Task): TaskWire {
  const description = task.getDescription();
  const completedAt = task.getCompletedAt();
  return {
    id: task.getId().toString(),
    title: task.getTitle().toString(),
    description: description === null ? null : description.toString(),
    status: taskStatusToWire(task.getStatus()),
    priority: taskPriorityToWire(task.getPriority()),
    created_at: task.getCreatedAt().toEpochMs(),
    updated_at: task.getUpdatedAt().toEpochMs(),
    completed_at: completedAt === null ? null : completedAt.toEpochMs(),
    blocked_by: Object.freeze<string[]>([]),
    notes: Object.freeze([]),
    tags: Object.freeze([...task.getTags().toArray()]),
  };
}

async function dispatchTaskTransition(
  useCase: TrackTask,
  workspaceId: WorkspaceId,
  taskId: TaskId,
  status: TaskStatusWire,
): Promise<{ readonly taskId: TaskId }> {
  switch (status) {
    case "in_progress":
      return useCase.start({ workspaceId, taskId });
    case "blocked":
      return useCase.block({ workspaceId, taskId });
    case "done":
      return useCase.complete({ workspaceId, taskId });
    case "pending": {
      // The aggregate models `pending → todo` as `unblock` from
      // `blocked` or as a no-op from `todo`. Wire `pending` thus
      // best maps to `unblock`.
      return useCase.unblock({ workspaceId, taskId });
    }
    default: {
      const exhaustive: never = status;
      void exhaustive;
      throw new McpFacadeNotImplementedError(
        "TrackTaskFacade.update",
        `wire status "${String(status)}" is not modelled by the track-task transitions`,
      );
    }
  }
}

function translateLayerOverrides(
  raw: Readonly<Partial<Record<LayerNameWire, number>>>,
): Readonly<Partial<Record<ContextLayerKindValue, number>>> {
  const out: Partial<Record<ContextLayerKindValue, number>> = {};
  for (const wireName of Object.keys(raw) as readonly LayerNameWire[]) {
    const value = raw[wireName];
    if (typeof value !== "number") continue;
    const domainName = WIRE_TO_DOMAIN_LAYER_NAME[wireName];
    out[domainName] = value;
  }
  return Object.freeze(out);
}

function serialiseLayerPayload(layer: ContextLayer): string {
  // Wire `content` is a free-form string; we render the layer payload
  // as canonical JSON so the boundary stays lossless. The dispatcher
  // is responsible for any further humanisation per `docs/04` §4.
  //
  // Empty layers (entries_count === 0) render as `""` to keep the
  // wire content compact for the "always seven layers" contract
  // documented in `docs/02 §4.2`. The MCP client looks at
  // `entries_count` first to decide whether to render the layer at
  // all.
  if (layer.entriesCount() === 0) return "";
  const value = layer.toValue();
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function deriveTitleFromContent(content: string): string {
  // Take up to the first 80 chars of the first sentence. Mirrors the
  // CLI's own derivation when the user runs `mem.remember` without
  // providing an explicit title.
  const trimmed = content.trim();
  if (trimmed.length === 0) return "Untitled";
  const firstSentence = trimmed.split(/[.!?\n]/, 1)[0] ?? trimmed;
  const candidate = firstSentence.slice(0, 80).trim();
  return candidate.length === 0 ? trimmed.slice(0, 80) : candidate;
}

// Re-export small helpers other adapters may want when extending
// `RememberFacadeAdapter` in Fase 5.
export {
  Confidence as _ConfidenceForRemember,
  taskPriorityToWire as _taskPriorityToWire,
};
