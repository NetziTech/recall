# 02 — Protocolo MCP: tools expuestos

> Contrato completo de tools. Esto es lo que Claude ve. La descripcion de cada
> tool es lo que decide al modelo cuando llamar cada una.

---

## 1. Convenciones

- **Identificadores**: `uuid v7` (sortable por tiempo).
- **Timestamps**: `ms` desde epoch UTC (numero entero).
- **Workspace**: el MCP auto-detecta caminando hacia arriba desde `cwd`. El
  cliente puede pasar `workspace_path` explicito si quiere override. El
  `workspace_id` se obtiene leyendo `.recall/config.json`.
- **`workspace_id` en tools/call**: SIEMPRE opcional en el wire (los Zod
  schemas lo marcan `.optional()`). Los clientes MCP estandar (Claude
  Code, Cursor, ...) NO lo envian — se auto-resuelve desde el `cwd` con
  el que el cliente lanzo al servidor. Cuando el cliente lo provee
  explicitamente, override el default del bootstrap (util para tests
  E2E y futuros clientes multi-workspace). Wire malformado → `-32602`.
- **Tokens**: cuando un tool acepta `max_tokens`, el servidor respeta
  garantizadamente ese tope (token counter via tiktoken o heuristica).
- **Errores**: JSON-RPC standard `code` + `message` + `data`. Codigos custom
  en rango `-32100` a `-32199`.
- **Prefijo**: todas las tools con `mem.` para evitar choques con otros MCPs.

---

## 2. MVP — 6 tools (semana 1)

| Tool | Tipo | Proposito |
|---|---|---|
| `mem.init` | escritura | Inicializa workspace, elige modo |
| `mem.context` | lectura | Bundle de capas para inicio de turno |
| `mem.recall` | lectura | Busqueda flexible (semantica + lexical + filtros) |
| `mem.remember` | escritura | Persiste decision/learning/entity/turn (kind como param) |
| `mem.task` | escritura+lectura | CRUD unificado de tasks |
| `mem.health` | lectura | Estado del workspace |

---

## 3. v0.5 — 6 tools adicionales

| Tool | Tipo | Proposito |
|---|---|---|
| `mem.search_entities` | lectura | Grafo: encuentra entidades + relaciones |
| `mem.export_handoff` | lectura | Genera markdown estilo HANDOFF.md |
| `mem.forget` | escritura | Borrado deliberado por usuario |
| `mem.curator_run` | escritura | Fuerza pasada del curador |
| `mem.session_force` | escritura | Forzar inicio o fin de sesion |
| `mem.audit` | lectura | Auditoria on-demand (secrets, paths stale, etc.) |

---

## 4. Detalle de las 6 tools del MVP

### 4.1 `mem.init`

Inicializa o re-abre el workspace. Idempotente.

**Input:**
```typescript
{
  workspace_path?: string;          // optional, default: auto-detect from cwd
  mode?: "shared" | "encrypted" | "private";  // solo si es nuevo workspace
  display_name?: string;
  metadata?: Record<string, any>;   // libre: { language: "rust", phase: "1" }
}
```

**Output:**
```typescript
{
  workspace_id: string;             // uuid v7 estable, vive en config.json
  workspace_path: string;            // path absoluto canonico detectado
  display_name: string;
  mode: "shared" | "encrypted" | "private";
  is_new: boolean;                  // true si fue creado en este call
  total_entries: number;
  schema_version: string;
  encryption_status?: "unlocked" | "locked";  // solo si mode=encrypted
}
```

**Errores:**
- `-32107` si modo `encrypted` y no hay clave en HOME → cliente debe pedir
  unlock al usuario.

**Cuando lo llama Claude:** primer turno de cada sesion (idealmente desde
el system prompt).

**Comportamiento si workspace ya existe:**
- Lee `.recall/config.json`, devuelve metadata.
- Ignora `mode` del input (no se cambia con init; usar `recall mode`).
- Si encrypted: intenta abrir con clave en HOME; si falla, devuelve
  `encryption_status: "locked"`.

---

### 4.2 `mem.context`

Devuelve el bundle ensamblado de capas (ver `04-capas-contexto.md`). Util al
inicio de turno o cuando se necesita contexto general.

**Input:**
```typescript
{
  workspace_id?: string;            // si omite, auto-detect
  query?: string;                   // si omite, capas 5-6 se omiten (no hay query)
  max_tokens?: number;              // default 4800
  layer_overrides?: Partial<Record<LayerName, number>>;
  include_layers?: LayerName[];     // si omite, todas
  exclude_layers?: LayerName[];
}

type LayerName =
  | "system_identity"
  | "project_constitution"
  | "active_tasks"
  | "recent_turns"
  | "relevant_memory"
  | "code_map"
  | "open_questions";
```

**Wire ↔ domain mapping (ver ADR-003 en `docs/12 §1.5.3`):** los
literales `LayerName` de la wire format **no coinciden** con los
nombres del bounded context retrieval (`ContextLayerKind`). El
composition root mantiene una tabla bidireccional canonica:

| `LayerName` (wire) | `ContextLayerKind` (domain) |
|---|---|
| `system_identity` | `workspace_anchor` |
| `project_constitution` | `project_constitution` |
| `active_tasks` | `active_decisions` + tasks subset |
| `recent_turns` | `recent_turns` |
| `relevant_memory` | `entities_in_focus` + `suggested_next` subset |
| `code_map` | `entities_in_focus` filtrado por `kind='module'` |
| `open_questions` | `open_questions` |

El cliente (Claude Code) consume **solo los literales wire**. El
mapping vive en
`composition/wiring/context-layer-mapper.ts` como Anti-Corruption
Layer canonico DDD entre el bounded context retrieval y el contrato
MCP. Ver ADR-003 para justificacion completa.

**Output:**
```typescript
{
  bundle: {
    layers: Array<{
      id: number;                    // 1..7
      name: LayerName;
      content: string;               // formateado markdown listo para inyectar
      tokens: number;
      entries_count: number;
    }>;
    total_tokens: number;
  };
}
```

**Cuando lo llama Claude:** primer turno de cada sesion (despues de
`mem.init`), o cuando cambia drasticamente el contexto del usuario.

---

### 4.3 `mem.recall`

Busqueda flexible. Reemplaza `recall_relevant` + `recall_by_kind` +
`recall_recent`.

**Input:**
```typescript
{
  workspace_id?: string;             // si omite, auto-detect desde cwd
  query?: string;                    // si omite, devuelve recientes filtrados
  kinds?: Kind[];                    // filtra por tipo
  top_k?: number;                    // default 8
  max_tokens?: number;               // default 2000
  order_by?: "relevance" | "recency" | "score" | "usage";  // default: relevance si query, recency si no
  since_ms?: number;
  must_have_tags?: string[];
  must_not_have_tags?: string[];
  scope?: "project" | "module";
  module?: string;
  include_superseded?: boolean;      // default false
}

type Kind = "decision" | "learning" | "turn" | "entity" | "task" | "any";
```

**Output:**
```typescript
{
  results: MemoryEntry[];
  total_candidates: number;
  total_tokens: number;
  fallback_reason?: "no_embeddings_yet" | "embedder_unavailable";
}

type MemoryEntry = {
  id: string;
  kind: Kind;
  content: string;                   // texto humano-legible listo para inyectar
  metadata: Record<string, any>;
  score: number;                     // 0..1 final score (cosine + bm25 + recency + ...)
  created_at: number;
  last_used_ms: number;
  tags: string[];
};
```

**Comportamiento del scoring:**
- Si `query` provisto:
  - Hybrid: BM25 (FTS5) + cosine (sqlite-vec) + recency + usage + priority.
  - Si embeddings de algunos entries no estan listos → solo BM25 + recency
    para esos. El campo `fallback_reason` indica si hubo degradacion.
- Si `query` omitido:
  - Solo `order_by` decide. Default recency.

**Cuando lo llama Claude:** cada vez que necesita contexto sobre algo del
proyecto. Es la **tool de uso mas frecuente** despues de `mem.context` en
el primer turno.

---

### 4.4 `mem.remember`

Persiste una entry. `kind` decide a que tabla va. Reemplaza
`record_decision` + `record_learning` + `record_entity` + `record_turn`.

**Input (forma comun):**
```typescript
{
  workspace_id?: string;             // si omite, auto-detect desde cwd
  kind: "decision" | "learning" | "entity" | "turn";
  content: string;                   // texto principal
  id?: string;                       // si proveido, upsert
  tags?: string[];
  scope?: "project" | "module";
  module?: string;
}
```

**Input (campos especificos por kind):**

| Kind | Campos especificos |
|---|---|
| `decision` | `title`, `rationale` (separar de content), `alternatives_rejected`, `superseded_by` |
| `learning` | `trigger`, `severity` ("tip" \| "warning" \| "critical") |
| `entity` | `name`, `entity_kind` ("struct"\|"module"\|"service"\|"agent"\|"file"), `location`, `relations` |
| `turn` | `intent`, `outcome`, `files_touched`, `decisions_made`, `learnings_added` |

Ejemplos:

```typescript
mem.remember({
  kind: "decision",
  title: "Usar Tauri en vez de Electron",
  content: "Decidimos Tauri v2 sobre Electron",
  rationale: "Liviano, mejor performance, IP protegida",
  alternatives_rejected: ["Electron", "Wails", "Neutralino"],
  scope: "project",
  tags: ["stack", "fase-0"]
})

mem.remember({
  kind: "learning",
  content: "siempre canonicalizar paths antes de comparar",
  trigger: "se rompio comparacion en multi-ventana",
  severity: "warning",
  tags: ["filesystem"]
})

mem.remember({
  kind: "entity",
  name: "WindowSessions",
  entity_kind: "struct",
  content: "Estructura que mantiene sesiones por ventana",
  location: "src/commands/workspace_commands.rs:67",
  relations: [
    { relation: "uses", target_name: "WindowHolder" },
    { relation: "exposes", target_name: "find_label_with_path" }
  ]
})
```

**Output:**
```typescript
{
  id: string;
  kind: Kind;
  upserted: boolean;                 // true si fue update vs insert
  similar_existing?: string[];        // ids de entries muy parecidos detectados
  embedding_status: "queued" | "ready" | "skipped";
}
```

Si `similar_existing` no esta vacio (cosine > 0.85 detectado al insertar),
el cliente puede:
- Decidir consolidar manualmente (llamar `mem.remember` con `id` del
  existente).
- Dejar que el curador lo haga eventualmente.
- Ignorar.

**Validaciones:**
- Capa 1 de secrets aplicada en `content`, `rationale`, `trigger`,
  `description`.
- Capa 2 (path sanitizer) aplicada a todos los strings.
- Si error → `-32105` con detalle.

---

### 4.5 `mem.task`

CRUD unificado de tasks. Reemplaza `record_task` + `update_task` +
`list_tasks`.

**Input:**
```typescript
{
  workspace_id?: string;             // si omite, auto-detect desde cwd
  action: "create" | "update" | "list" | "get" | "delete";

  // create
  title?: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  blocked_by?: string[];
  tags?: string[];

  // update | get | delete
  task_id?: string;
  status?: "pending" | "in_progress" | "done" | "blocked";
  notes?: string;

  // list
  filter?: {
    status?: "pending" | "in_progress" | "done" | "blocked" | "any";
    tags?: string[];
    limit?: number;
  };
}
```

**Output:**
```typescript
// create | update
{ task_id: string; updated_at: number; }

// get
{ task: Task; }

// list
{ tasks: Task[]; }

// delete
{ deleted: boolean; }

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "done" | "blocked";
  priority: "low" | "medium" | "high";
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  blocked_by: string[];
  notes: Array<{ at: number; text: string }>;
  tags: string[];
};
```

---

### 4.6 `mem.health`

Diagnostico del estado.

**Input:**
```typescript
{
  workspace_id?: string;             // si omite, auto-detect desde cwd
  verbose?: boolean;                 // si true, incluye detalle por tabla
}
```

**Output:**
```typescript
{
  schema_version: string;
  workspace_id: string;
  workspace_path: string;
  mode: "shared" | "encrypted" | "private";
  encryption_status: "unlocked" | "locked" | "n/a";

  total_entries: number;
  entries_by_kind: Record<string, number>;
  size_bytes: { memoria_db: number; vectors_db: number };

  active_session: { id: string; started_at: number } | null;
  last_curator_run: number | null;
  embedding_model: string;
  embedding_queue_pending: number;

  fts_health: "ok" | "rebuild_recommended";
  vector_index_health: "ok" | "rebuild_recommended" | "broken";

  warnings?: string[];               // ej: ["5 paths stale", "embedder slow"]
}
```

> **Deuda wire-schema (`size_bytes.memoria_db`).** El nombre del paquete
> migro de `mcp-memoria` a `@netzi/recall` antes del v0.1.0; el campo
> wire `size_bytes.memoria_db` quedo con el nombre legacy. v0.1.0 ya lo
> publico con ese nombre, asi que renombrar a `recall_db` ahora seria
> un break-de-shape para clientes que lo snapshottearon. Se preserva
> hasta el proximo major; el unit test
> `mcp-server-facades-workspace-id.test.ts` lo pinea para evitar
> regresiones accidentales.

---

## 5. Detalle de las tools de v0.5

### 5.1 `mem.search_entities`

Busca entidades y traversa relaciones.

**Input:**
```typescript
{
  workspace_id?: string;
  query?: string;                    // semantica sobre name+description
  start_from_entity_id?: string;     // entity_id desde donde traversar
  follow_relations?: string[];       // ej: ["uses", "depends_on"]
  max_depth?: number;                // default 2
  limit?: number;
}
```

**Output:**
```typescript
{
  entities: Entity[];
  edges: Edge[];
}

type Entity = {
  id: string;
  name: string;
  entity_kind: string;
  description: string;
  location: string | null;
};

type Edge = {
  from: string;
  to: string;
  relation: string;
};
```

---

### 5.2 `mem.export_handoff`

Genera un markdown estilo HANDOFF.md.

**Input:**
```typescript
{
  workspace_id?: string;
  format?: "markdown" | "json";       // default markdown
  include?: Array<"summary" | "decisions" | "tasks" | "learnings" | "open_questions" | "entities">;
  max_chars?: number;                 // default 8000
}
```

**Output:**
```typescript
{
  format: string;
  content: string;
  generated_at: number;
}
```

---

### 5.3 `mem.forget`

Borrado deliberado por usuario.

**Input:**
```typescript
{
  workspace_id?: string;
  query?: string;                     // describe lo que quiere olvidar
  confirm_ids?: string[];             // si especifica, borra solo esos
}
```

**Output:**
```typescript
// sin confirm_ids: lista candidatos
{
  candidates: Array<{
    id: string;
    kind: Kind;
    preview: string;
    score: number;
  }>;
  total: number;
}

// con confirm_ids: borra
{
  deleted_count: number;
}
```

---

### 5.4 `mem.curator_run`

Fuerza pasada del curador.

**Input:**
```typescript
{
  workspace_id?: string;
  tasks?: Array<"decay" | "consolidate" | "prune" | "validate" | "reembed">;
  dry_run?: boolean;
}
```

**Output:**
```typescript
{
  decay_applied_to: number;
  consolidated_pairs: number;
  pruned: number;
  validated_stale: number;
  reembedded: number;
  duration_ms: number;
}
```

---

### 5.5 `mem.session_force`

Forzar inicio o fin de sesion. Casos: usuario quiere marcar manualmente
inicio de bloque, o cliente detecta `/clear`.

**Input:**
```typescript
{
  workspace_id?: string;
  action: "start" | "end";

  // action = start
  intent?: string;
  resumed_from_session?: string;

  // action = end
  summary?: string;                   // si omite, MCP genera de los record_* acumulados
  open_questions?: string[];
  next_session_seed?: string;
}
```

**Output:**
```typescript
// start
{ session_id: string; started_at: number; context_seed: ContextSeed; }

// end
{ ended_at: number; turns_recorded: number; duration_ms: number; }

type ContextSeed = {
  project_summary: string;
  current_phase: string | null;
  active_tasks: Task[];
  recent_decisions: Decision[];
  pending_questions: string[];
};
```

---

### 5.6 `mem.audit`

Auditoria on-demand.

**Input:**
```typescript
{
  workspace_id?: string;
  checks?: Array<"secrets" | "paths_stale" | "decision_conflicts" | "embedding_drift" | "schema_integrity">;
  strict?: boolean;                   // si true, exit code != 0 en CI cuando hay hallazgos
}
```

**Output:**
```typescript
{
  findings: Array<{
    check: string;
    severity: "info" | "warning" | "error";
    entry_id?: string;
    detail: string;
    suggested_fix?: string;
  }>;
  duration_ms: number;
}
```

---

## 6. Errores estandar

| Codigo | Significado | Accion del cliente |
|---|---|---|
| `-32100` | Workspace no encontrado | Llamar `mem.init` primero |
| `-32101` | Sesion expirada (timeout 30 min) | Reintentar; el MCP auto-arranca nueva |
| `-32102` | Embedding service no disponible | Reintentar o aceptar fallback a FTS5 |
| `-32103` | Disco lleno | Avisar al usuario |
| `-32104` | Schema version incompatible | El MCP corre migracion automatica al inicio; este error solo si fallan |
| `-32105` | Secret detected in input | Sanitizar y reintentar |
| `-32106` | Rate limit (curador corriendo) | Esperar y reintentar |
| `-32107` | ENCRYPTED_LOCKED — sin clave | Cliente pide al usuario `recall unlock` |
| `-32108` | INVALID_KEY | Verificar clave |
| `-32109` | KEY_REVOKED — clave invalidada por rekey | Pedir clave nueva |
| `-32110` | TASK_NOT_FOUND — `task_id` desconocido en `mem.task.get` / `mem.task.delete` (y `update`) | Refrescar `mem.task.list` y reintentar con un id valido |

---

## 7. Resources MCP (opcional, v1.0)

Ademas de tools, el MCP puede exponer **resources** estilo URI:

- `memory://workspace/<id>/summary`
- `memory://workspace/<id>/decisions`
- `memory://workspace/<id>/tasks`
- `memory://workspace/<id>/handoff`

Permiten al cliente "leer" memoria sin invocar tool, util para inyeccion en
context windows.

---

## 8. System prompt recomendado para el cliente

```markdown
## Memoria persistente (MCP `memoria`)

Tienes acceso al MCP `memoria` que persiste informacion del proyecto.

**Al inicio de cada sesion (primer turno):**
1. `mem.init` — auto-detecta y abre el workspace.
2. Si retorna `encryption_status: "locked"`, dile al usuario que ejecute
   `recall unlock --workspace <path>` antes de continuar.
3. `mem.context({query: "<lo que pidio el usuario>"})` para cargar las
   capas relevantes.

**Durante la sesion:**
- `mem.recall` cuando necesites contexto sobre algo del proyecto que no
  es obvio del archivo actual.
- `mem.remember({kind: "decision"})` cuando se tome una decision
  arquitectonica significativa.
- `mem.remember({kind: "learning"})` cuando descubras algo no-obvio del
  proyecto (un patron, una restriccion, un gotcha).
- `mem.remember({kind: "turn"})` al cerrar un bloque significativo.
- `mem.task` para tasks que persistan entre sesiones.

**Reglas de oro:**
- Es mejor consultar la memoria de mas que de menos. Cada `mem.recall`
  cuesta ~50ms.
- Es peor sub-registrar que sobre-registrar (el curador limpia exceso).
- Las decisiones vencen via `superseded_by`, NO via overwrite.
- No registres secretos / credenciales (el MCP los rechaza, pero igual
  evita el round-trip).
- No registres turnos triviales. Solo turnos significativos.
```
