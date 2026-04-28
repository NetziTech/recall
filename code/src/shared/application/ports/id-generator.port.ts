import type { Id } from "../../domain/value-objects/id.ts";

/**
 * Driven (output) port for generating fresh entity identifiers.
 *
 * Why this lives in `shared/application/ports/`:
 * - Every module needs to mint UUID v7 ids for the aggregates it
 *   owns: `WorkspaceId`, `DecisionId`, `LearningId`, `EntityId`,
 *   `TaskId`, `TurnId`, `SessionId`, `RelationId`, `BundleId`,
 *   `CuratorRunId`, `AuditEventId`, `KeyId`, etc. Per
 *   `docs/12-lineamientos-arquitectura.md` §1.5 Regla 3 the port
 *   lives in `shared/`.
 * - The whole codebase pins UUID v7 (sortable by time, see
 *   `shared/domain/value-objects/id.ts`); the implementation choice
 *   (`uuid` package, `@noble/hashes`, native `crypto.randomUUID`
 *   when v7 lands) is an infrastructure concern.
 *
 * Why this matters (DDD + testability):
 * - The domain is forbidden from calling `crypto.randomUUID()` or
 *   `uuidv7()` directly. Doing so couples every aggregate to a
 *   non-deterministic source, making the test suite flaky and the
 *   composition root unable to control ordering.
 * - Injecting an `IdGenerator` port lets tests use a `FakeIdGenerator`
 *   that yields a predictable sequence of UUIDs (e.g.
 *   "00000000-0000-7000-8000-000000000001",
 *   "00000000-0000-7000-8000-000000000002", ...). Snapshot tests of
 *   recall results, of context bundles, and of curator runs become
 *   trivial.
 *
 * Implementation expectations (per Fase 2 task `2.2-shared-infrastructure`):
 * - `shared/infrastructure/id/uuid-v7-generator.ts` wraps the `uuid`
 *   package's v7 generator (see `docs/06-stack-tecnico.md` §9 — the
 *   `uuid` package is in `package.json`).
 * - The adapter MUST emit lowercase, canonical UUID v7 strings so
 *   that `Id.normalize` accepts them without a second pass.
 *
 * Why two methods (`generate` and `generateString`):
 * - `generate()` returns the typed `Id<TBrand>` and is the preferred
 *   path for use cases that hand the id straight to an aggregate
 *   factory (e.g. `Decision.record(idGenerator.generate(), ...)`).
 *   This keeps the brand discipline through the call chain.
 * - `generateString()` returns the raw UUID v7 string and is the
 *   escape hatch for repository adapters that need to interpolate
 *   the id into a SQL parameter slot before any branded type is
 *   convenient (e.g. when bulk-inserting through better-sqlite3
 *   prepared statements that accept `unknown[]`). The brand can be
 *   re-attached later via `XxxId.from(raw)`.
 *
 * Test doubles (live in `tests/fixtures/`):
 * - `FakeIdGenerator(seed)` yields a deterministic sequence — used
 *   by every unit test that asserts ids on freshly minted
 *   aggregates.
 * - `RecordingIdGenerator(realGenerator)` proxies to a real adapter
 *   while recording every emitted id; used by integration tests
 *   that need real UUIDs but also want to assert "exactly N ids
 *   were generated during this scenario".
 */
export interface IdGenerator {
  /**
   * Generates a fresh UUID v7 wrapped in an `Id<TBrand>`.
   *
   * The brand `TBrand` is supplied by the caller via type inference
   * at the call site (no runtime parameter): the generator does not
   * inspect or enforce brands at runtime; it only produces a valid
   * UUID v7 string and trusts the caller to land it in the right
   * typed slot. The brand check is a compile-time discipline owned
   * by `shared/domain/value-objects/id.ts`.
   */
  generate<TBrand extends string>(): Id<TBrand>;

  /**
   * Generates a fresh UUID v7 as a raw lowercase string.
   *
   * Used by repository adapters that need to bind the id directly to
   * a SQL parameter slot or serialise it to disk without the
   * branded-type ceremony.
   */
  generateString(): string;
}
