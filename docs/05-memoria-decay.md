# 05 — Memoria, decay y self-healing

> Como la memoria se mantiene sana sola: olvido controlado, consolidacion,
> recuperacion de gaps. Ejecutado por el Curador, sin intervencion del
> usuario.

---

## 1. Por que memoria con decay

Sin decay, la memoria crece linealmente y eventualmente:
- Cada `mem.recall` devuelve resultados de hace 6 meses irrelevantes.
- Lecciones obsoletas siguen "ganando" porque tienen mas `use_count`
  historico.
- El curso del proyecto cambia y la "constitucion" antigua compite con la
  nueva.

**Decay = olvido suave guiado.** No borra; baja la prioridad. Solo lo
genuinamente irrelevante se borra (pruning).

---

## 2. Modelo de decay

Cada entrada tiene tres senales:

| Senal | Rango | Que hace |
|---|---|---|
| `confidence` | 0.0 - 1.0 | Cuanto confiamos en que es relevante hoy |
| `last_used_ms` | timestamp | Cuando fue la ultima vez que se devolvio en un recall |
| `use_count` | int | Cuantas veces se uso en total |

### Formula de decay

```
nuevo_confidence = confidence_actual * decay_factor ^ (dias_sin_uso / decay_period_dias)
```

Default: `decay_factor=0.95`, `decay_period_dias=30`.

Significa:
- Tras 30 dias sin uso: confidence × 0.95
- Tras 60 dias: × 0.90
- Tras 1 ano: × 0.54

Cuando `confidence < 0.1` → candidato a pruning.

### Refresh por uso

Cada vez que un recall devuelve la entrada y aparece en el bundle:

```
confidence = min(1.0, confidence + 0.1)
last_used_ms = now()
use_count += 1
```

### Decay diferencial por kind

| Kind | Decay factor | Decay period (dias) |
|---|---|---|
| decision (active) | 0.99 | 90 |
| decision (superseded) | 0.5 | 7 (rapido) |
| learning (critical) | 1.0 | ∞ (sin decay) |
| learning (warning) | 0.97 | 60 |
| learning (tip) | 0.95 | 30 |
| turn | 0.85 | 14 |
| entity | 0.95 | 30 |
| task (done) | 0.9 | 7 |
| task (open) | 1.0 | ∞ |

Configurable via `.mcp-memoria/config.json`.

---

## 3. Consolidacion semantica

Detecta entradas semanticamente similares y las fusiona en una.

### Trigger

Cada N inserts (`config.curator.consolidation_check_every`, default 50) o
cuando el cliente llama `mem.curator_run`.

### Algoritmo

```typescript
async function consolidate(workspace: Workspace) {
  const candidates = await getActiveLearnings();

  // O(n^2) acotado a < 500 candidatos por pasada
  for (const a of candidates) {
    for (const b of candidates) {
      if (a.id >= b.id) continue;
      const sim = cosineSimilarity(a.embedding, b.embedding);
      if (sim > THRESHOLD) {  // default 0.92
        await mergePair(a, b);
      }
    }
  }
}

async function mergePair(a: Learning, b: Learning) {
  // Survivor: el de mayor (use_count + confidence)
  const survivor = score(a) >= score(b) ? a : b;
  const dropped = survivor === a ? b : a;

  // Combina contenidos si son distintos pero complementarios
  const mergedContent = await llmMerge(survivor.content, dropped.content)
                       ?? `${survivor.content}\n[fusionado: ${dropped.content}]`;

  await update(survivor.id, {
    content: mergedContent,
    use_count: survivor.use_count + dropped.use_count,
    confidence: max(survivor.confidence, dropped.confidence),
  });

  await markConsolidated(dropped.id, into: survivor.id);
}
```

`llmMerge` es opcional. Si el cliente expuso un endpoint LLM al MCP via
config, se usa para fusionar; si no, fallback simple a concatenacion.

### Que NO consolida

- **Decisions:** NUNCA fusionarse automaticamente. Solo via `superseded_by`
  explicito.
- **Entities:** solo si tienen mismo `name + entity_kind`.
- **Tasks:** nunca.
- **Turns:** solo si son del mismo `session_id` y parecen redundantes.

---

## 4. Pruning

Borra entradas con `confidence < 0.1` Y `use_count == 0` Y `created_at >
30 dias`.

```sql
INSERT INTO pruned (id, original_table, original_id, content_snapshot, pruned_at_ms, reason)
SELECT
  hex(randomblob(16)) AS id,
  'learnings' AS original_table,
  id AS original_id,
  content AS content_snapshot,
  CAST(strftime('%s', 'now') * 1000 AS INTEGER) AS pruned_at_ms,
  'low_confidence_unused' AS reason
FROM learnings
WHERE confidence < 0.1
  AND use_count = 0
  AND created_at_ms < strftime('%s', 'now', '-30 days') * 1000;

DELETE FROM learnings
WHERE confidence < 0.1
  AND use_count = 0
  AND created_at_ms < strftime('%s', 'now', '-30 days') * 1000;
```

Equivalente para `turns`. Para `entities` y `decisions` solo si fueron
explicitamente marcadas obsoletas.

**Pruning preserva audit trail:** se mueve a tabla `pruned` con razon y
fecha. Permite recovery por 30 dias antes de borrarse fisicamente.

---

## 5. Self-healing

Detecta gaps y los rellena.

### Caso 1: Path stale

Entries que referencian paths que ya no existen.

```typescript
async function validateEntities(workspace: Workspace) {
  const entities = await getEntitiesWithLocation();
  for (const e of entities) {
    const [path, line] = parseLocation(e.location);
    const absolutePath = path.startsWith("/") || path.startsWith("~")
      ? expandHome(path)
      : path.join(workspace.path, path);
    if (!await fileExists(absolutePath)) {
      await markStale(e.id);  // confidence /= 2, tag "stale"
    }
  }
}
```

Stale entries siguen apareciendo en recall pero con score reducido y un
tag que el cliente puede mostrar al usuario.

### Caso 2: Decision contradictoria

Si dos decisions con scope/module iguales pero rationales contrarios:

```typescript
async function detectConflicts(workspace: Workspace) {
  const decisions = await getActiveDecisions();
  for (const a of decisions) {
    for (const b of decisions) {
      if (a.id >= b.id) continue;
      if (a.scope === b.scope && a.module === b.module) {
        const contradiction = await detectContradiction(a, b);
        if (contradiction) {
          await tagAsConflict(a.id, b.id);
          // No resolvemos automaticamente. El cliente avisa al usuario.
        }
      }
    }
  }
}
```

`detectContradiction` heuristica: cosine similarity de embeddings
"normales" alta + cosine de embeddings "negados" tambien alta. Aproximacion;
no perfecto.

### Caso 3: Open question sin resolver

Si una `open_question` lleva > 3 sesiones sin tocarse:

- Se marca con tag `aging`.
- Aparece con prioridad alta en capa 7.
- En el `mem.context` bundle se incluye al inicio para forzar que el
  cliente la considere.

### Caso 4: Re-retrieval cuando recall vacio

Si `mem.recall` devuelve 0 resultados pero la query parece relevante
(longitud > 5 palabras, no es saludo):

```typescript
async function recallWithSelfHealing(query: string, ...) {
  let results = await recallStandard(query);

  if (results.length === 0 && looksRelevant(query)) {
    // Ampliar busqueda: relajar threshold, BM25 puro sin vector
    results = await recallExpanded(query);
  }

  return results;
}
```

### Caso 5: Embedding queue stuck

Si `embedding_queue` tiene items con `attempts > 5` y `last_error` repetido:

- Curador los marca como permanentes-fallidos.
- Loggea para debug.
- Esos entries solo se buscan via FTS5 hasta que el problema se resuelva.

---

## 6. Curador: el job background

Modulo que orquesta decay, consolidacion, pruning, validacion.

### Cuando corre

- Auto: cada `auto_run_every_n_turns` calls al MCP (default 100).
- Manual: `mem.curator_run`.
- Programado: timer cada 24h si el server lleva mucho idle.
- Sesion-rollup: cada 30 min de inactividad → cierra sesion implicita,
  genera summary.

### Pasada completa

```
1. Snapshot: cp memoria.db snapshots/<ts>-pre-curator.db
              cp vectors.db snapshots/<ts>-pre-curator-vectors.db
2. Apply decay (todos los kinds)
3. Detect & merge consolidations
4. Detect path stale + tag
5. Detect decision conflicts + tag
6. Process embedding_queue pendientes
7. Prune candidatos
8. Re-embed entries cuyo content cambio (consolidaciones)
9. Re-embed si modelo cambio (lazy, batch)
10. VACUUM si freelist > threshold
11. Update curator_runs con metricas
```

Tiempo objetivo: < 5s para 10K entries. Si excede, dividir en partes y
correr incrementalmente.

### Modo dry_run

Cuando `mem.curator_run({dry_run: true})`, solo reporta que haria sin
modificar nada. Permite al cliente avisar al usuario antes.

---

## 7. Sesion-rollup automatico

Cada 30 min de inactividad (configurable via
`session_idle_timeout_min`):

1. Cerrar la sesion abierta marcando `ended_at_ms = now()`.
2. Generar summary automatico:
   - Concatenar summaries de turns de esta sesion (top 5 por confidence).
   - Listar decisions y learnings agregados.
   - Listar tasks creadas o cambiadas de estado.
3. Si hay open_questions pendientes (registradas via `record_*` con tag
   `open_question`), agregarlas a `metadata_json.open_questions`.
4. Persistir.

El cliente puede forzar inicio/fin via `mem.session_force` (v0.5+).

---

## 8. Privacidad y control del usuario

### Comando `mem.forget`

Tool del MCP (v0.5+) para borrado deliberado:

```typescript
mem.forget({
  query: "<que olvidar>",
  confirm_ids?: string[]
})
```

Workflow:
1. Sin `confirm_ids`: devuelve lista de candidatos por similaridad.
2. Usuario confirma.
3. Cliente llama de nuevo con `confirm_ids`.
4. MCP los marca como pruned permanente (no recoverable, no van a tabla
   `pruned` sino se borran del todo).

### Wipe completo

```bash
mcp-memoria wipe --workspace . --confirm
```

Borra `.mcp-memoria/memoria.db` y `.mcp-memoria/vectors.db`. Mantiene
`config.json` (el workspace_id sigue siendo el mismo). Si modo encrypted,
la clave en HOME tambien se preserva (sigue siendo "el mismo" workspace,
solo vacio).

### Export completo

```bash
mcp-memoria export --workspace . --output backup.json
```

Devuelve JSON con todo el contenido de `memoria.db`. No incluye embeddings
(regenerables). Permite portar.

---

## 9. Metricas del curador

El curador loggea en tabla `curator_runs`:

```json
{
  "id": "01952f...",
  "started_at_ms": 1745020000000,
  "ended_at_ms": 1745020002300,
  "duration_ms": 2300,
  "decay_applied_to": 1240,
  "consolidations": 12,
  "pruned": 3,
  "stale_marked": 5,
  "conflicts_detected": 0,
  "reembedded": 0,
  "size_before_bytes": 19087360,
  "size_after_bytes": 18769920,
  "success": 1
}
```

Visualizable via:

```bash
mcp-memoria curator-log --workspace . [--last 5]
```

---

## 10. Anti-patrones a evitar

| Anti-patron | Por que mal | Solucion |
|---|---|---|
| Borrar todo lo viejo | Pierde contexto historico relevante | Decay + pruning conservador |
| No olvidar nunca | DB crece, recall ruidoso | Decay con politica clara |
| Auto-merge agresivo | Perdida de matices | Threshold alto (0.92), require similar context |
| Llamar al curador en cada turno | Latencia | Cada 100 turnos o background |
| Cifrar `pruned` con clave perdida | Audit trail no recoverable | `pruned` se mantiene legible junto al resto en modo encrypted (es la misma DB) |
| Sin backup pre-curator | No-recovery | Snapshot automatico siempre |
| Re-embed sincrono al cambiar modelo | Bloquea sesiones | Lazy + queue, fallback a FTS5 mientras |
