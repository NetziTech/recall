# 04 — Capas de contexto

> Como se organiza la memoria semanticamente. Que entra, como se recupera,
> cuanto presupuesto de tokens consume cada una.

---

## 1. Por que capas

El contexto no es plano. Hay tipos de informacion con caracteristicas muy
distintas:

- **Estables vs efimeras** (decisiones arquitectonicas vs notas de un turno).
- **Globales del proyecto vs locales del modulo** (constitucion del repo
  vs del modulo `editor/`).
- **Frias vs calientes** (lecciones de hace 3 meses vs intent del turno
  actual).

Tratarlas todas igual lleva a:
- Diluir lo importante con ruido reciente.
- Olvidar restricciones criticas porque "ya paso mucho tiempo".
- Recuperar info global cuando se necesita local.

Solucion: 7 capas con presupuestos y politicas independientes. Inspirado en
la arquitectura de `Coder` (10 capas) pero adaptado al MCP.

**Cambio vs spec original:** se elimino la antigua "capa 8 — Global
Learnings" (cross-proyecto). El MVP no la incluye porque la memoria del MCP
es PER-PROYECTO. Para preferencias del usuario que aplican a todos los
proyectos, el sitio adecuado es `~/.claude/CLAUDE.md`.

---

## 2. Las 7 capas

| # | Capa | Estabilidad | Presupuesto default | Origen |
|---|---|---|---|---|
| 1 | **System Identity** | Alta | 200 tk | `config.json` + sesion activa |
| 2 | **Project Constitution** | Alta | 600 tk | `decisions` activas |
| 3 | **Active Tasks** | Media | 400 tk | `tasks` no-done |
| 4 | **Recent Turns** | Baja | 800 tk | `turns` ultimos N |
| 5 | **Relevant Memory** | Media | 1500 tk | hybrid search FTS5 + vec |
| 6 | **Code Map** | Media | 600 tk | `entities` + `relations` |
| 7 | **Open Questions** | Media | 300 tk | sesiones cerradas con `open_questions` |

**Total default:** ~4400 tokens. Configurable por workspace.

---

## 3. Capa por capa

### Capa 1: System Identity

**Que es:** Metadata del proyecto, identidad del agente activo.

**Contenido tipico:**
```
- Workspace: Coder (Rust + Tauri + Svelte)
- Sesion: implementar feature X de fase 1 (iniciada hace 3 turnos)
- Modo memoria: shared (commiteado a git)
- Idioma codigo: ingles. Idioma comentarios/UI: espanol.
```

**Origen:**
- `.mcp-memoria/config.json` (display_name, mode, metadata)
- Sesion activa de `sessions` (intent, started_at)
- Constants del cliente (idioma, ...)

**Cuando se incluye:** siempre, primer lugar.

**Decay:** N/A.

---

### Capa 2: Project Constitution

**Que es:** Decisiones arquitectonicas no negociables. La "ley" del proyecto.

**Contenido tipico:**
```
- Stack: Tauri v2 + Rust + Svelte 5 (no Electron, no React)
- Sin servidores: todo local first
- Sistema de errores: NcError + codigo NC-XXX-NNN
- Hexagonal por modulo: domain/application/infrastructure
- Cero unwrap()/panic() en produccion
```

**Origen:** `decisions` con `superseded_by IS NULL`, ordenado por
`use_count DESC`.

**Recuperacion:** primero las marcadas `scope='project'`, luego `module`
si la query menciona un modulo.

**Decay:** muy lento. `confidence` baja 0.01 por mes sin uso. Solo se borra
cuando se marca `superseded_by`.

**Tope:** ~600 tk. Si excede, se priorizan las mas usadas.

---

### Capa 3: Active Tasks

**Que es:** Lo que esta abierto y por hacer.

**Contenido tipico:**
```
[in_progress] Implementar window_new_empty (alta)
[pending] Tests integracion para multi-ventana (media)
[blocked] Auto-rebuild on file change (depende de #45)
```

**Origen:** `tasks` filtrado por `status != 'done'`.

**Recuperacion:**
1. Tareas in_progress primero.
2. Tareas blocked con razon.
3. Tareas pending priorizadas.

**Decay:** N/A (estado explicito).

**Tope:** ~400 tk. Si excede, se priorizan high+in_progress.

---

### Capa 4: Recent Turns

**Que es:** Que paso en los ultimos N turnos significativos.

**Contenido tipico:**
```
- Turn 1: Refactorizado RecentWorkspaceItem para mostrar X solo en stale.
- Turn 2: Encontramos bug en cleanup de WindowSessions; fix con on_window_event.
- Turn 3: Tests para WindowSessions (9 nuevos).
```

**Origen:** `turns` ordenado por `recorded_at_ms DESC`, top 5-8.

**Decay:** rapido. `confidence` baja 0.05 por dia. A los 30 dias el turn
ya casi no aparece.

**Tope:** ~800 tk.

---

### Capa 5: Relevant Memory

**Que es:** Lo mas relacionado con la query actual del usuario, sin filtro
de tipo.

**Origen:** `mem.recall` con la query del usuario o un resumen del intent
del turno.

**Recuperacion:** hybrid search:
1. BM25 (FTS5) sobre el corpus de todas las tablas con FTS.
2. Cosine similarity sobre embeddings (si disponibles).
3. Re-ranking con (BM25 + cosine + recency + usage + priority).
4. Filtro de duplicados con otras capas (no repetir lo que ya esta en
   capa 2/4).

**Tope:** 1500 tk (la mas grande).

**Politica:** si la query es vaga ("hola, ayudame"), capa 5 puede devolver
poco o nada. Si es especifica ("implementa X usando Y"), llena.

**Si no hay query:** capa 5 se omite (no hay sobre que rankear).

---

### Capa 6: Code Map

**Que es:** Entidades del codigo relevantes + sus relaciones.

**Contenido tipico:**
```
WindowSessions (struct in commands/workspace_commands.rs:67)
  uses → WindowHolder
  exposes → find_label_with_path, remove

OpenWorkspace (use_case)
  uses → RecentWorkspaceRepository, GitDetector
```

**Origen:** `mem.search_entities` con la query embedding + traversal de
relations hasta depth 2.

**Recuperacion:** entidades con cosine similarity > 0.6 a la query +
sus vecinos directos.

**Tope:** 600 tk.

**Si no hay query:** capa 6 se omite.

---

### Capa 7: Open Questions

**Que es:** Cosas que quedaron sin resolver en sesiones anteriores.

**Contenido tipico:**
```
- ¿Vitest setup va en fase 2 o lo postergamos?
- Path traversal en symlinks: aceptamos resolver el symlink o lo bloqueamos?
- Como manejar el caso de carpeta sin permisos de lectura?
```

**Origen:** `sessions` con `ended_at_ms IS NOT NULL`, leyendo
`metadata_json.open_questions`.

**Recuperacion:** ultimas 5 sesiones cerradas, todas las preguntas
abiertas.

**Decay:** preguntas se "olvidan" cuando alguna decision con tag
`answers:<question_id>` se registra. Mecanismo manual, no automatico.

**Tope:** 300 tk.

---

## 4. Ensamblaje del context bundle

```typescript
function buildContextBundle(
  query: string | undefined,
  workspace: Workspace,
  maxTokens: number = 4400,
  layerOverrides?: Partial<Record<LayerName, number>>
): ContextBundle {
  const layers = [
    layer1_systemIdentity(workspace),
    layer2_projectConstitution(workspace, layerOverrides?.project_constitution ?? 600),
    layer3_activeTasks(workspace, layerOverrides?.active_tasks ?? 400),
    layer4_recentTurns(workspace, 5, layerOverrides?.recent_turns ?? 800),
    query ? layer5_relevantMemory(query, workspace, layerOverrides?.relevant_memory ?? 1500) : empty(),
    query ? layer6_codeMap(query, workspace, layerOverrides?.code_map ?? 600) : empty(),
    layer7_openQuestions(workspace, layerOverrides?.open_questions ?? 300),
  ];

  // Deduplicacion cross-layer (mismo entry no aparece en 2 capas)
  const seenIds = new Set<string>();
  for (const layer of layers) {
    layer.entries = layer.entries.filter(e => {
      if (seenIds.has(e.id)) return false;
      seenIds.add(e.id);
      return true;
    });
  }

  // Token budget enforcement
  const totalTokens = layers.reduce((sum, l) => sum + l.tokens, 0);
  if (totalTokens > maxTokens) {
    truncateProportionally(layers, maxTokens);
  }

  return { layers, total_tokens: totalTokens };
}
```

---

## 5. Cuando cada capa es relevante

| Caso | Capas mas usadas |
|---|---|
| Inicio de sesion | 1, 2, 3, 7 |
| "Implementa la feature X" | 1, 2, 5, 6 |
| "Por que se eligio Y?" | 2, 4 (turn que tomo decision) |
| "Que estaba haciendo?" | 3, 4 |
| "Hay algun error similar?" | 5 |
| "Como se llama el archivo de Z?" | 6 |

---

## 6. Tools que retornan capas individuales

Para flexibilidad, el cliente puede llamar `mem.recall` con filtros para
obtener una capa especifica:

| Capa | Como obtenerla |
|---|---|
| 2: Constitution | `mem.recall({kinds: ["decision"], must_not_have_tags: ["superseded"]})` |
| 3: Active Tasks | `mem.task({action: "list", filter: {status: "any"}})` (excluye done) |
| 4: Recent Turns | `mem.recall({kinds: ["turn"], order_by: "recency", top_k: 5})` |
| 5: Relevant Memory | `mem.recall({query, top_k: 8})` |
| 6: Code Map | `mem.search_entities({query, max_depth: 2})` (v0.5+) |

Y la tool agregada `mem.context` devuelve las 7 capas ensambladas.

---

## 7. Adaptaciones por tamano de proyecto

| Proyecto | Total budget | Ajuste |
|---|---|---|
| Pequeno (< 1 mes, 1 modulo) | 2000 tk | Capas 5/6 reducidas |
| Mediano (default) | 4400 tk | Sin ajuste |
| Grande (> 50 modulos) | 7500 tk | Capa 6 ampliada (1500 tk), capa 5 ampliada (2500 tk) |
| Mega (monorepo) | 12000 tk | Considerar particionar por sub-proyecto con multiples `.mcp-memoria/` |

Configurable en `.mcp-memoria/config.json`:

```json
{
  "context": {
    "max_tokens": 7500,
    "layer_budgets": {
      "code_map": 1500,
      "relevant_memory": 2500
    }
  }
}
```

---

## 8. Que NO esta en las capas

- **Codigo fuente real.** No es responsabilidad del MCP. El cliente lee
  archivos directo.
- **Output de comandos** (cargo test, npm run, etc.). El cliente los
  ejecuta y muestra; el MCP no los almacena.
- **Conversacion completa.** Solo turnos significativos resumidos.
- **Diff de Git.** El cliente ya tiene acceso via `git diff`.
- **Capa global cross-proyecto.** Eliminada en MVP. Para preferencias del
  usuario, `~/.claude/CLAUDE.md`.

---

## 9. Como decide Claude que capas pedir

Dos estrategias:

**Estrategia A — Bundle completo al inicio del turno.**

```
mem.context({query: "<lo que pidio el usuario>"})
```

Una sola llamada, recibe ~4-5K tk estructurados, los inyecta en su
contexto. Es la recomendada al inicio de sesion o cuando cambia el contexto
drasticamente.

**Estrategia B — Tools incrementales.**

Solo llama capas especificas cuando las necesita. Ej:
- Si menciona una decision: `mem.recall({kinds: ["decision"], query})`.
- Si menciona un archivo: `mem.search_entities({query})`.
- Si pregunta por estado: `mem.task({action: "list"})`.

Recomendacion: **A** al primer turno de la sesion. **B** para los siguientes
turnos del mismo bloque (mas economico).

El system prompt del cliente debe incluir esta heuristica (ver
`02-protocolo-mcp.md` §8).

---

## 10. Token counter

El MCP cuenta tokens via:

- **`tiktoken` (preferido):** modelo `cl100k_base` (GPT-4 / Claude
  approximation). ~50 KB de deps.
- **Heuristica fallback:** `tokens ≈ chars / 4` (subestima ingles, sobrestima
  CJK).

`max_tokens` se respeta garantizadamente: el ultimo entry truncado se acorta
por palabras (no a la mitad de una palabra). Si truncar implica entry < 50%
del original, se omite entero.

---

## 11. Ejemplo concreto de bundle

Query: "implementa el editor con CodeMirror para fase 2 de Coder".

```markdown
## CAPA 1 — System Identity (180 tk)
Workspace: Coder (Rust + Tauri + Svelte)
Sesion: implementar editor CodeMirror, fase 2 (iniciada hace 5 min)
Modo memoria: shared
Idioma: espanol UI/docs, ingles codigo

## CAPA 2 — Project Constitution (520 tk)
- Stack: Tauri v2 + Rust + Svelte 5 (decision NC-D-001)
- Editor: CodeMirror 6 (decision NC-D-018, rationale: vs Monaco mas liviano)
- Modulo `editor/` con domain/application/infrastructure (decision NC-D-002)
- Cero unwrap() en produccion (decision NC-D-003)
- Errores via NcError + codigo NC-XXX-NNN (decision NC-D-004)

## CAPA 3 — Active Tasks (340 tk)
[in_progress] Fase 1: dedupe de workspaces por path
[pending] Setup vitest para frontend (Fase 2 prereq)
[pending] Editor: integracion CodeMirror 6 + tabs
[pending] Editor: validacion de zones antes de escribir

## CAPA 4 — Recent Turns (760 tk)
- Turn 7: cerrado fase 1, recoverage 83.2%, push fef1584
- Turn 8: bug cleanup WindowSessions arreglado con on_window_event
- Turn 9: feature remove-from-recents + auto-cleanup
- Turn 10: copy "Maximo 10" cambiado a "Ultimos 10"
- Turn 11: usuario decidio NO fork VSCode, seguir con Tauri

## CAPA 5 — Relevant Memory (1420 tk)
- Decision (NC-D-018): CodeMirror 6 elegido por liviandad y mejor performance Tauri
- Learning: usar `@codemirror/lang-rust` para syntax Rust
- Decision (NC-D-019): tabs como atom Svelte separado para reuso
- Learning: en tauri webview, los plugins de CM pueden tener problemas con
  CSP, hay que ajustar tauri.conf.json
- Entity: Editor (modulo planificado, ver arquitectura.md §16)

## CAPA 6 — Code Map (430 tk)
- AppLayout (template) ← AppLayout.svelte
- HomePage (page) ← pages/HomePage.svelte
- workspace.svelte.ts (store)
- WorkspaceAppState (struct, src-tauri/src/commands/workspace_commands.rs:30)

## CAPA 7 — Open Questions (180 tk)
- Vitest setup: ¿en fase 2 o postergar?
- ¿Soportar split editor (vertical/horizontal) en MVP de fase 2?
```

**Total: ~3830 tk.** Cabe holgado en context window de Claude.
