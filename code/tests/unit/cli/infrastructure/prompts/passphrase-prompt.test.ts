import { EventEmitter } from "node:events";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { CliInfrastructureError } from "../../../../../src/modules/cli/infrastructure/errors/cli-infrastructure-error.ts";
import {
  assertTty,
  readPassphrase,
} from "../../../../../src/modules/cli/infrastructure/prompts/passphrase-prompt.ts";

/** ASCII DEL (0x7f) — the default "backspace" keycode on macOS/iTerm. */
const DEL = "";
/** ASCII BS  (0x08) — the legacy Ctrl-H "backspace" on some terminals. */
const BS = "";
/** ASCII ETX (0x03) — Ctrl-C. */
const ETX = "";

/**
 * Build a stub stdin that mimics the subset of `tty.ReadStream` the
 * adapter touches. Same pattern as the one used in
 * `process-tty.test.ts` — the worker has `process.stdin.isTTY ===
 * undefined`, so without this stub every test would short-circuit at
 * the guard before exercising the keystroke loop.
 */
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

describe("assertTty", () => {
  it("throws CliInfrastructureError with code cli.no-tty-for-passphrase when stdin is not a TTY", () => {
    // The vitest worker's process.stdin.isTTY is undefined.
    expect(process.stdin.isTTY).not.toBe(true);
    let captured: unknown = null;
    try {
      assertTty("Passphrase: ");
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CliInfrastructureError);
    expect((captured as CliInfrastructureError).code).toBe(
      "cli.no-tty-for-passphrase",
    );
    expect((captured as Error).message).toContain("Passphrase");
    expect((captured as Error).message).toContain("terminal interactiva");
  });

  it("returns nothing when stdin is a TTY", () => {
    const origStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: buildStubStdin(),
      configurable: true,
    });
    try {
      expect(() => assertTty("Q: ")).not.toThrow();
    } finally {
      Object.defineProperty(process, "stdin", {
        value: origStdin,
        configurable: true,
      });
    }
  });
});

describe("readPassphrase — TTY guard", () => {
  it("rejects with cli.no-tty-for-passphrase when stdin is not a TTY", async () => {
    await expect(readPassphrase("Pass: ")).rejects.toMatchObject({
      code: "cli.no-tty-for-passphrase",
    });
  });
});

describe("readPassphrase — happy path against stubbed TTY", () => {
  let origStdin: NodeJS.ReadStream;
  let origStdoutWrite: typeof process.stdout.write;
  let stdoutChunks: string[];

  beforeEach(() => {
    origStdin = process.stdin;
    origStdoutWrite = process.stdout.write.bind(process.stdout);
    stdoutChunks = [];
    process.stdout.write = ((c: unknown) => {
      stdoutChunks.push(String(c));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    Object.defineProperty(process, "stdin", {
      value: origStdin,
      configurable: true,
    });
    process.stdout.write = origStdoutWrite;
  });

  const installStub = (): NodeJS.ReadStream => {
    const stub = buildStubStdin();
    Object.defineProperty(process, "stdin", {
      value: stub,
      configurable: true,
    });
    return stub;
  };

  it("collects keystrokes until LF and returns a Buffer of the UTF-8 bytes", async () => {
    const stub = installStub();
    const promise = readPassphrase("Pass: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "s3cret-passphrase-Z9");
    stub.emit("data", "\n");
    const buf = await promise;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString("utf8")).toBe("s3cret-passphrase-Z9");
    // No keystrokes echoed: the prompt banner is the only thing on stdout
    // (plus the trailing newline once entry completes).
    const out = stdoutChunks.join("");
    expect(out).toContain("Pass: ");
    expect(out).not.toContain("s3cret");
    expect(out).toMatch(/\n$/);
  });

  it("accepts CR as the line terminator too", async () => {
    const stub = installStub();
    const promise = readPassphrase("Q: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "abcdefghij12\r");
    expect((await promise).toString("utf8")).toBe("abcdefghij12");
  });

  it("backspace 0x7f (DEL) deletes the previous character", async () => {
    const stub = installStub();
    const promise = readPassphrase("P: ");
    await new Promise((r) => setImmediate(r));
    // Typed "abcd", DEL, then 'X' then enter → "abcX"
    stub.emit("data", `abcd${DEL}X\n`);
    expect((await promise).toString("utf8")).toBe("abcX");
  });

  it("backspace 0x08 (\\b) also deletes one character", async () => {
    const stub = installStub();
    const promise = readPassphrase("P: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", `xy${BS}z\n`);
    expect((await promise).toString("utf8")).toBe("xz");
  });

  it("backspace on empty buffer is a no-op (no underflow)", async () => {
    const stub = installStub();
    const promise = readPassphrase("P: ");
    await new Promise((r) => setImmediate(r));
    // Send DEL before any character; the buffer must stay empty,
    // then the real input must still be collected.
    stub.emit("data", `${DEL}${DEL}${DEL}hi\n`);
    expect((await promise).toString("utf8")).toBe("hi");
  });

  it("normalises decomposed Unicode to NFKC", async () => {
    const stub = installStub();
    const promise = readPassphrase("P: ");
    await new Promise((r) => setImmediate(r));
    // Build the decomposed form with explicit escapes so the source
    // file does not depend on editor normalisation: "passphras" + 'e'
    // (U+0065) + combining acute (U+0301) = decomposed "é".
    const decomposed = "passphras\u0065\u0301";
    // After NFKC the buffer carries the precomposed é (U+00E9).
    const expectedPrecomposed = "passphras\u00e9";
    stub.emit("data", decomposed);
    stub.emit("data", "\n");
    const buf = await promise;
    expect(buf.toString("utf8")).toBe(expectedPrecomposed);
    // Precomposed é is two UTF-8 bytes (0xC3 0xA9); decomposed would
    // have been three (0x65 0xCC 0x81). Length is the load-bearing
    // assertion that NFKC actually ran.
    expect(buf.length).toBe(
      Buffer.from(expectedPrecomposed, "utf8").length,
    );
    expect(buf.length).toBeLessThan(
      Buffer.from(decomposed, "utf8").length,
    );
  });

  it("Ctrl-C invokes process.exit(130) without echoing the partial entry", async () => {
    const stub = installStub();
    // Mock exit as a no-op (instead of throwing). The data listener
    // will fall through after the (mocked) exit call returns, but the
    // for-of loop has already cleaned up and the assertion we care
    // about is purely that exitSpy was invoked with code 130. The
    // outer promise stays pending — we don't await it.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number): never => undefined as never));
    try {
      void readPassphrase("P: ");
      await new Promise((r) => setImmediate(r));
      stub.emit("data", `partial${ETX}`); // partial entry, then Ctrl-C
      // Allow the listener to run.
      await new Promise((r) => setImmediate(r));
      expect(exitSpy).toHaveBeenCalledWith(130);
      // Behavioural assertion that the partial bytes were not echoed
      // back to stdout (the prompt MUST never leak keystrokes).
      const out = stdoutChunks.join("");
      expect(out).not.toContain("partial");
      // The prompt did emit its banner and a trailing newline (after
      // the Ctrl-C handler ran).
      expect(out).toContain("P: ");
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("rejects with cli.weak-passphrase when the entry exceeds 1024 UTF-8 bytes", async () => {
    const stub = installStub();
    const promise = readPassphrase("P: ");
    await new Promise((r) => setImmediate(r));
    // 1025 single-byte ASCII characters → 1025 UTF-8 bytes, just above
    // MAX_PASSPHRASE_BYTES (1024).
    const huge = "a".repeat(1025);
    stub.emit("data", huge);
    stub.emit("data", "\n");
    await expect(promise).rejects.toMatchObject({
      code: "cli.weak-passphrase",
    });
  });

  it("returned buffer carries the agreed bytes recoverable as UTF-8", async () => {
    const stub = installStub();
    const promise = readPassphrase("P: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "abcdefghij\n");
    const buf = await promise;
    // Sanity: the contents are recoverable as UTF-8.
    expect(buf.toString("utf8")).toBe("abcdefghij");
    // Length matches the encoded UTF-8 byte count (10 ASCII bytes).
    expect(buf.length).toBe(10);
  });
});
