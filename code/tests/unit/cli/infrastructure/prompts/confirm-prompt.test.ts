import { EventEmitter } from "node:events";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { CliInfrastructureError } from "../../../../../src/modules/cli/infrastructure/errors/cli-infrastructure-error.ts";
import {
  confirmPassphrase,
  constantTimeEqualPadded,
} from "../../../../../src/modules/cli/infrastructure/prompts/confirm-prompt.ts";

function buildStubStdin(): NodeJS.ReadStream {
  const ee = new EventEmitter();
  let rawMode = false;
  const stub: Partial<NodeJS.ReadStream> & EventEmitter = ee;
  Object.defineProperty(stub, "isTTY", { value: true, configurable: true });
  Object.defineProperty(stub, "isRaw", {
    get: () => rawMode,
    configurable: true,
  });
  (
    stub as unknown as { setRawMode: (m: boolean) => NodeJS.ReadStream }
  ).setRawMode = (mode: boolean): NodeJS.ReadStream => {
    rawMode = mode;
    return stub as NodeJS.ReadStream;
  };
  (stub as unknown as { resume: () => NodeJS.ReadStream }).resume = (): NodeJS.ReadStream =>
    stub as NodeJS.ReadStream;
  (stub as unknown as { pause: () => NodeJS.ReadStream }).pause = (): NodeJS.ReadStream =>
    stub as NodeJS.ReadStream;
  (
    stub as unknown as { setEncoding: (e: string) => NodeJS.ReadStream }
  ).setEncoding = (): NodeJS.ReadStream => stub as NodeJS.ReadStream;
  return stub as unknown as NodeJS.ReadStream;
}

describe("constantTimeEqualPadded — pure semantics", () => {
  it("returns true for byte-identical buffers of equal length", () => {
    const a = Buffer.from("correct-horse-battery-staple", "utf8");
    const b = Buffer.from("correct-horse-battery-staple", "utf8");
    expect(constantTimeEqualPadded(a, b)).toBe(true);
  });

  it("returns false for buffers of equal length but different bytes", () => {
    const a = Buffer.from("correct-horse-battery-staple", "utf8");
    const b = Buffer.from("correct-horse-battery-stAple", "utf8");
    expect(constantTimeEqualPadded(a, b)).toBe(false);
  });

  it("returns false (without throwing) when lengths differ", () => {
    const a = Buffer.from("short", "utf8");
    const b = Buffer.from("a-much-longer-passphrase", "utf8");
    expect(constantTimeEqualPadded(a, b)).toBe(false);
    // Symmetric: longer-first must yield the same answer (no
    // length-based branch leaks through the return value).
    expect(constantTimeEqualPadded(b, a)).toBe(false);
  });

  it("treats empty + non-empty as not equal", () => {
    expect(
      constantTimeEqualPadded(Buffer.alloc(0), Buffer.from("x", "utf8")),
    ).toBe(false);
  });

  it("returns true for two empty buffers", () => {
    expect(constantTimeEqualPadded(Buffer.alloc(0), Buffer.alloc(0))).toBe(
      true,
    );
  });
});

describe("confirmPassphrase — happy path and mismatch", () => {
  let origStdin: NodeJS.ReadStream;
  let origStdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    origStdin = process.stdin;
    origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((_c: unknown) => true) as typeof process.stdout.write;
  });

  afterEach(() => {
    Object.defineProperty(process, "stdin", {
      value: origStdin,
      configurable: true,
    });
    process.stdout.write = origStdoutWrite;
  });

  it("returns the agreed passphrase when both entries match", async () => {
    const stub = buildStubStdin();
    Object.defineProperty(process, "stdin", {
      value: stub,
      configurable: true,
    });
    const promise = confirmPassphrase("First: ", "Confirm: ");
    // Stage 1 — first prompt.
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "correct-horse-battery-staple\n");
    // Stage 2 — second prompt. Allow the chained promise to wire up.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "correct-horse-battery-staple\n");
    const buf = await promise;
    expect(buf.toString("utf8")).toBe("correct-horse-battery-staple");
  });

  it("throws cli.passphrase-mismatch when the entries differ", async () => {
    const stub = buildStubStdin();
    Object.defineProperty(process, "stdin", {
      value: stub,
      configurable: true,
    });
    const promise = confirmPassphrase("First: ", "Confirm: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "first-entry-12chars\n");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "second-entry-mismatched\n");
    let captured: unknown = null;
    try {
      await promise;
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CliInfrastructureError);
    expect((captured as CliInfrastructureError).code).toBe(
      "cli.passphrase-mismatch",
    );
    // The user-facing message must NOT echo either entry back (we
    // assert by checking the message does not contain the
    // identifiable substrings).
    const msg = (captured as Error).message;
    expect(msg).not.toContain("first-entry");
    expect(msg).not.toContain("second-entry");
    expect(msg).toContain("no coinciden");
  });

  it("throws when stdin is not a TTY (propagates the upstream error)", async () => {
    // Restore the worker's actual stdin (non-TTY).
    Object.defineProperty(process, "stdin", {
      value: origStdin,
      configurable: true,
    });
    await expect(confirmPassphrase("A: ", "B: ")).rejects.toMatchObject({
      code: "cli.no-tty-for-passphrase",
    });
  });
});

describe("confirmPassphrase — zeroisation of intermediate buffer on success", () => {
  let origStdin: NodeJS.ReadStream;
  let origStdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    origStdin = process.stdin;
    origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((_c: unknown) => true) as typeof process.stdout.write;
  });

  afterEach(() => {
    Object.defineProperty(process, "stdin", {
      value: origStdin,
      configurable: true,
    });
    process.stdout.write = origStdoutWrite;
  });

  /**
   * Behavioural assertion (not shape): when both entries match,
   * `confirmPassphrase` MUST return a usable buffer to the caller.
   * The second buffer's zeroisation is an internal side-effect we
   * cannot reach from outside the function (it goes out of scope).
   * We assert the consequence we CAN observe: the returned buffer
   * still carries the agreed bytes (so it is not the zeroed second
   * buffer accidentally returned in place of the first).
   */
  it("returns a live, non-zeroed buffer carrying the agreed bytes", async () => {
    const stub = buildStubStdin();
    Object.defineProperty(process, "stdin", {
      value: stub,
      configurable: true,
    });
    const promise = confirmPassphrase("A: ", "B: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "alpha-bravo-charlie\n");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "alpha-bravo-charlie\n");
    const buf = await promise;
    // Live, non-zero bytes: every byte should match the input.
    expect(buf.toString("utf8")).toBe("alpha-bravo-charlie");
    // Direct byte check that the buffer is NOT all-zero.
    let allZero = true;
    for (const byte of buf) {
      if (byte !== 0) {
        allZero = false;
        break;
      }
    }
    expect(allZero).toBe(false);
  });
});
