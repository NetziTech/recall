# @netzi/recall

> MCP server for project-scoped, self-curated memory with hybrid search (BM25 + sqlite-vec).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)

`@netzi/recall` gives Claude Code (and any MCP-capable client) **persistent, project-scoped memory** that lives **inside the project itself** (`<repo>/.recall/`), not in `$HOME`.

Memory travels with the code: clone the repo, get the memory. Move the repo, the memory moves with it.

---

## Why another memory layer?

| Feature | `@netzi/recall` | Mem0 / OpenMemory / LangMem |
|---|---|---|
| Lives **in the project**, not in `$HOME` | yes | no |
| Three privacy modes (shared / encrypted / private) | yes | no |
| Native hybrid search (BM25 + cosine) from day one | yes | partial |
| Domain-typed memory (decisions, learnings, entities, tasks, turns) | yes | flat "facts" |
| Local SQLite, no service to run | yes | varies |
| Encrypted-at-rest with SQLCipher (optional) | yes | varies |
| Self-curating (decay, consolidation, pruning) | yes | varies |

---

## Install

```bash
npm install -g @netzi/recall
# or use it on demand
npx @netzi/recall --help
```

This installs two binaries:

| Binary | Purpose |
|---|---|
| `recall` | CLI for setup, mode changes, audits, exports, etc. |
| `recall-server` | The MCP stdio server (invoked by your MCP client) |

Requires **Node.js 20+**.

---

## Quick start

### 1. Initialise memory in your project

```bash
cd /path/to/my-project
recall init --mode shared    # default; tracked in git as plain SQLite
# or
recall init --mode private   # added to .gitignore, single-machine
# or
recall init --mode encrypted # encrypted with SQLCipher (Argon2id KDF)
```

This creates `<project>/.recall/` with `config.json`, `recall.db`, and (in
shared/encrypted modes) a `.gitkeep`.

### 2. Wire it into Claude Code

Add to your MCP client config (e.g. `~/.config/claude/mcp.json`):

```jsonc
{
  "mcpServers": {
    "memoria": {
      "command": "recall-server",
      "args": []
    }
  }
}
```

The server auto-detects the workspace from the current working directory.

### 3. Use it

The six MVP tools are exposed automatically:

| Tool | Purpose |
|---|---|
| `mem.init` | Create or attach a workspace |
| `mem.context` | Build the 7-layer context bundle for the current task |
| `mem.recall` | Hybrid-search the memory (BM25 + cosine) |
| `mem.remember` | Persist a decision / learning / entity / turn |
| `mem.task` | Create or update a tracked task |
| `mem.health` | Structured snapshot of the workspace state |

### 4. Manage the workspace from the CLI

```bash
recall stats               # memory stats
recall health              # health probes
recall audit               # cross-checks + secret scan
recall curator-run         # decay + consolidation + prune
recall mode encrypted      # change privacy mode
recall unlock              # unlock an encrypted workspace
recall export -o dump.json # dump the workspace
recall install-hook        # optional pre-commit secret-scan hook
```

Run `recall --help` for the full catalog (20 commands).

---

## Privacy modes

| Mode | Storage | Git | Best for |
|---|---|---|---|
| **shared** (default) | plain SQLite | tracked | team projects, shared context |
| **encrypted** | SQLCipher (Argon2id KDF) | tracked, ciphered | shared repos with sensitive context |
| **private** | plain SQLite | gitignored | personal / single-machine work |

Encrypted-mode KDF parameters meet OWASP 2024 (Argon2id, ≥64 MiB memory, ≥3 iterations, ≥4 parallelism).

---

## Architecture (one-paragraph)

Strict modularity (8 modules + `shared/` + `composition/`), Clean Architecture
+ Hexagonal + DDD inside each module, SOLID end-to-end, **zero `any` /
`as any` / `// @ts-ignore`** in ~58k LOC. Hybrid search via FTS5 + sqlite-vec.
Embeddings via `fastembed` (local). Memory curation runs in the background
with exponential decay and semantic consolidation.

Full docs in the repo: <https://github.com/NetziTech/recall/tree/main/docs>.

---

## Known issues

### Upstream CVEs (documented wontfix — see ADR-004)

`fastembed@^2.0.0` depends on `tar@6.x`, which has **2 representative
high-severity advisories** (`GHSA-34x7-hfp2-rc4v`, `GHSA-83g3-92jg-28cx`,
plus a cluster of related ones) for hardlink/symlink path traversal during
tarball extraction. The latest upstream release at the time of writing
(`fastembed@2.1.0`) **still depends on `tar@^6.2.0`**, so a clean upstream
fix is not yet available.

**Real-world vector (corrected from v0.1.0 release notes)**: the only
callsite where `fastembed` invokes `tar.x()` is against tarballs downloaded
from the **hardcoded URL `https://storage.googleapis.com/qdrant-fastembed/<model>.tar.gz`**
(a Qdrant-owned Google Cloud Storage bucket), **not** the HuggingFace CDN as
the v0.1.0 notes incorrectly stated. Exploiting the advisory therefore
requires either compromising Qdrant's GCS bucket or breaking TLS to the
client. Likelihood: very low.

Mitigation today:

- Set `cacheDir` in the composition root (or `FASTEMBED_CACHE_PATH` env var)
  to point at a pre-populated, auditable model cache. When the cached
  tarball is already present, `fastembed` skips both download and
  extraction.
- Run `recall` only against project paths under your control; `recall`
  never downloads embedding models from user-supplied URLs.

The full decision rationale (including why we did not pin `tar@7.x`,
swap embedders, or write a custom default-export shim) lives in
[`docs/12-lineamientos-arquitectura.md` § 1.5.4
ADR-004](https://github.com/NetziTech/recall/blob/main/docs/12-lineamientos-arquitectura.md).
The advisories will close in v0.5 either via an upstream `fastembed`
release with `tar@7.x` or by swapping to `@huggingface/transformers`.

### Stubs deferred to v0.5

The multi-key envelope flow (`export-key`, `rekey`, `add-key`) raises a
typed `McpFacadeNotImplementedError` with stable codes. The stubs are
forward-compatible: existing call sites will not break when the v0.5
implementations land. `uninstall-hook` shipped in v0.1.1 (B-009);
`mem.task.get` / `mem.task.delete` shipped earlier in v0.1.1 (B-008).

---

## Development

```bash
git clone https://github.com/NetziTech/recall.git
cd recall/code
npm install
npm run ci            # typecheck + lint + validate:modules + test:coverage
npm run build         # tsup → dist/
```

Tooling targets: TypeScript 5 strict (17 flags), ESLint 9 strict,
Vitest 3 (coverage thresholds 95% global, 100% domain/application,
≥90% infrastructure), SonarQube quality gate (ratings A,
0 bugs / 0 vulnerabilities / 0 blockers).

---

## Status

**v0.1.0 — MVP.** 2421 tests passing across 199 test files. Coverage 96.4%.
Quality gate PASSED. See [`HANDOFF.md`](https://github.com/NetziTech/recall/blob/main/HANDOFF.md) for the full state-of-the-project document.

---

## License

[MIT](./LICENSE) © 2026 Netzi Tech.
