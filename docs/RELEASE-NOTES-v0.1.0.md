# Release Notes — v0.1.0

> First public release of `@netzi/recall` — MVP.
> 2026-04-28.

## Highlights

- **Six MVP MCP tools**: `mem.init`, `mem.context`, `mem.recall`,
  `mem.remember`, `mem.task`, `mem.health`.
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

## Engineering

- **2421 tests passing** across 199 test files.
- **Coverage 96.4%** (domain 100%, application 100%, infrastructure ≥90%).
- **SonarQube quality gate PASSED** at <https://sonar.netzi.dev>:
  ratings A in reliability/security/maintainability,
  **0 bugs / 0 vulnerabilities / 0 blockers / 0 critical**, technical
  debt ratio 0.1%.
- **Cero `any`, cero `as any`, cero `// @ts-ignore`** in ~58.4k LOC.
- **`tsc --strict` (17 flags) + ESLint 9 strict + module isolation
  validation** all pass.
- 8 modules + `shared/` + `composition/`, strict modular hexagonal
  architecture (Clean Architecture + DDD + SOLID end-to-end).

## Install

```bash
npm install -g @netzi/recall
# or
npx @netzi/recall init --mode shared
```

Requires Node.js 20+. See [README](../code/README.md) for full setup.

## Known issues

### Upstream CVEs in `fastembed@2.x` → `tar@6.x` (2 high — wontfix per ADR-004)

> **Update (2026-04-28, v0.1.1 sub-fase 5):** the v0.1.0-original wording
> below incorrectly identified the attack vector as "the HuggingFace CDN".
> The real download URL is hardcoded in `fastembed` to a Qdrant-owned
> Google Cloud Storage bucket. The four candidate fixes (bump, override,
> swap embedder, custom shim) were each evaluated and rejected; the
> formal wontfix rationale lives in
> [`docs/12-lineamientos-arquitectura.md` § 1.5.4 ADR-004](./12-lineamientos-arquitectura.md).
> The corrected description follows.

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

**Real-world attack vector (corrected).** The only callsite where
`fastembed` invokes `tar.x()` is in `Dependencies.decompressToCache()`,
operating on tarballs downloaded from the hardcoded URL
`https://storage.googleapis.com/qdrant-fastembed/<modelName>.tar.gz`
(a Qdrant-owned GCS bucket, **not** the HuggingFace CDN). To exploit
the advisory, an attacker needs either (a) compromise of Qdrant's GCS
bucket and IAM, or (b) a successful TLS MITM with a compromised CA on
the client. Both are well outside the threat model of a locally-run MCP
server. **Likelihood: very low.**

**Why not fixed in v0.1.1.** Each of the four candidate paths was
evaluated and rejected:

| # | Option | Rejection reason |
|---|---|---|
| (a) | Bump to `fastembed@2.1.0` (latest) | Still pins `tar@^6.2.0` upstream. |
| (b) | `npm overrides: { "tar": "7.5.13" }` | `tar@7.x` ESM has no `default` export; `fastembed`'s `import tar from "tar"` throws `SyntaxError` at module-load time, breaking the embedder test suite. |
| (c) | Swap to `@huggingface/transformers` | Embedder rewrite + ~24 mocked test cases + risk of perf/score regressions + new native `sharp` dep. v0.5-class change, not a v0.1.1 patch. |
| (d) | Custom `tar7-default-shim` package | Introduces custom security code (the project rule for `modules/encryption` is "no custom crypto", extended by consistency to security-critical deps). |

**Mitigation today.** Set `cacheDir` in the composition root or
`FASTEMBED_CACHE_PATH` env var to a pre-populated, auditable model cache.
When the tarball already exists in `cacheDir`, `fastembed` skips both
download and `tar.x` extraction, so the vulnerable path is never executed.

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
| `mem.task.get` | v0.1.1+ |
| `mem.task.delete` | v0.1.1+ |
| `export-key`, `rekey`, `add-key` (multi-key envelope flow) | v0.5 |
| `uninstall-hook` | v0.5 (workaround: `rm .git/hooks/pre-commit`) |

### SLO note

`encrypted`-mode cold start is `<1500ms` (Argon2id 64 MiB / 3 iter / 4
parallel — OWASP 2024). v0.5 plans to bring this down to `<500ms` via
an opt-in OS-keychain key cache (ADR pending).

## Acknowledgements

- Built end-to-end with the **Netzi multi-agent workflow**: 5 phases,
  30 tasks, 47 validators, only 6 rejection cycles total. See
  [`HANDOFF.md`](../HANDOFF.md) for the full implementation log.
- Stack: `@modelcontextprotocol/sdk`,
  `better-sqlite3-multiple-ciphers`, `sqlite-vec`, `fastembed`,
  `@noble/hashes`, `pino`, `commander`, `tiktoken`, `uuid`, `zod`.

---

[Full HANDOFF](../HANDOFF.md) ·
[Architecture docs](../docs/) ·
[GitHub](https://github.com/NetziTech/recall)
