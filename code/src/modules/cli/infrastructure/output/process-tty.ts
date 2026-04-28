import * as readline from "node:readline/promises";
import process from "node:process";

import { NonInteractiveStdinError } from "../../domain/errors/non-interactive-stdin-error.ts";
import type {
  Prompt,
  Stderr,
  Stdout,
} from "../../application/ports/out/tty.port.ts";

/**
 * Concrete `Stdout` writing to `process.stdout`.
 *
 * The implementation is a one-liner; the wrapper exists so use cases
 * can be unit-tested with a `RecordingStdout` test double instead of
 * monkey-patching the global.
 */
export class ProcessStdout implements Stdout {
  public write(text: string): void {
    process.stdout.write(text);
  }
}

/**
 * Concrete `Stderr` writing to `process.stderr`.
 */
export class ProcessStderr implements Stderr {
  public write(text: string): void {
    process.stderr.write(text);
  }
}

/**
 * Concrete `Prompt` built on top of `node:readline/promises`.
 *
 * Passphrase entry: `node:readline` does not expose a built-in
 * "no-echo" mode, so we toggle the `stdin` raw mode and consume
 * keystrokes manually until ENTER. The buffer is wiped on the way
 * out so a memory scrape after the call cannot recover the
 * passphrase from the local variable.
 *
 * Stream lifecycle: the readline interface is created on demand and
 * disposed before returning. Holding a long-lived interface would
 * fight with the MCP server's stdio transport when the same process
 * runs both the CLI and the server.
 */
export class NodeReadlinePrompt implements Prompt {
  public async confirm(question: string): Promise<boolean> {
    const answer = (await this.readLine(question)).trim().toLowerCase();
    return (
      answer === "y" ||
      answer === "yes" ||
      answer === "s" ||
      answer === "si" ||
      answer === "sí"
    );
  }

  public async readLine(prompt: string): Promise<string> {
    // B-CLI-4: when stdin is not a TTY (piped from `/dev/null`, a
    // wrapper that closed stdin, etc.) `rl.question` never settles
    // — readline sees no data and the closed stdin releases its
    // hold on the event loop, so Node exits 0 with the promise
    // still pending. The user observes a partial prompt banner and
    // a clean exit, with no workspace created (worst possible
    // failure mode: silent, looks-like-success). We refuse upfront
    // with a typed error that the entrypoint maps to `usageError`.
    if (!process.stdin.isTTY) {
      throw new NonInteractiveStdinError(prompt);
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  public async readPassphrase(prompt: string): Promise<string> {
    // B-CLI-4: same TTY guard as `readLine`. Without it, the raw-mode
    // setup below is a no-op (stdin.setRawMode requires a TTY) and
    // the data callback never fires, so the promise hangs forever
    // and Node exits silently.
    if (!process.stdin.isTTY) {
      throw new NonInteractiveStdinError(prompt);
    }
    process.stdout.write(prompt);

    const stdin = process.stdin;
    // `stdin.isTTY` is a non-nullable boolean on `tty.ReadStream`
    // (the type returned by `process.stdin` in Node 20+).
    const isTty = stdin.isTTY;
    const wasRaw = isTty ? stdin.isRaw : false;
    if (isTty) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding("utf8");

    return await new Promise<string>((resolve, reject): void => {
      let buffer = "";
      const onData = (chunk: string): void => {
        for (const char of chunk) {
          // Enter (LF or CR) terminates the entry.
          if (char === "\r" || char === "\n") {
            cleanup();
            process.stdout.write("\n");
            const result = buffer;
            buffer = "";
            resolve(result);
            return;
          }
          // Ctrl-C cancels.
          if (char === "") {
            cleanup();
            process.stdout.write("\n");
            reject(new PromptCancelledError());
            return;
          }
          // Backspace.
          if (char === "" || char === "\b") {
            if (buffer.length > 0) buffer = buffer.slice(0, -1);
            continue;
          }
          buffer += char;
        }
      };

      const cleanup = (): void => {
        stdin.off("data", onData);
        if (isTty) stdin.setRawMode(wasRaw);
        stdin.pause();
      };

      stdin.on("data", onData);
    });
  }
}

/**
 * Local error class for "user pressed Ctrl-C at a passphrase
 * prompt". Lives here so the entrypoint adapter can map it to the
 * `usageError` exit code.
 */
export class PromptCancelledError extends Error {
  public readonly code = "cli.prompt-cancelled";
  public constructor() {
    super("operacion cancelada por el usuario");
    this.name = "PromptCancelledError";
  }
}
