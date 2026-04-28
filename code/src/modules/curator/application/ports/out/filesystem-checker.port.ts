import type { PathStaleness } from "../../../domain/value-objects/path-staleness.ts";

/**
 * Driven (output) port for probing whether a path exists on the
 * workspace's filesystem.
 *
 * The default adapter
 * (`NodeFilesystemChecker` in
 * `modules/curator/infrastructure/filesystem/`) uses Node's
 * `fs.stat` and resolves relative paths against the workspace
 * root (the constructor takes the canonicalised root, baked at
 * composition time, per the contract documented on
 * `modules/curator/domain/services/path-checker.ts`).
 *
 * This port is the application-layer surface; the existing
 * `PathChecker` interface in
 * `modules/curator/domain/services/path-checker.ts` is the domain
 * surface. They are intentionally redundant: the domain port lives
 * with the rest of the curator's domain services so the
 * `SelfHealUseCase` (in application) can depend on it directly,
 * while this `.port.ts` file makes the same surface visible from
 * the application boundary for the composition root's wiring
 * convenience and for the convention sweep
 * (`docs/12-lineamientos-arquitectura.md` §3.1 — `.port.ts` for every
 * port). Adapters implement BOTH names and the composition root
 * binds them to a single instance.
 */
export interface FilesystemChecker {
  /**
   * Probes `paths` and returns one `PathStaleness` per input, in the
   * same order. The contract is identical to the domain `PathChecker`
   * interface; see the JSDoc on
   * `modules/curator/domain/services/path-checker.ts` for the
   * detailed semantics (workspace-root resolution, error mapping,
   * etc.).
   */
  checkPaths(paths: readonly string[]): Promise<readonly PathStaleness[]>;
}
