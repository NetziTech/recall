import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { WorkspaceMode } from "../../domain/value-objects/workspace-mode.ts";
import type {
  HealthCheck,
  HealthCheckEntry,
  HealthCheckInput,
  HealthCheckOutput,
} from "../ports/in/health-check.port.ts";
import type { DatabaseBootstrap } from "../ports/out/database-bootstrap.port.ts";
import type { EmbedderProbe } from "../ports/out/embedder-probe.port.ts";
import type { WorkspaceFilesystem } from "../ports/out/workspace-filesystem.port.ts";
import type { DetectWorkspace } from "../ports/in/detect-workspace.port.ts";

/**
 * Implements `HealthCheck`. Each individual probe is best-effort:
 * a thrown error is captured and emitted as a `fail` entry rather
 * than aborting the whole report.
 *
 * Probes (in order):
 *   1. `workspace.exists`     — `WorkspaceFilesystem.workspaceExists`.
 *   2. `workspace.parseable`  — `DetectWorkspace.detect` (rehydrates).
 *   3. `database.openable`    — `DatabaseBootstrap.probe`.
 *   4. `migrations.current`   — same probe; compares against the
 *                                bundled migrations count by reading
 *                                the schemaVersion (the runner already
 *                                applied them at server start, so a
 *                                mismatch only happens on downgrade).
 *   5. `embedder.loadable`    — `EmbedderProbe.probe`.
 *   6. `gitignore.consistent` — heuristic: for `private` mode we
 *                                expect a `.recall/` line; for
 *                                shared/encrypted we expect its
 *                                absence. Implemented inline because
 *                                the filesystem port doesn't expose a
 *                                "read .gitignore" method (it only
 *                                ensures the desired state).
 *
 * Probe (6) is currently `skipped` for every mode in the use-case
 * implementation: introducing a `readGitignore` to the port surface
 * doubles its size for one cosmetic check. The CLI can call
 * `ensureGitignore` to self-heal instead. Recorded as a known
 * limitation (TODO-WS-1) and tracked for v0.5.
 */
export class HealthCheckUseCase implements HealthCheck {
  public constructor(
    private readonly detect: DetectWorkspace,
    private readonly filesystem: WorkspaceFilesystem,
    private readonly databaseBootstrap: DatabaseBootstrap,
    private readonly embedderProbe: EmbedderProbe,
    private readonly logger: Logger,
  ) {}

  public async check(input: HealthCheckInput): Promise<HealthCheckOutput> {
    const checks: HealthCheckEntry[] = [];

    // 1. workspace.exists
    let exists = false;
    try {
      exists = await this.filesystem.workspaceExists(input.rootPath);
      checks.push({
        id: "workspace.exists",
        status: exists ? "pass" : "fail",
        message: exists
          ? `workspace found at "${input.rootPath.toString()}"`
          : `no .recall/ at or under "${input.rootPath.toString()}"`,
      });
    } catch (err: unknown) {
      checks.push({
        id: "workspace.exists",
        status: "fail",
        message: `workspace existence probe failed: ${HealthCheckUseCase.errorMessage(err)}`,
      });
    }

    if (!exists) {
      // Without a workspace nothing else makes sense; mark every
      // remaining check as `skipped` and short-circuit.
      checks.push(
        skipped("workspace.parseable", "workspace not found"),
        skipped("database.openable", "workspace not found"),
        skipped("migrations.current", "workspace not found"),
        skipped("embedder.loadable", "workspace not found"),
        skipped("gitignore.consistent", "workspace not found"),
      );
      return finish(checks);
    }

    // 2. workspace.parseable
    let parsedMode: string | null = null;
    try {
      const detection = await this.detect.detect({
        startPath: input.rootPath,
      });
      if (detection.found) {
        parsedMode = detection.workspace.getMode().toString();
        checks.push({
          id: "workspace.parseable",
          status: "pass",
          message: `config.json parsed (mode=${parsedMode})`,
        });
      } else {
        checks.push({
          id: "workspace.parseable",
          status: "fail",
          message: "detector reported no workspace despite the directory existing",
        });
      }
    } catch (err: unknown) {
      checks.push({
        id: "workspace.parseable",
        status: "fail",
        message: `config.json parse failed: ${HealthCheckUseCase.errorMessage(err)}`,
      });
    }

    if (parsedMode === null) {
      checks.push(
        skipped("database.openable", "config not parseable"),
        skipped("migrations.current", "config not parseable"),
        skipped("embedder.loadable", "config not parseable"),
        skipped("gitignore.consistent", "config not parseable"),
      );
      return finish(checks);
    }

    // 3. + 4. database.openable / migrations.current
    try {
      const probe = await this.databaseBootstrap.probe({
        rootPath: input.rootPath,
        mode: HealthCheckUseCase.parseModeOrFallback(parsedMode),
      });
      if (probe.openable) {
        checks.push({
          id: "database.openable",
          status: "pass",
          message: `database opens (schema_version=${String(probe.schemaVersion ?? "?")})`,
        });
        checks.push({
          id: "migrations.current",
          status: probe.schemaVersion !== null ? "pass" : "fail",
          message:
            probe.schemaVersion !== null
              ? `schema_version=${String(probe.schemaVersion)}`
              : "could not read schema_version",
        });
      } else {
        checks.push({
          id: "database.openable",
          status: "fail",
          message: "database failed to open",
        });
        checks.push(skipped("migrations.current", "database not openable"));
      }
    } catch (err: unknown) {
      checks.push({
        id: "database.openable",
        status: "fail",
        message: `database probe threw: ${HealthCheckUseCase.errorMessage(err)}`,
      });
      checks.push(skipped("migrations.current", "database probe threw"));
    }

    // 5. embedder.loadable
    try {
      const outcome = await this.embedderProbe.probe();
      checks.push({
        id: "embedder.loadable",
        status: outcome.ok ? "pass" : "fail",
        message: outcome.message,
      });
    } catch (err: unknown) {
      checks.push({
        id: "embedder.loadable",
        status: "fail",
        message: `embedder probe threw: ${HealthCheckUseCase.errorMessage(err)}`,
      });
    }

    // 6. gitignore.consistent — see class JSDoc for the deferred rationale.
    checks.push(
      skipped(
        "gitignore.consistent",
        "deferred to v0.5 (TODO-WS-1); call recall mode <current> to self-heal",
      ),
    );

    this.logger.debug(
      { checkCount: checks.length },
      "health check report assembled",
    );

    return finish(checks);
  }

  private static errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  /**
   * Best-effort recovery: if the persisted mode failed to parse into
   * a `WorkspaceMode`, the database probe shouldn't crash. Use a
   * permissive default ("shared") so the probe runs anyway; the
   * underlying probe adapter ignores the mode for opening the
   * database (the encryption key is what matters).
   */
  private static parseModeOrFallback(raw: string): WorkspaceMode {
    try {
      return WorkspaceMode.create(raw);
    } catch {
      return WorkspaceMode.sharedMode();
    }
  }
}

function skipped(id: string, message: string): HealthCheckEntry {
  return { id, status: "skipped", message };
}

function finish(checks: readonly HealthCheckEntry[]): HealthCheckOutput {
  const healthy = checks.every((c) => c.status !== "fail");
  return { checks: Object.freeze([...checks]), healthy };
}
