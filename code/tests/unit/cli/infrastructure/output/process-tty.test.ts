import { EventEmitter } from "node:events";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { NonInteractiveStdinError } from "../../../../../src/modules/cli/domain/errors/non-interactive-stdin-error.ts";
import {
  NodeReadlinePrompt,
  ProcessStderr,
  ProcessStdout,
  PromptCancelledError,
} from "../../../../../src/modules/cli/infrastructure/output/process-tty.ts";

describe("ProcessStdout / ProcessStderr", () => {
  let outChunks: string[];
  let errChunks: string[];
  let origStdout: typeof process.stdout.write;
  let origStderr: typeof process.stderr.write;

  beforeEach(() => {
    outChunks = [];
    errChunks = [];
    origStdout = process.stdout.write.bind(process.stdout);
    origStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: unknown) => {
      outChunks.push(String(c));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((c: unknown) => {
      errChunks.push(String(c));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  });

  it("ProcessStdout writes to stdout verbatim", () => {
    new ProcessStdout().write("hello");
    expect(outChunks.join("")).toBe("hello");
  });

  it("ProcessStderr writes to stderr verbatim", () => {
    new ProcessStderr().write("err");
    expect(errChunks.join("")).toBe("err");
  });
});

describe("PromptCancelledError", () => {
  it("has stable code + message", () => {
    const e = new PromptCancelledError();
    expect(e.code).toBe("cli.prompt-cancelled");
    expect(e.message).toContain("cancelada");
    expect(e.name).toBe("PromptCancelledError");
  });
});

describe("NodeReadlinePrompt — confirm parses Spanish + English affirmatives", () => {
  /**
   * The prompt uses node:readline which we cannot easily drive in unit
   * tests without a real TTY. We exercise the `confirm` helper via the
   * `readLine` method which is implemented in terms of readline. The
   * stdin is closed immediately (process.stdin in the vitest worker is
   * not a TTY), making readline yield empty answers — which `confirm`
   * interprets as `false`. We assert the parse logic indirectly:
   * passing crafted strings through a wrapped readLine.
   */
  it("the class is constructable", () => {
    const prompt = new NodeReadlinePrompt();
    expect(typeof prompt.confirm).toBe("function");
    expect(typeof prompt.readLine).toBe("function");
    expect(typeof prompt.readPassphrase).toBe("function");
  });

  it("confirm() built on readLine returns false for non-affirmative", async () => {
    const prompt = new NodeReadlinePrompt();
    // Override readLine for this assertion only — verifies the
    // affirmative-token logic of confirm() without driving stdin.
    const original = prompt.readLine.bind(prompt);
    void original;
    Object.defineProperty(prompt, "readLine", {
       
      value: (_q: string): Promise<string> => Promise.resolve("nope"),
      configurable: true,
    });
    expect(await prompt.confirm("?")).toBe(false);
  });

  it.each([
    ["y", true],
    ["Y", true],
    ["yes", true],
    ["YES", true],
    ["s", true],
    ["si", true],
    ["sí", true],
    ["", false],
    ["n", false],
    ["nope", false],
  ])("confirm('%s') → %p", async (input, expected) => {
    const prompt = new NodeReadlinePrompt();
    Object.defineProperty(prompt, "readLine", {
       
      value: (_q: string): Promise<string> => Promise.resolve(input),
      configurable: true,
    });
    expect(await prompt.confirm("?")).toBe(expected);
  });
});

describe("NodeReadlinePrompt — readPassphrase against a stubbed TTY stdin", () => {
  // The stdin singleton is replaced with a controlled EventEmitter that
  // exposes the subset of `tty.ReadStream` API our adapter touches:
  // `isTTY`, `isRaw`, `setRawMode`, `resume`, `pause`, `setEncoding`,
  // `on`/`off` (inherited from EventEmitter). This exercises the entire
  // raw-mode keystroke loop without requiring a real terminal — the
  // CI worker is non-TTY and would otherwise short-circuit at the guard.
  let origStdin: NodeJS.ReadStream;
  let origStdoutWrite: typeof process.stdout.write;
  let stdoutChunks: string[];

  const buildStubStdin = (): NodeJS.ReadStream => {
    const ee = new EventEmitter();
    let rawMode = false;
    const stub: Partial<NodeJS.ReadStream> & EventEmitter = ee;
    Object.defineProperty(stub, "isTTY", { value: true, configurable: true });
    Object.defineProperty(stub, "isRaw", {
      get: () => rawMode,
      configurable: true,
    });
    (stub as unknown as { setRawMode: (m: boolean) => NodeJS.ReadStream }).setRawMode = (
      mode: boolean,
    ): NodeJS.ReadStream => {
      rawMode = mode;
      return stub as NodeJS.ReadStream;
    };
    (stub as unknown as { resume: () => NodeJS.ReadStream }).resume = (): NodeJS.ReadStream =>
      stub as NodeJS.ReadStream;
    (stub as unknown as { pause: () => NodeJS.ReadStream }).pause = (): NodeJS.ReadStream =>
      stub as NodeJS.ReadStream;
    (stub as unknown as { setEncoding: (e: string) => NodeJS.ReadStream }).setEncoding = (): NodeJS.ReadStream =>
      stub as NodeJS.ReadStream;
    return stub as unknown as NodeJS.ReadStream;
  };

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

  it("collects characters until ENTER, returns buffered passphrase", async () => {
    const stub = installStub();
    const prompt = new NodeReadlinePrompt();
    const promise = prompt.readPassphrase("Pass: ");
    // Allow the microtask queue to settle so the listener is wired.
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "s3cret");
    stub.emit("data", "\n");
    expect(await promise).toBe("s3cret");
    // The prompt banner was written; the trailing newline too.
    expect(stdoutChunks.join("")).toContain("Pass: ");
    expect(stdoutChunks.join("")).toMatch(/\n$/);
  });

  it("accepts CR as the line terminator too", async () => {
    const stub = installStub();
    const prompt = new NodeReadlinePrompt();
    const promise = prompt.readPassphrase("Q: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "abc\r");
    expect(await promise).toBe("abc");
  });

  it("Ctrl-C rejects with PromptCancelledError", async () => {
    const stub = installStub();
    const prompt = new NodeReadlinePrompt();
    const promise = prompt.readPassphrase("Pass: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "ab"); // Ctrl-C after two chars
    await expect(promise).rejects.toBeInstanceOf(PromptCancelledError);
  });

  it("backspace (0x7f) removes the previous character", async () => {
    const stub = installStub();
    const prompt = new NodeReadlinePrompt();
    const promise = prompt.readPassphrase("Pass: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "abcd\n"); // abc, del → "ab", then 'd' → "abd"
    expect(await promise).toBe("abd");
  });

  it("backspace (\\b) is also accepted as delete", async () => {
    const stub = installStub();
    const prompt = new NodeReadlinePrompt();
    const promise = prompt.readPassphrase("P: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "xy\bz\n"); // xy, \b → "x", then 'z' → "xz"
    expect(await promise).toBe("xz");
  });

  it("backspace on empty buffer is a no-op (no underflow)", async () => {
    const stub = installStub();
    const prompt = new NodeReadlinePrompt();
    const promise = prompt.readPassphrase("P: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "hi\n");
    expect(await promise).toBe("hi");
  });

  it("multiple emits accumulate into one buffer", async () => {
    const stub = installStub();
    const prompt = new NodeReadlinePrompt();
    const promise = prompt.readPassphrase("P: ");
    await new Promise((r) => setImmediate(r));
    stub.emit("data", "a");
    stub.emit("data", "b");
    stub.emit("data", "c\n");
    expect(await promise).toBe("abc");
  });
});

describe("NodeReadlinePrompt — non-TTY guard (B-CLI-4)", () => {
  // The vitest worker process has `process.stdin.isTTY === undefined`
  // (stdin is piped from the parent), which is exactly the condition
  // we want to refuse upfront. We assert the guard fires WITHOUT
  // hitting `readline`, which would otherwise hang.
  //
  // Why we don't bother stubbing `process.stdin.isTTY = true`:
  //   - Even if we set the flag, `readline.createInterface` would
  //     still observe the underlying piped stream and might block on
  //     a non-existent TTY. The test would either hang or assert
  //     against a different code path. The two assertions we care
  //     about (refuses on non-TTY, message guides the caller) are
  //     fully exercised against the real piped stdin.
  it("readLine throws NonInteractiveStdinError when stdin is not a TTY", async () => {
    const prompt = new NodeReadlinePrompt();
    expect(process.stdin.isTTY).not.toBe(true); // sanity check
    await expect(prompt.readLine("Q: ")).rejects.toBeInstanceOf(
      NonInteractiveStdinError,
    );
  });

  it("readPassphrase throws NonInteractiveStdinError when stdin is not a TTY", async () => {
    const prompt = new NodeReadlinePrompt();
    await expect(prompt.readPassphrase("Pass: ")).rejects.toBeInstanceOf(
      NonInteractiveStdinError,
    );
  });

  it("the error message tells the caller how to recover", async () => {
    const prompt = new NodeReadlinePrompt();
    try {
      await prompt.readLine("Workspace: ");
      expect.fail("expected readLine to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(NonInteractiveStdinError);
      const message = (err as Error).message;
      // The message should reference both --non-interactive and
      // suggest the user can also re-run from a real terminal. The
      // exact wording can change; the structural cues should not.
      expect(message).toMatch(/--non-interactive/);
      expect(message).toMatch(/terminal interactiva/);
      // The original prompt text should be quoted so a user piping
      // through a wrapper can identify which prompt aborted.
      expect(message).toContain("Workspace:");
    }
  });

  it("NonInteractiveStdinError exposes the stable code", () => {
    const e = new NonInteractiveStdinError("Q:");
    expect(e.code).toBe("cli.stdin-not-a-tty");
    expect(e.jsonRpcCode).toBeNull();
  });
});
