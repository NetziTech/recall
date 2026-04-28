# 06 — Stack tecnico

> Decisiones de tecnologia con justificacion. Cada decision tiene "Por que
> esto y no X".

---

## 1. Resumen del stack recomendado

| Capa | Tecnologia | Alternativas consideradas |
|---|---|---|
| Lenguaje del server | **TypeScript (Node.js 20+)** | Rust, Python |
| MCP SDK | **`@modelcontextprotocol/sdk`** | Rust SDK, Python SDK |
| Storage estructurado | **SQLite via `better-sqlite3-multiple-ciphers`** | `better-sqlite3` (sin cifrado), `node-sqlite3` |
| Cifrado at-rest | **SQLCipher (incluido en multiple-ciphers)** | libsodium per-field, age |
| Full-text search | **FTS5 (nativo SQLite)** | Tantivy bindings, Lunr.js |
| Vector index | **`sqlite-vec`** | LanceDB, Chroma, Qdrant |
| Embeddings | **`fastembed-js`** (default) o Voyage AI (opt-in) | OpenAI, Cohere |
| KDF para claves | **`@noble/hashes` (argon2id)** | scrypt, libsodium |
| Token counter | **`tiktoken`** | heuristica chars/4 |
| Build | **`tsup`** (bundle a single file) | webpack, esbuild raw |
| Validacion | **Zod** | Joi, ajv |
| Logging | **Pino** | Winston, console |
| Tests | **Vitest** | Jest, node:test |

---

## 2. Lenguaje: TypeScript

### Por que

- **MCP SDK oficial mas maduro** en TS. Anthropic mantiene
  `@modelcontextprotocol/sdk` con mas ejemplos y mejor docs que las versiones
  Python/Rust.
- **Distribucion simple**: `npm install -g <paquete>` o `npx -y`.
- **Ecosistema rico**: zod, pino, vitest, sqlite-vec con bindings JS,
  better-sqlite3 con cifrado.
- **Familiar** para muchos devs.

### Por que no Rust

- Setup mas pesado (cargo, cross-compile, MSRV).
- Embedding libraries menos maduras (Candle es la mejor opcion pero requiere
  bundling de modelos).
- Distribucion: usuario tiene que descargar binarios por OS o `cargo install`.
- **Cuando si Rust:** si el MCP necesita CPU-intensivo masivo. No es nuestro
  caso.

### Por que no Python

- Distribucion via pip arrastra entorno virtual + deps. Mas friccion.
- GIL puede ser problema con sqlite-vec si crece concurrencia.
- **Cuando si Python:** si se reusa pipelines ML existentes. No necesario.

---

## 3. MCP SDK: `@modelcontextprotocol/sdk`

```bash
npm install @modelcontextprotocol/sdk
```

### Estructura tipica de server

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mcp-memoria", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "mem.context", description: "...", inputSchema: { ... } },
    { name: "mem.recall", ... },
    { name: "mem.remember", ... },
    { name: "mem.task", ... },
    { name: "mem.init", ... },
    { name: "mem.health", ... },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "mem.context": return handleContext(request.params.arguments);
    case "mem.recall":  return handleRecall(request.params.arguments);
    // ...
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## 4. Storage: `better-sqlite3-multiple-ciphers`

```bash
npm install better-sqlite3-multiple-ciphers
```

### Por que esta variante y no `better-sqlite3` plano

| Criterio | `better-sqlite3-multiple-ciphers` | `better-sqlite3` |
|---|---|---|
| API | Identica | Standard |
| Cifrado | SQLCipher + otros ciphers | No tiene |
| Performance | Misma (cifrado solo si activado) | Misma |
| Mantenimiento | Activo (m4heshd) | Activo (oficial) |

Usar la variante con multiple-ciphers desde el dia 1 nos permite habilitar
modo `encrypted` sin cambiar el binding. En modos `shared` y `private`,
se usa sin cifrado y es identico al estandar.

### Configuracion recomendada

```typescript
import Database from "better-sqlite3-multiple-ciphers";

function openDb(path: string, encryptionKey?: Buffer): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("cache_size = -64000");       // 64 MB cache
  db.pragma("temp_store = MEMORY");

  if (encryptionKey) {
    // SQLCipher: clave hex de 64 chars (32 bytes)
    db.pragma(`cipher='sqlcipher'`);
    db.pragma(`key="x'${encryptionKey.toString("hex")}'"`);
    // Verificar que la clave funciona
    db.prepare("SELECT count(*) FROM sqlite_master").get();
  }

  return db;
}
```

---

## 5. Cifrado: SQLCipher

### Por que SQLCipher y no per-field encryption

| Criterio | SQLCipher (DB completa) | Per-field con libsodium |
|---|---|---|
| Setup | Trivial (1 PRAGMA) | Cifrar/descifrar manual cada campo |
| Performance | -10/20% en operaciones I/O | Variable, hash + decrypt por query |
| Searchable | Si (FTS5 funciona normal) | No (FTS5 sobre cifrado no funciona) |
| Granularidad | DB entera | Campo por campo |
| Madurez | 15+ anos en produccion | Ad-hoc por implementacion |
| Diff de git | Binarios opacos | Texto cifrado por campo |

SQLCipher gana porque:
1. FTS5 funciona transparente.
2. Sin cambios en SQL queries.
3. Cifrado AES-256 paginado (eficiente para edits).

### KDF: argon2id

La clave que ve el usuario es base32 corta (40 chars).
Antes de pasarla a SQLCipher se deriva a 256 bits con argon2id:

```typescript
import { argon2id } from "@noble/hashes/argon2";

function deriveKey(userKey: string, salt: Buffer, params: KdfParams): Buffer {
  return Buffer.from(argon2id(userKey, salt, {
    m: params.memory_kib,
    t: params.iterations,
    p: params.parallelism,
    dkLen: 32,
  }));
}
```

Argon2 protege contra brute-force si alguien obtiene los archivos cifrados
sin la clave: cada intento de descifrado cuesta ~100ms + 64 MB de RAM.

### Validacion de clave sin abrir DB completa

Al inicializar modo encrypted, escribir un blob conocido cifrado en
`config.json`:

```typescript
const validatorPlaintext = "VALID-WORKSPACE-V1";
const blob = encryptWithKey(deriveKey(userKey, salt), validatorPlaintext);
config.key_validator_blob_b64 = blob.toString("base64");
```

Al unlock, intentar descifrar el blob. Si plaintext == "VALID-WORKSPACE-V1",
la clave es correcta. Esto es < 100ms y no toca la DB.

---

## 6. FTS5 — Full-text search nativo

FTS5 viene incluido en SQLite. Cero deps adicionales. Soporta:
- Tokenization configurable (default `unicode61` con folding).
- BM25 ranking via `bm25()` function.
- Snippets via `snippet()`, `highlight()`.
- Phrase queries, prefix queries, NEAR.

### Setup

Ya cubierto en `03-modelo-datos.md`. Triggers ai/ad/au mantienen FTS5 en
sync con tablas base.

### Query hibrida (BM25 + cosine)

```typescript
async function hybridSearch(query: string, kinds: Kind[]): Promise<Result[]> {
  const queryEmb = await embedder.embed(query);

  const lexicalResults = db.prepare(`
    SELECT id, bm25(decisions_fts) AS bm25_score
    FROM decisions_fts
    WHERE decisions_fts MATCH ?
    LIMIT 50
  `).all(query);

  const vectorResults = db.prepare(`
    SELECT id, vec_distance_cosine(vec, ?) AS distance
    FROM embeddings
    WHERE id IN (SELECT id FROM embedding_metadata WHERE table_name = 'decisions')
    ORDER BY distance ASC
    LIMIT 50
  `).all(serializeVector(queryEmb));

  // Fusion + re-rank
  return reRank(lexicalResults, vectorResults);
}
```

---

## 7. Vector index: `sqlite-vec`

```bash
npm install sqlite-vec
```

### Por que sqlite-vec

- **Single binary**: la extension se carga como `.so/.dylib/.dll` desde el
  paquete npm.
- **Hasta ~1M vectores** con buen performance.
- **Mismo SQLite** que el resto. Joins entre tablas estructuradas y
  embeddings sin cross-DB.
- **Compatible con SQLCipher**: el `.db` cifrado puede tener tablas vec0.

### Setup

```typescript
import * as sqliteVec from "sqlite-vec";

sqliteVec.load(db);

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
    id TEXT PRIMARY KEY,
    vec FLOAT[384]
  );
`);
```

### Alternativas si sqlite-vec no alcanza

| Cuando | Alternativa |
|---|---|
| > 1M vectores | LanceDB (Rust embebido) |
| Sharding multi-host | Qdrant cluster |
| Filtrado complejo | Weaviate |

Para v1 (proyectos < 100K vectores), sqlite-vec es suficiente.

---

## 8. Embeddings: `fastembed-js` (local) o Voyage AI (cloud)

### Default: `fastembed-js`

```bash
npm install fastembed
```

```typescript
import { EmbeddingModel, FlagEmbedding } from "fastembed";

const model = await FlagEmbedding.init({
  model: EmbeddingModel.BGESmallEN15,
  cacheDir: path.join(homedir(), ".cache", "mcp-memoria", "models"),
});

const vectors = await model.embed(["text1", "text2"]);
```

**Por que fastembed:**
- Local 100%. Sin API keys.
- ONNX runtime, rapido (CPU).
- Modelos pequenos (33 MB - 1.2 GB).
- Soporta multi-idioma con `multilingual-e5-base`.

**Modelos recomendados:**

| Modelo | Dim | Tamano | Caso |
|---|---|---|---|
| `BGESmallEN15` | 384 | 33 MB | Default ingles, rapido |
| `MultilingualE5Base` | 768 | 250 MB | Espanol/multilingue |
| `BGELargeEN` | 1024 | 1.2 GB | Maxima calidad |

### Cache compartido

```
~/.cache/mcp-memoria/models/
├── bge-small-en-v1.5/
│   ├── model.onnx
│   ├── tokenizer.json
│   └── config.json
└── multilingual-e5-base/
    └── ...
```

Todos los proyectos comparten el mismo cache. Si se borra, se redescarga.

### Alternativa cloud: Voyage AI

Opt-in via env var:

```bash
MCP_MEMORIA_EMBEDDER=voyage
VOYAGE_AI_KEY=xxx
```

Trade-off: API key + costo (~$0.10 / 1M tokens). Pero mejor calidad
(Voyage es top-3 MTEB) y latencia comparable (~150ms).

### Por que NO usar OpenAI embeddings por default

- Requiere API key para servicio de tercero.
- Compite con Anthropic; mantenerlo neutral.
- Coste similar a Voyage sin ventaja de calidad.

---

## 9. Token counter: `tiktoken`

```bash
npm install tiktoken
```

```typescript
import { encoding_for_model } from "tiktoken";

const encoder = encoding_for_model("gpt-4");  // cl100k_base, ~equivalente a Claude

function countTokens(text: string): number {
  return encoder.encode(text).length;
}

function truncateToTokens(text: string, maxTokens: number): string {
  const tokens = encoder.encode(text);
  if (tokens.length <= maxTokens) return text;
  const truncated = encoder.decode(tokens.slice(0, maxTokens));
  // Cortar en limite de palabra
  return truncated.replace(/\S*$/, "").trim();
}
```

Fallback heuristico si tiktoken no disponible: `chars / 4`.

---

## 10. Build: `tsup`

```bash
npm install -D tsup
```

```json
// package.json
{
  "scripts": {
    "build": "tsup src/index.ts src/cli.ts --format esm --target node20 --bundle"
  }
}
```

Output:
- `dist/index.js` (server MCP, ~1 MB)
- `dist/cli.js` (CLI para unlock, audit, etc., ~500 KB)

Distribuible via npm.

### Distribucion

`package.json`:

```json
{
  "name": "mcp-memoria",
  "version": "0.1.0",
  "bin": {
    "mcp-memoria-server": "./dist/index.js",
    "mcp-memoria": "./dist/cli.js"
  },
  "files": ["dist/", "README.md"]
}
```

Usuario instala:

```bash
npm install -g mcp-memoria
```

O sin install global, en config MCP del cliente:

```json
{
  "mcpServers": {
    "memoria": {
      "command": "npx",
      "args": ["-y", "mcp-memoria@latest", "server"]
    }
  }
}
```

---

## 11. Validacion: Zod

```bash
npm install zod
```

```typescript
import { z } from "zod";

const RecallSchema = z.object({
  workspace_id: z.string().min(1).optional(),
  query: z.string().min(1).max(2000).optional(),
  kinds: z.array(z.enum(["decision", "learning", "turn", "entity", "task", "any"])).optional(),
  top_k: z.number().int().min(1).max(50).default(8),
  max_tokens: z.number().int().min(100).max(20000).default(2000),
  order_by: z.enum(["relevance", "recency", "score", "usage"]).optional(),
});

function handleRecall(args: unknown) {
  const parsed = RecallSchema.parse(args);
  // ...
}
```

---

## 12. Logging: Pino

```bash
npm install pino
```

```typescript
import pino from "pino";
import { createWriteStream } from "fs";
import { homedir } from "os";
import path from "path";

const logDir = path.join(homedir(), ".cache", "mcp-memoria", "logs");
const today = new Date().toISOString().slice(0, 10);

const logger = pino(
  { level: process.env.MCP_MEMORIA_LOG_LEVEL ?? "info" },
  pino.destination(path.join(logDir, `${today}.log`))
);

logger.info({ tool: "recall", duration_ms: 45 }, "tool call");
```

Pino: rapido, structured logging, JSON util para parseo posterior.

---

## 13. Tests: Vitest

```bash
npm install -D vitest
```

```typescript
import { describe, it, expect, beforeEach } from "vitest";

describe("mem.recall", () => {
  beforeEach(setupTempWorkspace);

  it("returns top_k results ordered by score", async () => {
    await seedTestData();
    const result = await callTool("mem.recall", { query: "...", top_k: 3 });
    expect(result.results).toHaveLength(3);
  });

  it("falls back to FTS5 if embeddings not ready", async () => {
    await seedTestData({ skipEmbeddings: true });
    const result = await callTool("mem.recall", { query: "..." });
    expect(result.fallback_reason).toBe("no_embeddings_yet");
  });
});
```

---

## 14. Dependencies completas (package.json)

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@noble/hashes": "^1.4.0",
    "better-sqlite3-multiple-ciphers": "^11.0.0",
    "sqlite-vec": "^0.1.6",
    "fastembed": "^1.14.0",
    "tiktoken": "^1.0.0",
    "zod": "^3.23.0",
    "pino": "^9.0.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

Tamano del bundle final: ~1.5 MB de JS + ~33 MB del modelo embedding (en
cache, descargado al primer uso). Aceptable.

---

## 15. Estructura de carpetas del proyecto

```
mcp-memoria/
├── src/
│   ├── index.ts                  # entry point del server MCP
│   ├── cli.ts                    # entry point del CLI (unlock, audit, etc.)
│   ├── tools/                    # un archivo por tool
│   │   ├── init.ts
│   │   ├── context.ts
│   │   ├── recall.ts
│   │   ├── remember.ts
│   │   ├── task.ts
│   │   ├── health.ts
│   │   ├── search_entities.ts    # v0.5+
│   │   ├── export_handoff.ts     # v0.5+
│   │   ├── forget.ts             # v0.5+
│   │   ├── curator_run.ts        # v0.5+
│   │   ├── session_force.ts      # v0.5+
│   │   └── audit.ts              # v0.5+
│   ├── storage/
│   │   ├── db.ts                 # better-sqlite3-multiple-ciphers setup
│   │   ├── migrations/
│   │   │   ├── 001_initial.sql
│   │   │   └── ...
│   │   ├── schemas.ts            # zod schemas para tablas
│   │   └── repositories/
│   │       ├── decisions.repo.ts
│   │       ├── learnings.repo.ts
│   │       └── ...
│   ├── crypto/
│   │   ├── kdf.ts                # argon2id derivation
│   │   ├── keystore.ts           # ~/.config/.../keys/ I/O
│   │   └── validator.ts          # validar clave con blob
│   ├── retrieval/
│   │   ├── embedder.ts           # abstraccion embedder + queue async
│   │   ├── fts.ts                # BM25 search
│   │   ├── vector.ts             # cosine search
│   │   ├── hybrid.ts             # fusion + re-rank
│   │   ├── token_counter.ts      # tiktoken wrapper
│   │   └── bundle.ts             # ensamblaje de capas
│   ├── curator/
│   │   ├── decay.ts
│   │   ├── consolidate.ts
│   │   ├── prune.ts
│   │   ├── validate.ts
│   │   ├── reembed.ts
│   │   └── runner.ts
│   ├── secrets/
│   │   ├── patterns.ts           # regex de secrets conocidos
│   │   ├── entropy.ts            # Shannon entropy
│   │   ├── path_sanitizer.ts
│   │   └── detector.ts           # API publica
│   ├── workspace/
│   │   ├── detect.ts             # auto-detect from cwd
│   │   ├── config.ts             # leer/escribir .mcp-memoria/config.json
│   │   └── modes.ts              # shared / encrypted / private
│   ├── lib/
│   │   ├── logger.ts
│   │   └── errors.ts             # codigos JSON-RPC custom
│   └── types.ts
├── tests/
├── migrations/                   # SQL files referenciados desde src/
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

---

## 16. Consideraciones cross-platform

- Path separators: usar siempre `path.join`. Nunca concatenar con `/` literal.
- Permisos: `0700` solo en Unix; en Windows ignorar pero loggear.
- Linea: usar `os.EOL` solo cuando se exporta archivo legible humano (HANDOFF
  markdown). El resto siempre `\n`.
- XDG dirs: usar `XDG_CACHE_HOME` y `XDG_CONFIG_HOME` si estan definidos;
  fallback a `~/.cache/` y `~/.config/`. En Windows usar `%LOCALAPPDATA%` y
  `%APPDATA%`.

---

## 17. Lo que NO ponemos en el stack v1

- **WebSockets / SSE.** No se necesita para stdio.
- **GraphQL.** Overkill, JSON-RPC ya esta dado.
- **Redis / Memcached.** SQLite cache es suficiente.
- **Sentry / observabilidad cloud.** Logs locales bastan.
- **Servidor de embeddings remoto propio.** Voyage cubre el caso cloud.
- **GUI propia.** Es server headless. Si se quiere UI, otro proyecto.

---

## 18. Matriz de decision rapida

| Prioridad del usuario | Recomendacion |
|---|---|
| Privacy total + compartir con equipo | TS + sqlite-vec + fastembed local + modo `encrypted` |
| Maxima calidad de retrieval | TS + sqlite-vec + Voyage AI + modo `shared` |
| Open-source maximo | TS + sqlite-vec + fastembed + modo `shared` |
| Solo dev individual | TS + sqlite-vec + fastembed + modo `private` |

Default para v1: **TS + sqlite-vec + fastembed + modo `shared`**.
