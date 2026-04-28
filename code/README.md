# code/

Aqui vivira la implementacion del servidor MCP Memoria Inteligente.

Por ahora esta vacio: la documentacion en [`../docs/`](../docs/) es la
unica fuente de verdad.

---

## Cuando se implemente

Plan completo en [../docs/09-roadmap.md](../docs/09-roadmap.md). MVP en 1
semana con:

- Server MCP stdio (TypeScript + `@modelcontextprotocol/sdk`)
- Storage: `better-sqlite3-multiple-ciphers` + `sqlite-vec` + FTS5
- Embeddings: `fastembed-js` (local) o Voyage AI (opt-in)
- Cifrado opcional con SQLCipher (modo `encrypted`)
- CLI: `mcp-memoria` para `unlock`, `audit`, `mode`, etc.

Estructura de carpetas prevista (ver [`../docs/06-stack-tecnico.md` §15](../docs/06-stack-tecnico.md)):

```
code/
├── src/
│   ├── index.ts              # entry server MCP
│   ├── cli.ts                # entry CLI
│   ├── tools/                # un archivo por tool
│   ├── storage/              # SQLite + migrations
│   ├── crypto/               # KDF + keystore
│   ├── retrieval/            # embedder + FTS + vector + hybrid
│   ├── curator/              # decay + consolidate + prune
│   ├── secrets/              # detector
│   ├── workspace/            # auto-detect + modes
│   └── lib/                  # logger + errors
├── tests/
├── migrations/
└── package.json
```

---

## Como arrancar (cuando exista)

```bash
cd code
npm install
npm run build
npm test

# Server local
node dist/index.js

# CLI
node dist/cli.js --help
```
