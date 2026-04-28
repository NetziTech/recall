# 01 — Arquitectura

## 1. Vision de alto nivel

```
┌──────────────────────────────────────────────────────────┐
│                   Claude Code (cliente MCP)              │
└──────────────┬───────────────────────────────────────────┘
               │ stdio (JSON-RPC 2.0)
               ▼
┌──────────────────────────────────────────────────────────┐
│              MCP Memoria Inteligente (servidor)          │
│                                                          │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Tools    │  │   Recuperador│  │  Curador     │      │
│  │  (handlers)│  │ (retrieval)  │  │ (decay/dedup)│      │
│  └─────┬──────┘  └──────┬───────┘  └──────┬───────┘      │
│        │                │                 │              │
│        └────────────────┼─────────────────┘              │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────┐     │
│  │            Storage Layer                        │     │
│  │  ┌──────────────────┐  ┌────────────────────┐   │     │
│  │  │ recall.db       │  │ vectors.db         │   │     │
│  │  │ (SQLite + FTS5)  │  │ (sqlite-vec)       │   │     │
│  │  │ +SQLCipher si    │  │ +SQLCipher si      │   │     │
│  │  │ modo encriptado  │  │ modo encriptado    │   │     │
│  │  └──────────────────┘  └────────────────────┘   │     │
│  └─────────────────────────────────────────────────┘     │
│                         │                                │
│  ┌──────────────────────▼───────────────────────────┐    │
│  │  Embedder + Token counter (workers async)        │    │
│  │  fastembed (local) / Voyage (cloud opcional)     │    │
│  └──────────────────────┬───────────────────────────┘    │
└─────────────────────────┼────────────────────────────────┘
                          │
       ┌──────────────────┴────────────────────┐
       ▼                                       ▼
<proyecto>/.recall/         ~/.cache/recall/models/
├── recall.db                   └── bge-small-en-v1.5/
├── vectors.db                       (modelo ONNX, ~33 MB)
├── config.json
└── .gitignore (segun modo)      ~/.config/recall/
                                 ├── config.json
                                 └── keys/<workspace_id>.key
```

---

## 2. Decisiones arquitectonicas clave

### 2.1 Stdio sobre HTTP

El MCP corre como subproceso de Claude Code, comunicacion por stdin/stdout
con JSON-RPC 2.0. **No HTTP server.**

**Por que:**
- Setup zero. No puertos, no firewall, no auth.
- Claude Code maneja el ciclo de vida (arranca/mata el proceso por sesion).
- Aislamiento natural: cada cliente MCP arranca su propia instancia.

**Cuando usar HTTP en su lugar:** si se quiere compartir memoria entre varias
maquinas o varios usuarios via servicio centralizado. Fuera del scope.

### 2.2 Memoria-en-proyecto (cambio clave vs propuesta original)

Toda la memoria de un proyecto vive en `<proyecto>/.recall/`. El servidor
auto-detecta el workspace al arrancar caminando hacia arriba desde `cwd`
buscando marcadores conocidos (`.git/`, `.recall/`, `package.json`,
`Cargo.toml`, `pyproject.toml`).

**Por que:**
- La memoria viaja con el codigo (clone, copy, mv, share).
- `workspace_id` estable: se genera UUID v7 al inicializar y se guarda en
  `.recall/config.json`. No se deriva del path. Renombrar el folder no
  rompe nada.
- Backup natural: el backup del codigo incluye la memoria.
- Compartible si el usuario lo decide (modos compartido / encriptado).

**Lo unico que NO esta en el proyecto:**
- Cache del modelo de embeddings (`~/.cache/recall/models/`) — borrable
  sin perdida, se redescarga.
- Defaults del usuario (`~/.config/recall/config.json`) — solo dice que
  modelo embedder usar.
- Claves de modos encriptados (`~/.config/recall/keys/<workspace_id>.key`)
  — gestion de secretos local del usuario.

### 2.3 Tres modos de privacidad

Cada workspace declara su modo en `.recall/config.json`:

| Modo | `.gitignore` | Cifrado | Caso |
|---|---|---|---|
| `shared` (default) | (vacio) | No | Equipo abierto, OSS |
| `encrypted` | (vacio) | SQLCipher | Equipo con info sensible, repo privado |
| `private` | `*` | No | Memoria personal de un dev |

Detalle completo en `11-seguridad-modos.md`.

### 2.4 Recuperacion selectiva, no dump

El MCP **nunca** devuelve "todo lo que sabe". Cada tool tiene un parametro
`top_k` y/o `max_tokens`, devuelve solo lo mas relevante. La decision de
"que cargar" se delega a Claude (el LLM cliente) que invoca tools segun
necesite.

**Por que:**
- Respeta el budget de contexto del LLM.
- No paga tokens por info irrelevante.
- Composabilidad: Claude combina varias tools si necesita.

**Implicacion:** las tools deben tener nombres y descripciones tan claras que
Claude sepa cuando llamar cada una sin instrucciones del usuario.

### 2.5 Sesiones implicitas

`session_start` y `session_end` explicitos son fragiles — Claude Code no
expone esos eventos al MCP. Solucion: el MCP detecta sesiones por
inactividad.

- Si pasaron > 30 min sin tool calls: la sesion anterior se cierra
  automaticamente y se arranca una nueva en el siguiente call.
- El "summary" de la sesion cerrada se genera concatenando los `record_*`
  acumulados, sin necesidad de llamar a un LLM.
- El cliente puede forzar inicio o fin via `mem.session_force` (tool opcional
  v0.5+).

### 2.6 Hybrid search desde el MVP

Combinar BM25 (lexical, via FTS5 nativo de SQLite) + vector search desde
dia 1. Razon: cosine similarity solo es pobre para queries con nombres
exactos (`WindowSessions`, `NC-D-018`). FTS5 viene gratis con SQLite, sin
deps adicionales.

```
base_score  = 0.4  * cosine_sim
            + 0.25 * bm25_normalized
            + 0.2  * recency_decay
            + 0.15 * usage_frequency

final_score = base_score * priority_boost     // priority_boost ∈ [1.0, 10.0], default 1.0
```

**Nota:** `priority_boost` se aplica como **factor multiplicativo**
(no aditivo). Razon: el aditivo invierte el ranking en cola larga
(una memoria con priority alta y score base ~0.001 superaria a
matches con score base 0.5). El multiplicativo preserva el orden
relativo y respeta invariancia bajo escalado. Documentado en
**ADR-002** (`docs/12-lineamientos-arquitectura.md §1.5.2`). Factores
tipicos: `1.0` (neutral) / `1.5` (warning learnings) / `3.0`
(critical learnings) / hasta `10.0` (override explicito via
`mem.remember --priority`).

### 2.7 Embeddings asincronos

`record_*` no espera al embedder. Persiste estructurado en SQLite
(sincrono, < 5ms), encola job de embedding en background queue, devuelve
inmediato. El recall posterior:
1. Si el embedding existe → busqueda hibrida normal.
2. Si aun no existe → fallback a FTS5 puro hasta que se complete.

Beneficio: latencia P95 de write < 30ms incluso con embedder lento.

### 2.8 Stateless por turno, stateful por sesion

El MCP no recuerda "que pregunto Claude en la llamada anterior" durante un
turno. Pero persiste todo lo que se le entrega via `record_*` tools. Eso si
queda en disco para sesiones futuras.

---

## 3. Componentes principales

### 3.1 Tools (handlers)

Cada tool es un handler JSON-RPC. Implementan el contrato de
[`02-protocolo-mcp.md`](./02-protocolo-mcp.md). Validan entrada, llaman al
`Recuperador` o al `Curador`, formatean salida.

Caracteristicas:
- **Side-effect-free para tools de lectura** (`mem.recall`, `mem.context`).
- **Idempotentes para escritura** cuando aplica (mismo input → mismo efecto).
- **Validacion estricta** con Zod.

### 3.2 Recuperador (Retrieval)

Modulo responsable de buscar y rankear memoria. Orquesta:

1. **Busqueda lexical** sobre FTS5 (siempre disponible).
2. **Busqueda vectorial** sobre embeddings (si disponibles).
3. **Filtrado estructurado** por kind, fecha, scope, tags.
4. **Re-ranking hibrido** combinando relevancia semantica + lexica + recency
   + uso.
5. **Token budget**: garantiza no devolver mas de `max_tokens` (token counter
   con tiktoken o heuristica `chars/4`).

### 3.3 Curador (Memory hygiene)

Modulo background que mantiene la base sana. Corre en intervalos
(cada N turnos o cada X minutos).

Tareas:

| Tarea | Disparador | Que hace |
|---|---|---|
| Decay | Cada 24h o 100 turnos | Reduce `confidence` a entries no usados |
| Consolidacion | Cada 50 turnos | Detecta entries similares (cosine > 0.92), fusiona |
| Pruning | Excede `max_entries` o `confidence < 0.1` | Borra los entries con menor score historico |
| Re-embedding | Cuando cambia el modelo embedder | Regenera vectores con embedder nuevo |
| Validacion | Continuo | Detecta paths que ya no existen, los marca stale |
| Sesion-rollup | Cada 30 min idle | Cierra sesion implicita y genera summary |

Detalle completo en [`05-memoria-decay.md`](./05-memoria-decay.md).

### 3.4 Storage Layer

Dos archivos en `.recall/`:

**`recall.db`** (SQLite con FTS5):
- Tablas estructuradas: `sessions`, `turns`, `decisions`, `learnings`,
  `entities`, `relations`, `tasks`, `audit_log`, `pruned`.
- Tablas FTS5 virtuales: `decisions_fts`, `learnings_fts`, `turns_fts`,
  `entities_fts` para busqueda lexical.
- Si modo `encrypted`: SQLCipher cifra todas las paginas con AES-256.

**`vectors.db`** (SQLite con sqlite-vec):
- Tabla virtual `embeddings` con vectores FLOAT[N].
- Tabla `embedding_metadata` con (table_name, row_id, model, embedded_text).
- Si modo `encrypted`: SQLCipher tambien cifra esta DB.

Detalle en [`03-modelo-datos.md`](./03-modelo-datos.md).

### 3.5 Embedder

Abstraccion sobre proveedor de embeddings.

- **Default:** `fastembed-js` con modelo `BGESmallEN15` (33 MB, 384 dim).
- **Opcional:** Voyage AI (cloud, requiere API key) o `MultilingualE5Base`
  (250 MB, 768 dim, mejor para espanol).
- Modelo se cachea en `~/.cache/recall/models/` (compartido entre
  proyectos).
- Si el modelo cambia, el curador regenera embeddings en background, lazy
  por workspace.

### 3.6 Logger / Observabilidad

Logs en `~/.cache/recall/logs/<fecha>.log` (rotando):
- Cada tool call con argumentos sanitizados (sin secretos).
- Tiempo de respuesta.
- Errores con stack trace.

Tabla `audit_log` en cada `recall.db` para historial por proyecto.

---

## 4. Auto-deteccion del workspace

Al recibir el primer tool call (o explicitamente via `mem.init`):

```typescript
function detectWorkspace(cwdHint?: string): string {
  let dir = path.resolve(cwdHint ?? process.cwd());
  while (dir !== path.parse(dir).root) {
    if (existsSync(path.join(dir, ".recall"))) return dir;
    if (existsSync(path.join(dir, ".git"))) return dir;
    if (existsSync(path.join(dir, "package.json"))) return dir;
    if (existsSync(path.join(dir, "Cargo.toml"))) return dir;
    if (existsSync(path.join(dir, "pyproject.toml"))) return dir;
    if (existsSync(path.join(dir, "go.mod"))) return dir;
    dir = path.dirname(dir);
  }
  return cwdHint ?? process.cwd();   // fallback: cwd literal
}
```

El cliente puede pasar `workspace_path` explicito si quiere override.

---

## 5. Flujo de un turno tipico

Caso: usuario pide "implementa la feature X de la fase 1".

```
1. Claude Code recibe el prompt.
2. Claude (via system prompt) llama:
      → mem.context({query: "feature X fase 1", max_tokens: 4000})
3. MCP server:
   a. Detecta workspace (camina hacia arriba desde cwd).
   b. Lee config.json del workspace, abre recall.db (con SQLCipher si
      encrypted; si key no esta en HOME → error -32107).
   c. Genera embedding de la query (o usa el cache).
   d. Recupera capas 1-7: identity, constitution, active tasks, recent
      turns, relevant memory (hybrid search), code map, open questions.
   e. Aplica budget de tokens, devuelve bundle.
4. Claude usa el bundle para componer su respuesta.
5. Mientras trabaja, si descubre algo nuevo:
      → mem.remember({kind: "learning", content: "..."})
   El MCP persiste sincrono, encola embedding async, devuelve id inmediato.
6. Al detectar inactividad de 30 min, el MCP cierra sesion implicita y
   genera summary automatico.
```

---

## 6. Que es responsabilidad del MCP y que del cliente

| Responsabilidad | MCP | Cliente (Claude Code) |
|---|:---:|:---:|
| Persistir memoria | ✓ | |
| Calcular embeddings | ✓ | |
| Re-ranking hibrido | ✓ | |
| Decay y consolidacion | ✓ | |
| Auto-deteccion del workspace | ✓ | |
| Cifrado / descifrado | ✓ | |
| Decidir cuando llamar al MCP | | ✓ |
| Decidir que pregunta hacer | | ✓ |
| Resumir turnos antes de enviar | | ✓ |
| Mostrar UI al usuario | | ✓ |
| Pedirle al usuario la clave de unlock | | ✓ (via prompt) o CLI directo |

**Regla de oro:** el MCP es **memoria**, no **agente**. No "decide" cuando
hablar; espera a que el cliente le pregunte. No "actua" sobre el codigo;
solo recuerda.

---

## 7. Multi-tenancy / Multi-cliente

Cada cliente MCP arranca su propia instancia del servidor. Si el usuario
tiene abiertos:
- Claude Code en proyecto A → instancia 1
- Cursor en proyecto A → instancia 2

**Cada instancia abre el mismo SQLite del proyecto.** SQLite con WAL mode
soporta multi-reader y un escritor a la vez. Los writes son cortos
(insert/update), no hay contencion practica.

Si dos instancias intentan escribir la misma fila simultaneamente, SQLite
serializa con un mutex. Aceptable.

---

## 8. Resiliencia y errores

### Errores recuperables

- Embedder no disponible → fallback a FTS5 (lexical search) puro.
- Disco lleno → rechazar writes con error claro, mantener reads.
- Base corrupta → mover a `recall.db.broken-<timestamp>`, restaurar desde
  snapshot mas reciente o crear nueva, loggear.
- Modo encriptado sin clave → error `-32107 ENCRYPTED_LOCKED` con
  instruccion de unlock.

### Errores fatales

- No se puede crear `.recall/` (permisos) → exit 1 con mensaje claro.

### Idempotencia

Todas las tools de escritura son idempotentes via `id` opcional:
- Si el cliente envia `id` y ya existe → update.
- Si no envia `id` → insert con id autogenerado (uuid v7).

---

## 9. Seguridad

Vision general (detalle en `11-seguridad-modos.md`):

### Datos sensibles (deteccion en 5 capas)

1. **Pre-write**: detector regex (API keys, JWT, passwords) + entropy check
   sobre cualquier `record_*`. Rechaza con error `-32105` si detecta secret
   con confidence > 0.9.
2. **Path sanitizer**: paths con `/Users/<nombre>` o `/home/<nombre>` se
   reescriben a `~/...` antes de persistir.
3. **Pre-commit hook opcional**: `recall install-hook` instala hook git
   que escanea `.recall/` antes de cada commit.
4. **Auditoria on-demand**: `recall audit --check-secrets` escanea toda
   la DB con detectores actualizados.
5. **Sanitizacion post-hoc**: `recall sanitize --entry-id ...` reemplaza
   contenido por `[REDACTED]` y regenera embedding.

### Path traversal

Workspace path se canonicaliza al recibirlo (resuelve `..`, symlinks).

### Code injection en queries

Las queries se procesan via prepared statements de SQLite. Sin riesgo SQL
injection.

### Permisos de archivo

`.recall/` con `0700` en Unix. Archivos `.db` con `0600`. Claves en
HOME con `0600`.

---

## 10. Performance objetivo

| Operacion | Latencia objetivo (p95) |
|---|---|
| `mem.recall` (8 results, 50K entries) | < 100ms |
| `mem.context` (bundle de 7 capas) | < 200ms |
| `mem.remember` (sincrono, antes de embed async) | < 30ms |
| Curador full pass (10K entries) | < 5s background |
| Cold start del server | < 200ms |
| Cold start con DB encrypted | < 400ms (incluye decrypt validation) |

Con sqlite-vec en memoria + WAL + indices apropiados + FTS5, esto es
alcanzable en hardware modesto (Mac M1, laptop linux 2020+).

---

## 11. Que NO esta en esta arquitectura

- **No hay LLM dentro del MCP.** El MCP no llama a Claude. Solo Claude llama
  al MCP. Si en el futuro queremos resumenes mas ricos de turnos, el cliente
  los envia en el `summary` del session_end.
- **No hay UI.** El MCP es headless. Si se quiere visualizar la memoria, se
  construye una CLI (incluida) o web app aparte que lee la misma base
  SQLite.
- **No hay capa global cross-proyecto en MVP.** Para preferencias del usuario
  ("siempre conventional commits"), el sitio adecuado es `~/.claude/CLAUDE.md`.
  Cada proyecto su memoria.
- **No hay sync multi-maquina automatico.** Si modo `shared` o `encrypted`,
  git ES el sync. Si modo `private`, no hay sync (es deliberado).
- **No hay marketplace de "memorias prefabricadas".** Cada workspace empieza
  vacio. La memoria se construye por uso.
