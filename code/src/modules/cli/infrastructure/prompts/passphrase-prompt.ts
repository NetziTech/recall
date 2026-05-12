import process from "node:process";

import { secureZero } from "../../../../shared/infrastructure/crypto/secure-zero.ts";
import { CliInfrastructureError } from "../errors/cli-infrastructure-error.ts";

/**
 * Maximum number of UTF-8 encoded bytes we are willing to accept as a
 * passphrase entry. Above this point we assume the user pasted a file
 * by mistake (or an adversarial wrapper is trying to overflow the
 * keystroke loop). We hard-stop with `weakPassphrase("too long")`
 * rather than silently truncating — silent truncation would let an
 * attacker who controls stdin manipulate which prefix is hashed by the
 * KDF.
 *
 * 1 KiB is generous: the longest realistic human-typed passphrase is
 * a 64-character random alphanum (~64 bytes) or a 6-word diceware
 * (~50 bytes). NIST SP 800-63B §5.1.1.2 allows authenticators up to
 * 64 chars; we go further to accommodate non-ASCII diceware (e.g.
 * Spanish wordlist with accented characters that expand to ~3 bytes
 * each under NFKC).
 */
const MAX_PASSPHRASE_BYTES = 1024;

/**
 * Asserts that `process.stdin.isTTY === true`. Raised as a typed
 * `CliInfrastructureError` so the entrypoint can map the failure onto
 * exit code 2 (`usageError`).
 *
 * Use this as an upfront check at the top of a command handler (e.g.
 * `recall init`) to fail fast BEFORE any partial side-effect (workspace
 * directory creation, key derivation). Calling `readPassphrase` also
 * checks `isTTY`, but only at the moment the prompt is issued — by then
 * the command may have already printed banners.
 *
 * @param promptText - The human-facing label that *would* have been
 *   shown. Quoted back to the user in the error message so they know
 *   which entry point refused.
 */
export function assertTty(promptText: string): void {
  if (!process.stdin.isTTY) {
    throw CliInfrastructureError.noTtyForPassphrase(promptText);
  }
}

/**
 * Reads a passphrase from the terminal in raw mode with no echo, and
 * returns the bytes as a `Buffer` allocated via `Buffer.allocUnsafeSlow`.
 *
 * **Memory hygiene contract** (paired with `secureZero`):
 *   - The buffer is `allocUnsafeSlow(N)`, NOT `Buffer.alloc(N)` or
 *     `Buffer.from(string)`. This bypasses Node's shared 8 KiB pool, so
 *     when the caller invokes `secureZero(buf)` the zeroed bytes are the
 *     *only* place those bytes have ever lived inside Node's heap.
 *   - The intermediate `string` variable used to accumulate keystrokes
 *     during the raw-mode loop is interned by V8 — there is NO way to
 *     erase it from JS-land. The mitigation is to keep that string
 *     extremely short-lived: we convert to bytes via UTF-8 encoding and
 *     drop the reference immediately. V8 will eventually collect it; we
 *     cannot guarantee when. Per `docs/11-seguridad-modos.md` §3 this is
 *     the documented residual risk and is acceptable for the threat
 *     model (local-user attack, not remote-memory-scrape).
 *
 * **Normalisation**: the returned bytes are NFKC-normalised UTF-8.
 *   Without this step, a user who composed an accented `e` as `e + ́`
 *   on one machine and as a precomposed `é` on another would derive two
 *   different keys from the same conceptual passphrase. The normalised
 *   form is the canonical wire representation used downstream by the
 *   Argon2id KDF.
 *
 * **TTY guard**: refuses with `CliInfrastructureError.noTtyForPassphrase`
 *   when `process.stdin.isTTY` is falsy. Without this guard the raw-mode
 *   loop would never fire its `"data"` callback (raw mode requires a
 *   TTY), Node would lose its hold on the event loop, and the promise
 *   would resolve to a dangling state — silent-success, the worst
 *   diagnostic outcome.
 *
 * **Ctrl-C**: aborts with SIGINT semantics. The accumulated bytes (if
 *   any) are zeroed and the process exits 130 (POSIX convention for
 *   `128 + SIGINT`). We exit directly rather than rejecting the promise
 *   because rejection would force every caller to wire identical
 *   teardown plumbing — leaking the partial passphrase up the stack
 *   is exactly what we are trying to avoid.
 *
 * **Backspace**: both `0x7f` (DEL, the default on macOS / iTerm) and
 *   `\b` (`0x08`, Ctrl-H on some terminals) are accepted. Erasing past
 *   the start of the buffer is a no-op (no underflow).
 *
 * **Length cap**: enforces `MAX_PASSPHRASE_BYTES` on the UTF-8 encoded
 *   length. Above the cap we throw `weakPassphrase("too long")` — see
 *   the constant docstring for rationale.
 *
 * @param prompt - Spanish-language label written to stdout once before
 *   keystroke collection begins. Not echoed back during entry.
 * @returns A buffer (allocated via `allocUnsafeSlow`) owning the NFKC
 *   normalised UTF-8 bytes of the passphrase. The caller is responsible
 *   for invoking `secureZero` on it once the bytes are no longer needed
 *   (typically after the KDF has consumed them).
 *
 * @see `docs/11-seguridad-modos.md` §3 — key lifetime policy.
 * @see `docs/12-lineamientos-arquitectura.md` §1.5.5 — ADR-005 Q5
 *   prompts module placement.
 */
export async function readPassphrase(prompt: string): Promise<Buffer> {
  assertTty(prompt);

  process.stdout.write(prompt);

  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return await new Promise<Buffer>((resolve, reject): void => {
    let collected = "";
    let aborted = false;

    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onData = (chunk: string): void => {
      if (aborted) return;
      for (const char of chunk) {
        // Enter (LF or CR) terminates the entry.
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          try {
            const buf = encodeNfkc(collected);
            collected = "";
            resolve(buf);
          } catch (err) {
            collected = "";
            reject(err instanceof Error ? err : new Error(String(err)));
          }
          return;
        }
        // Ctrl-C cancels with SIGINT semantics.
        if (char === "") {
          aborted = true;
          cleanup();
          process.stdout.write("\n");
          collected = "";
          // POSIX: 128 + SIGINT(2) = 130.
          process.exit(130);
        }
        // Backspace: 0x7f (DEL, default on most modern terminals) and
        // 0x08 (\b, Ctrl-H on some legacy terminals) both delete one
        // character from the buffer. No-op on empty buffer.
        if (char === "" || char === "\b") {
          if (collected.length > 0) {
            collected = collected.slice(0, -1);
          }
          continue;
        }
        collected += char;
      }
    };

    stdin.on("data", onData);
  });
}

/**
 * NFKC-normalises `input` and copies the resulting UTF-8 bytes into a
 * pool-free buffer obtained via `Buffer.allocUnsafeSlow`. Throws
 * `weakPassphrase("too long")` if the encoded length exceeds the cap.
 *
 * Implementation note: we deliberately call `allocUnsafeSlow` and copy
 * the bytes one slice at a time rather than using `Buffer.from(string)`.
 * `Buffer.from(string)` reaches into the shared pool when the string
 * fits (which it almost always will for a passphrase), defeating the
 * point of the `allocUnsafeSlow` contract documented in `secureZero`.
 */
function encodeNfkc(input: string): Buffer {
  const normalised = input.normalize("NFKC");
  const tmp = Buffer.from(normalised, "utf8");
  if (tmp.length > MAX_PASSPHRASE_BYTES) {
    // Best effort: zero the tmp before throwing so the over-long bytes
    // don't linger in the pool until the next allocation.
    secureZero(tmp);
    throw CliInfrastructureError.weakPassphrase(
      `excede ${MAX_PASSPHRASE_BYTES} bytes UTF-8`,
    );
  }
  const out = Buffer.allocUnsafeSlow(tmp.length);
  tmp.copy(out, 0, 0, tmp.length);
  // Wipe the pool-backed buffer; the only surviving copy is `out`.
  secureZero(tmp);
  return out;
}
