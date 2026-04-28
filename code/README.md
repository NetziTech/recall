# @netzi/mcp-memoria

> MCP server for project-scoped, self-curated memory with hybrid search (BM25 + sqlite-vec).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)

`@netzi/mcp-memoria` gives Claude Code (and any MCP-capable client) **persistent, project-scoped memory** that lives **inside the project itself** (`<repo>/.mcp-memoria/`), not in `$HOME`.

Memory travels with the code: clone the repo, get the memory. Move the repo, the memory moves with it.

---

## Why another memory layer?

| Feature | `@netzi/mcp-memoria` | Mem0 / OpenMemory / LangMem |
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
npm install -g @netzi/mcp-memoria
# or use it on demand
npx @netzi/mcp-memoria --help
```

This installs two binaries:

| Binary | Purpose |
|---|---|
| `mcp-memoria` | CLI for setup, mode changes, audits, exports, etc. |
| `mcp-memoria-server` | The MCP stdio server (invoked by your MCP client) |

Requires **Node.js 20+**.

---

## Quick start

### 1. Initialise memory in your project

```bash
cd /path/to/my-project
mcp-memoria init --mode shared    # default; tracked in git as plain SQLite
# or
mcp-memoria init --mode private   # added to .gitignore, single-machine
# or
mcp-memoria init --mode encrypted # encrypted with SQLCipher (Argon2id KDF)
```

This creates `<project>/.mcp-memoria/` with `config.json`, `memoria.db`, and (in
shared/encrypted modes) a `.gitkeep`.

### 2. Wire it into Claude Code

Add to your MCP client config (e.g. `~/.config/claude/mcp.json`):

```jsonc
{
  "mcpServers": {
    "memoria": {
      "command": "mcp-memoria-server",
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
mcp-memoria stats               # memory stats
mcp-memoria health              # health probes
mcp-memoria audit               # cross-checks + secret scan
mcp-memoria curator-run         # decay + consolidation + prune
mcp-memoria mode encrypted      # change privacy mode
mcp-memoria unlock              # unlock an encrypted workspace
mcp-memoria export -o dump.json # dump the workspace
mcp-memoria install-hook        # optional pre-commit secret-scan hook
```

Run `mcp-memoria --help` for the full catalog (20 commands).

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

Full docs in the repo: <https://github.com/NetziTech/mcp-memoria-inteligente/tree/main/docs>.

---

## Known issues

### Upstream CVEs (tracked, not yet fixable)

`fastembed@2.x` depends on `tar@6.x`, which has **2 high-severity advisories**
(`GHSA-34x7-hfp2-rc4v`, `GHSA-83g3-92jg-28cx`, et al.) for path
traversal/symlink poisoning during tarball extraction. **Real-world vector**:
an attacker-controlled embedding model on the HuggingFace CDN, served on first
use of `mem.recall`. Mitigation:

- The default model is the well-known `BAAI/bge-small-en-v1.5`, downloaded
  over HTTPS from HuggingFace's own CDN.
- Set `FASTEMBED_CACHE_PATH` to pre-warm the cache from a trusted location
  if you operate in a hostile environment.

A fix (either upstream `fastembed@2.1+` with `tar@7.x` or a swap to a
different embedder) is planned for **v0.1.1**.

### Stubs deferred to v0.5

`mem.task.get`, `mem.task.delete`, multi-key envelope flow (`export-key`,
`rekey`, `add-key`), and `uninstall-hook` raise typed
`McpFacadeNotImplementedError` errors with stable codes. They are
forward-compatible: existing call sites will not break when the v0.5
implementations land.

---

## Development

```bash
git clone https://github.com/NetziTech/mcp-memoria-inteligente.git
cd mcp-memoria-inteligente/code
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
Quality gate PASSED. See [`HANDOFF.md`](https://github.com/NetziTech/mcp-memoria-inteligente/blob/main/HANDOFF.md) for the full state-of-the-project document.

---

## License

[MIT](./LICENSE) © 2026 Netzi Tech.
