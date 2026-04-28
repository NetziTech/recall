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

### Upstream CVEs in `fastembed@2.x` → `tar@6.x` (2 high)

`fastembed@2.x` transitively depends on `tar@6.x`, which has multiple
high-severity advisories for path traversal / symlink poisoning during
tarball extraction:

| Advisory | Severity | CWE |
|---|---|---|
| [GHSA-34x7-hfp2-rc4v](https://github.com/advisories/GHSA-34x7-hfp2-rc4v) | high (CVSS 8.2) | CWE-22, CWE-59 |
| [GHSA-8qq5-rm4j-mr97](https://github.com/advisories/GHSA-8qq5-rm4j-mr97) | high | CWE-22 |
| [GHSA-83g3-92jg-28cx](https://github.com/advisories/GHSA-83g3-92jg-28cx) | high (CVSS 7.1) | CWE-22 |
| [GHSA-qffp-2rhf-9h96](https://github.com/advisories/GHSA-qffp-2rhf-9h96) | high | CWE-22, CWE-59 |
| [GHSA-9ppj-qmqm-q256](https://github.com/advisories/GHSA-9ppj-qmqm-q256) | high | CWE-22 |
| [GHSA-r6q2-hw4h-h46w](https://github.com/advisories/GHSA-r6q2-hw4h-h46w) | high (CVSS 8.8) | CWE-176, CWE-367 |

**Real-world attack vector**: a malicious embedding model served from
the HuggingFace CDN, downloaded by `fastembed` on first use of
`mem.recall`. **Vector likelihood is low** in normal usage (default
model `BAAI/bge-small-en-v1.5` is well-known, downloaded over HTTPS
from the official CDN), but documented for transparency.

**Why not fixed in v0.1.0**: the only upstream-clean fix is
`fastembed@1.0.0`, which is a semver-major break in the embeddings API.
Forcing `tar@7.x` via npm `overrides` breaks `fastembed@2.x` because
`tar@7` removed the default ESM export that `fastembed` imports as
`import tar from "tar"`.

**Mitigation today**: pre-populate `FASTEMBED_CACHE_PATH` from a trusted
source if you operate in a hostile environment.

**Plan**: v0.1.1 will either pin `fastembed@2.1+` (when upstream
publishes a `tar@7.x`-compatible release) or migrate to an alternative
embedder. Tracked in the v0.5 roadmap.

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
