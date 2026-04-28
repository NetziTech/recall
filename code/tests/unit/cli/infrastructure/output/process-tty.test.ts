import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      value: (_q: string): Promise<string> => Promise.resolve(input),
      configurable: true,
    });
    expect(await prompt.confirm("?")).toBe(expected);
  });
});
