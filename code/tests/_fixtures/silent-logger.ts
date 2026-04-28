/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  Logger,
  LogPayload,
} from "../../src/shared/application/ports/logger.port.ts";

/**
 * Recording logger for tests. Captures every call so assertions can
 * verify side-effects (or simply suppress noise).
 */
export interface LogEntry {
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  payload: LogPayload | string;
  message: string | undefined;
}

export class RecordingLogger implements Logger {
  public readonly entries: LogEntry[] = [];

  public trace(payload: LogPayload | string, message?: string): void {
    this.entries.push({ level: "trace", payload, message });
  }
  public debug(payload: LogPayload | string, message?: string): void {
    this.entries.push({ level: "debug", payload, message });
  }
  public info(payload: LogPayload | string, message?: string): void {
    this.entries.push({ level: "info", payload, message });
  }
  public warn(payload: LogPayload | string, message?: string): void {
    this.entries.push({ level: "warn", payload, message });
  }
  public error(payload: LogPayload | string, message?: string): void {
    this.entries.push({ level: "error", payload, message });
  }
  public fatal(payload: LogPayload | string, message?: string): void {
    this.entries.push({ level: "fatal", payload, message });
  }
  public child(_bindings: LogPayload): Logger {
    return this;
  }
}
