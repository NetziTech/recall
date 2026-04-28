# Release Notes — v0.1.0

> First public release of `@netzi/recall` — MVP.
> 2026-04-28.

## Context

`@netzi/recall@0.1.0` is the renamed and polished successor of
`@netzi/mcp-memoria@0.1.0` (published 2026-04-28, now deprecated). The
product is the same — same architecture, same tests, same SonarQube
quality gate — but the npm package, repo, bins, env vars and workspace
directory all moved to consistent English naming. The version was reset
to `0.1.0` because this is the first release under the `@netzi/recall`
name.

If you installed the previous package, migrate with:

```bash
npm uninstall -g @netzi/mcp-memoria
npm install -g @netzi/recall
```

| Old (`@netzi/mcp-memoria@0.1.0`) | New (`@netzi/recall@0.1.0`) |
|---|---|
| `npm i -g @netzi/mcp-memoria` | `npm i -g @netzi/recall` |
| bins `mcp-memoria` / `mcp-memoria-server` | `recall` / `recall-server` |
| env `MCP_MEMORIA_*` | `RECALL_*` |
| workspace dir `<repo>/.mcp-memoria/` | `<repo>/.recall/` |
| DB file `memoria.db` | `recall.db` |

## Highlights

- **Six MVP MCP tools**: `mem.init`, `mem.context`, `mem.recall`,
  `mem.remember`, `mem.task` (full action set: track / list / status
  update / **get** / **delete**), `mem.health`.
- **Three privacy modes**: `shared` (default, plain SQLite tracked in git),
  `encrypted` (SQLCipher with Argon2id KDF — OWASP 2024 parameters),
  `private` (gitignored, single-machine).
- **Hybrid search from day one**: BM25 via FTS5 + cosine via sqlite-vec.
- **Memory lives inside the project** (`<repo>/.recall/`), not in
  `$HOME`. It clones, moves, and shares with the code.
- **Self-curating** memory: differential decay by kind, semantic
  consolidation (cosine > 0.92), pruning with audit trail, self-healing.
- **Domain-typed memory** (decisions, learnings, entities, tasks, turns,
  relations, sessions) instead of flat "facts".
- **Pre-commit secret-scan hook** with reversible
  `recall install-hook` / `recall uninstall-hook` (idempotent,
  conservative — never modifies a hook it did not author).

## Changes vs. `@netzi/mcp-memoria@0.1.0`

This release is not just a rename — it also closes every CLI bug
discovered in dogfood testing of the previous package and ships the two
features that were deferred to v0.1.1+.

### CLI fixes (5)

| ID | Bug | Resolution |
|---|---|---|
| B-CLI-1 | `--help` printed correctly but exited with code 2 and a spurious `CLI parser threw unexpectedly` log | Commander's `helpDisplayed` / `version` codes now mapped to a `HelpRequestedSignal` returning exit 0 cleanly |
| B-CLI-2 | `health` with FAIL probes returned exit 0 (broke CI scripts) | Handler now propagates probe failures to the exit code |
| B-CLI-3 | Unknown subcommand returned exit 0 instead of usage error | Exit-code path through `bootstrap/cli-entrypoint.ts` corrected |
| B-CLI-4 | `init` with closed stdin (non-TTY) silently aborted with exit 0 | New `NonInteractiveStdinError` raised, with recovery hint pointing at `--non-interactive --display-name` |
| B-CLI-5 | `recall init` from a global npm install failed because the migrations bundle could not be located post-install | `process.argv[1]` symlink now resolved with `fs.realpathSync`; `import.meta.url`-relative sibling layout added as the primary candidate |

### Features closed in this release

- **`mem.task.get(task_id)`** — returns the full task DTO, raises
  `TASK_NOT_FOUND` (`-32110`) when absent.
- **`mem.task.delete(task_id)`** — hard delete, emits `TaskDeleted`
  domain event, raises `TASK_NOT_FOUND` when absent.
- **`recall uninstall-hook`** — full life-cycle parity with
  `install-hook`. Four cases handled deterministically:
  no hook → no-op; foreign hook (no recall marker) → conservative no-op;
  recall-only hook → file removed; mixed hook → only the recall block
  excised. Idempotent.

### Architectural decisions

- **ADR-004** added: wontfix-with-improved-mitigation for the two
  upstream `tar@6.x` advisories transitively depended on through
  `fastembed@2.x`. The four candidate fixes (bump, override, swap
  embedder, custom shim) were evaluated and rejected. See
  [`docs/12 § 1.5.4`](./12-lineamientos-arquitectura.md) for the full
  rationale and the v0.5 reopen criteria. The vector was also corrected:
  the affected download URL is hardcoded to a Qdrant-owned GCS bucket,
  not the HuggingFace CDN as previously documented.

## Engineering

- **2483 tests passing** across 204 test files (+62 vs. v0.1.0 of
  `@netzi/mcp-memoria`).
- **Coverage** (SonarQube): 96.4% global, 100% domain, 100% application,
  ≥90% infrastructure.
- **SonarQube quality gate PASSED** at <https://sonar.netzi.dev>:
  ratings A in reliability/security/maintainability,
  **0 bugs / 0 vulnerabilities / 0 blockers / 0 critical**, technical
  debt ratio 0.1%.
- **Cero `any`, cero `as any`, cero `// @ts-ignore`** in ~58k LOC.
- **`tsc --strict` (17 flags) + ESLint 9 strict + module isolation
  validation** all pass.
- 8 modules + `shared/` + `composition/`, strict modular hexagonal
  architecture (Clean Architecture + DDD + SOLID end-to-end).

## Install

```bash
npm install -g @netzi/recall
# or use it on demand
npx @netzi/recall init --mode shared
```

Requires Node.js 20+. See [README](../code/README.md) for full setup
and [`docs/07-instalacion.md`](./07-instalacion.md) for client wiring.

## Known issues

### Upstream CVEs in `fastembed@2.x` → `tar@6.x` (2 high — wontfix per ADR-004)

`fastembed@^2.0.0` (latest as of 2026-04-28: `2.1.0`) transitively
depends on `tar@6.x`, which has multiple high-severity advisories for
path traversal / symlink poisoning during tarball extraction. `npm
audit --omit=dev` reports 2 representative `high` advisories from this
cluster:

| Advisory | Severity | CWE | Vector |
|---|---|---|---|
| [GHSA-34x7-hfp2-rc4v](https://github.com/advisories/GHSA-34x7-hfp2-rc4v) | high (CVSS 8.2) | CWE-22, CWE-59 | Hardlink path traversal |
| [GHSA-83g3-92jg-28cx](https://github.com/advisories/GHSA-83g3-92jg-28cx) | high (CVSS 7.1) | CWE-22 | Hardlink target escape via symlink chain |

(Additional advisories — GHSA-8qq5-rm4j-mr97, GHSA-qffp-2rhf-9h96,
GHSA-9ppj-qmqm-q256, GHSA-r6q2-hw4h-h46w — sit in the same cluster and
are surfaced together by `npm audit`.)

**Real-world attack vector.** The only callsite where `fastembed`
invokes `tar.x()` is in `Dependencies.decompressToCache()`, operating on
tarballs downloaded from the hardcoded URL
`https://storage.googleapis.com/qdrant-fastembed/<modelName>.tar.gz`
(a Qdrant-owned GCS bucket). To exploit the advisory, an attacker needs
either (a) compromise of Qdrant's GCS bucket and IAM, or (b) a
successful TLS MITM with a compromised CA on the client. Both are well
outside the threat model of a locally-run MCP server.
**Likelihood: very low.**

**Why not fixed in v0.1.0.** Each of the four candidate paths was
evaluated and rejected:

| # | Option | Rejection reason |
|---|---|---|
| (a) | Bump to `fastembed@2.1.0` (latest) | Still pins `tar@^6.2.0` upstream. |
| (b) | `npm overrides: { "tar": "7.5.13" }` | `tar@7.x` ESM has no `default` export; `fastembed`'s `import tar from "tar"` throws `SyntaxError` at module-load time, breaking the embedder test suite. |
| (c) | Swap to `@huggingface/transformers` | Embedder rewrite + ~24 mocked test cases + risk of perf/score regressions + new native `sharp` dep. v0.5-class change. |
| (d) | Custom `tar7-default-shim` package | Introduces custom security code (the project rule for `modules/encryption` is "no custom crypto", extended by consistency to security-critical deps). |

**Mitigation today.** Set `cacheDir` in the composition root or
`FASTEMBED_CACHE_PATH` env var to a pre-populated, auditable model cache.
When the tarball already exists in `cacheDir`, `fastembed` skips both
download and `tar.x` extraction, so the vulnerable path is never
executed.

**Plan.** v0.5 will close the advisories either by adopting an upstream
`fastembed` release with `tar@7.x` (if published) or by completing
option (c) (swap to `@huggingface/transformers`). Tracked in the
v0.5 roadmap; ADR-004 will be reopened at that point.

The SonarQube quality gate (which scans source code, not transitive npm
dependencies) reports **0 vulnerabilities** for our own code; these are
**third-party transitive vulns** detected by `npm audit` only.

### Stubs deferred to v0.5

The following raise typed `McpFacadeNotImplementedError` with stable
error codes (forward-compatible — existing call sites will not break
when the v0.5 implementations land):

| Stub | Replacement |
|---|---|
| `export-key`, `rekey`, `add-key` (multi-key envelope flow) | v0.5 |

### SLO note

`encrypted`-mode cold start is `<1500ms` (Argon2id 64 MiB / 3 iter / 4
parallel — OWASP 2024). v0.5 plans to bring this down to `<500ms` via
an opt-in OS-keychain key cache (ADR pending).

## Acknowledgements

- Built end-to-end with the **Netzi multi-agent workflow**: the original
  6-phase MVP plus a single `phase-7-rename-and-recall-v0.1.0` cycle
  for the rename + bugfixes + features that produced this release. See
  [`HANDOFF.md`](../HANDOFF.md) for the full implementation log.
- Stack: `@modelcontextprotocol/sdk`,
  `better-sqlite3-multiple-ciphers`, `sqlite-vec`, `fastembed`,
  `@noble/hashes`, `pino`, `commander`, `tiktoken`, `uuid`, `zod`.

---

[Full HANDOFF](../HANDOFF.md) ·
[Architecture docs](../docs/) ·
[GitHub](https://github.com/NetziTech/recall)
