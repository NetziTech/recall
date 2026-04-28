/**
 * Lightweight in-memory test doubles for ports that do not have a
 * canonical FakeXxx implementation in shared/infrastructure.
 *
 * These are co-located with the tests because they are NOT a part of
 * the production shape (they would never be wired by the composition
 * root) — they exist purely so individual use-case tests can isolate
 * the unit under test.
 */
import type { DomainEvent } from "../../src/shared/domain/types/domain-event.ts";
import type { EventPublisher } from "../../src/shared/application/ports/event-publisher.port.ts";
import type {
  LogPayload,
  Logger,
} from "../../src/shared/application/ports/logger.port.ts";

/** Recording publisher that keeps every published event in order. */
export class RecordingEventPublisher implements EventPublisher {
  public readonly events: DomainEvent[] = [];

  public publish(event: DomainEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  public publishAll(events: readonly DomainEvent[]): Promise<void> {
    for (const e of events) this.events.push(e);
    return Promise.resolve();
  }

  public published(): readonly DomainEvent[] {
    return [...this.events];
  }

  public clear(): void {
    this.events.length = 0;
  }
}

/** No-op logger — every call is a no-op. */
export class SilentLogger implements Logger {
  public trace(payload: LogPayload | string, message?: string): void {
    void payload;
    void message;
  }

  public debug(payload: LogPayload | string, message?: string): void {
    void payload;
    void message;
  }

  public info(payload: LogPayload | string, message?: string): void {
    void payload;
    void message;
  }

  public warn(payload: LogPayload | string, message?: string): void {
    void payload;
    void message;
  }

  public error(payload: LogPayload | string, message?: string): void {
    void payload;
    void message;
  }

  public fatal(payload: LogPayload | string, message?: string): void {
    void payload;
    void message;
  }

  public child(bindings: LogPayload): Logger {
    void bindings;
    return this;
  }
}
