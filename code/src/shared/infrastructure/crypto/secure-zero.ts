/**
 * Best-effort zeroisation of a {@link Buffer} containing sensitive
 * material (passphrases, derived keys, decrypted envelope contents).
 *
 * Overwrites every byte of `buffer` with `0x00` in place via
 * `Buffer.fill(0)`. The function returns nothing and never throws on
 * empty or already-zero buffers.
 *
 * @remarks
 * **Best-effort, not a post-process-exit guarantee.** Node's V8 runtime
 * is free to copy bytes outside the original allocation while the
 * caller holds the buffer:
 *
 * - `Buffer.from(string)` interns the source string in V8's heap. The
 *   string copy survives any later `fill(0)` on the resulting buffer.
 * - `Buffer.alloc(N)` / `Buffer.allocUnsafe(N)` carve slices off a
 *   shared internal pool (`Buffer.poolSize`, default 8 KiB). Other
 *   slices of the same pool may legitimately survive past the lifetime
 *   of the buffer we zeroed.
 * - The OS may have paged the memory to swap or hibernation before we
 *   reach this call. Zeroing the in-RAM copy does not erase swap.
 *
 * **Caller responsibility.** To keep zeroisation meaningful, the upstream
 * caller (the code that first materialises the secret in memory) MUST
 * allocate the buffer with `Buffer.allocUnsafeSlow(N)`. `allocUnsafeSlow`
 * bypasses the shared pool, so the only place those bytes live is inside
 * the buffer we hand to `secureZero`. Avoid `Buffer.from("...")` on a
 * passphrase string for the same reason.
 *
 * This helper does NOT verify the allocation strategy of its argument;
 * doing so is impossible at runtime. It simply guarantees the bytes of
 * the buffer it receives are clobbered before the reference is dropped.
 *
 * @param buffer - The buffer to overwrite. May be empty. Must not be
 *   `null`/`undefined` (TypeScript enforces this at compile time).
 *
 * @see `docs/11-seguridad-modos.md` §3 — key lifetime and zeroisation
 *   policy across the three operating modes.
 * @see `docs/12-lineamientos-arquitectura.md` §1.5.5 (Q1 paso 4 + Q5
 *   paso 5) — ADR-005 iteration 2 mandates this helper as the single
 *   zero-fill primitive shared across CLI prompts and encryption
 *   adapters.
 */
export function secureZero(buffer: Buffer): void {
  buffer.fill(0);
}
