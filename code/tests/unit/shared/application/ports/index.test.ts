import { describe, it, expectTypeOf } from "vitest";

import type {
  Clock,
  DatabaseConnection,
  Embedder,
  EventPublisher,
  IdGenerator,
  Logger,
  LogPayload,
  PreparedStatement,
  RawEmbedding,
  RunResult,
} from "../../../../../src/shared/application/ports/index.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { Id } from "../../../../../src/shared/domain/value-objects/id.ts";
import type { DomainEvent } from "../../../../../src/shared/domain/types/domain-event.ts";

/**
 * Smoke tests asserting the public types of `shared/application/ports`
 * compile and expose the methods their JSDoc documents. A port that
 * silently lost a method would otherwise only surface at adapter wiring
 * time. Coverage for these interfaces comes naturally from adapter
 * tests; here we keep a compile-time sanity net.
 */
describe("shared/application/ports surface", () => {
  it("Clock exposes now(): Timestamp and nowMs(): number", () => {
    expectTypeOf<Clock["now"]>().returns.toEqualTypeOf<Timestamp>();
    expectTypeOf<Clock["nowMs"]>().returns.toEqualTypeOf<number>();
  });

  it("IdGenerator exposes generate<T>() and generateString()", () => {
    expectTypeOf<IdGenerator["generateString"]>().returns.toEqualTypeOf<string>();
    expectTypeOf<IdGenerator["generate"]>().returns.toMatchTypeOf<Id<string>>();
  });

  it("Logger exposes the six severity levels and child", () => {
    type Levels = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
    expectTypeOf<keyof Logger>().toMatchTypeOf<Levels | "child">();
    expectTypeOf<LogPayload>().toMatchTypeOf<Readonly<Record<string, unknown>>>();
  });

  it("DatabaseConnection exposes prepare/exec/transaction/close", () => {
    type Ks = "prepare" | "exec" | "transaction" | "close";
    expectTypeOf<keyof DatabaseConnection>().toEqualTypeOf<Ks>();

    expectTypeOf<PreparedStatement["run"]>().returns.toEqualTypeOf<RunResult>();
  });

  it("Embedder exposes embed/embedBatch/dimension", () => {
    expectTypeOf<Embedder["dimension"]>().returns.toEqualTypeOf<number>();
    expectTypeOf<Embedder["embed"]>().returns.toEqualTypeOf<Promise<RawEmbedding>>();
    expectTypeOf<Embedder["embedBatch"]>().returns.toEqualTypeOf<
      Promise<readonly RawEmbedding[]>
    >();
  });

  it("EventPublisher exposes publish/publishAll", () => {
    expectTypeOf<EventPublisher["publish"]>().parameters.toEqualTypeOf<
      [DomainEvent]
    >();
    expectTypeOf<EventPublisher["publishAll"]>().parameters.toEqualTypeOf<
      [readonly DomainEvent[]]
    >();
  });
});
