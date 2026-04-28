# 09 — Roadmap

> Plan de implementacion por fases. Cada fase entrega valor usable, no solo
> infraestructura.

---

## Vision

| Fase | Tiempo | Entregable | Estado |
|---|---|---|---|
| **MVP** | 1 semana | Server con 6 tools clave + 3 modos + hybrid search | ⬜ |
| **v0.5** | 4 semanas | Curador completo + 7 capas + tools v0.5 + audit |  ⬜ |
| **v1.0** | 12 semanas | Producto pulido + multi-cliente + Resources MCP | ⬜ |
| **v2.0** | 6 meses | Multi-key + UI auditoria + plugins | ⬜ |

---

## MVP — Semana 1 (5 dias laborales)

**Objetivo:** que un dev pueda instalar el MCP, conectarlo a Claude Code, y
ya beneficiarse de memoria persistente con compartir/cifrar/privado.

### Dia 1 — Scaffold + storage base

- Inicializar repo TypeScript con tsup, vitest, zod, pino.
- Setup MCP server stdio basico que responde a `initialize` y `tools/list`.
- Setup `better-sqlite3-multiple-ciphers` con WAL.
- Schema minimo:
  - `sessions`, `decisions`, `learnings`, `tasks`, `turns`, `entities`,
    `relations`, `audit_log`.
  - FTS5 virtuales para `decisions`, `learnings`, `turns`, `entities`.
  - `embedding_queue`.
- Setup `sqlite-vec`.
- Migracion 001 (initial schema).
- CI con tests + build.

**Salida:** `recall server` arranca, Claude Code lo lista en `/mcp`
con 0 tools.

### Dia 2 — Modos + workspace + tools de escritura

- `mem.init` con eleccion de modo (`shared` / `encrypted` / `private`).
- Auto-deteccion de workspace desde `cwd` con marcadores.
- Generacion de `workspace_id` UUID v7 estable.
- Para modo `encrypted`:
  - Generar clave aleatoria.
  - KDF argon2id via `@noble/hashes`.
  - SQLCipher PRAGMAs.
  - `key_validator_blob` en config.
  - Escribir clave en `~/.config/recall/keys/<id>.key` (0600).
  - Imprimir clave por stdout del CLI.
- Modo `private`: agregar `.recall/` al `.gitignore` raiz.
- `mem.remember` (decision, learning, entity, turn).
- `mem.task` (CRUD).
- Capa 1 de deteccion de secrets (regex + entropy).
- Path sanitizer.
- Encolado en `embedding_queue`.

**Salida:** Claude puede inicializar con modo, registrar entries. Los 3
modos funcionan.

### Dia 3 — Tools de lectura + hybrid search

- Worker async de embeddings (`fastembed` con `BGESmallEN15`).
- Cache de modelo en `~/.cache/recall/models/`.
- BM25 search via FTS5.
- Cosine search via sqlite-vec.
- Hybrid re-ranking (cosine + BM25 + recency + usage).
- `mem.recall` con filtros por kind, scope, tags, fecha.
- `mem.health` (estado, encryption_status, queue, etc.).
- Token counter con `tiktoken` + heuristica fallback.

**Salida:** `mem.recall` funciona con hybrid search. Memoria semantica +
lexical usable.

### Dia 4 — Context bundle + sesiones implicitas + unlock

- `mem.context` con las 7 capas.
- Sesiones implicitas: rollup automatico cada 30 min idle.
- Generacion de summary de sesion basado en turns recientes.
- CLI `recall unlock --workspace <path>`.
- CLI `recall forget-key`.
- CLI `recall mode <new>` (cambio de modo).
- Errores `-32107` (ENCRYPTED_LOCKED), `-32108` (INVALID_KEY).
- Migraciones lazy: al primer tool call, valida `schema_version`.

**Salida:** flujo end-to-end completo: init, unlock en otra maquina,
context bundle, recall, remember, sesiones automaticas.

### Dia 5 — Distribucion + smoke tests + docs

- `package.json` con `bin` configurado para server y CLI.
- README con quickstart de los 3 modos.
- `npm publish` a registry (privado o publico).
- Test de instalacion en maquina limpia (Mac, Linux, Windows).
- Documentar 5 casos de uso minimos en README:
  - Init shared, init encrypted, onboarding via unlock, recall, remember.
- Smoke tests E2E: simular Claude Code con cliente MCP test.

**Salida:** El usuario puede instalarlo y usarlo. MVP cerrado.

### Criterio de exito MVP

- [ ] Instalable via `npx -y recall@latest server`.
- [ ] 6 tools funcionales: `init`, `context`, `recall`, `remember`, `task`,
      `health`.
- [ ] Los 3 modos funcionan: shared, encrypted, private.
- [ ] CLI con `unlock`, `forget-key`, `mode`.
- [ ] Hybrid search (BM25 + cosine) devuelve top-8 en < 200ms con 1K entries.
- [ ] Modo encrypted con SQLCipher + argon2id KDF.
- [ ] Persiste en `<proyecto>/.recall/`.
- [ ] Documentado: README + protocolo + setup + seguridad.

### Limitaciones aceptadas en MVP

- Sin curador completo (solo embedding queue worker; sin decay, sin
  consolidacion).
- Sin auditoria en CLI (`recall audit`).
- Sin pre-commit hook.
- Sin import desde HANDOFF.md.
- Sin `mem.search_entities`, `mem.export_handoff`, `mem.forget`,
  `mem.curator_run`, `mem.session_force`, `mem.audit`.
- Sin re-ranking con priority weight.
- Sin multi-key (`add-key`, `rekey`).

---

## v0.5 — Semanas 2-4 (3 semanas)

**Objetivo:** memoria viable a largo plazo. Curador funcional + auditoria
+ tools v0.5.

### Semana 2 — Curador completo

- `mem.curator_run` con todas las pasadas:
  - Decay diferencial por kind.
  - Consolidacion semantica (cosine > 0.92, fusion).
  - Pruning a tabla `pruned`.
  - Validacion de paths stale.
  - Re-embedding cuando cambia el modelo.
- Ejecucion automatica cada 100 turnos.
- Snapshots pre-curator.
- CLI `curator-run`, `curator-log`.
- Tabla `curator_runs` para historial.
- Tests con dataset sintetico.

### Semana 3 — Tools v0.5

- `mem.search_entities` (grafo + traversal).
- `mem.export_handoff` (markdown formateado).
- `mem.forget` (con confirmacion en dos pasos).
- `mem.session_force` (start/end manual).
- `mem.audit` (secrets, paths_stale, decision_conflicts, embedding_drift,
  schema_integrity).

### Semana 4 — CLI completa + import + hooks

- CLI `recall audit --check-secrets [--strict]`.
- CLI `recall sanitize --entry-id <id>`.
- CLI `recall import-handoff` (parseo heuristico).
- CLI `recall install-hook` (pre-commit hook git).
- CLI `recall stats`, `health`, `wipe`, `export`, `import`.
- Mejor logging y observabilidad.

### Criterio de exito v0.5

- [ ] Curador corre semanalmente sin degradar performance.
- [ ] Bundle context devuelve 7 capas en < 300ms.
- [ ] Imports desde HANDOFF.md trabajan en proyectos reales.
- [ ] Pre-commit hook bloquea commits con secrets.
- [ ] Audit detecta hallazgos en proyectos reales.
- [ ] Documentacion pulida + tutorial de migracion.

---

## v1.0 — Semanas 5-12 (8 semanas)

**Objetivo:** producto que un equipo de 3-5 devs pueda adoptar.

### Semana 5-6 — Multi-key y rekey

- `recall add-key --workspace .` (multi-key via key envelopes).
- `recall rekey --workspace .` (rotacion de clave maestra).
- `key_envelopes[]` en config.
- Tests con escenarios de equipo (alguien sale, rotacion, etc.).

### Semana 7-8 — Resources MCP

- Implementar el lado Resources del protocolo MCP.
- URIs `memory://workspace/<id>/summary`, etc.
- Integracion con clientes que soporten Resources nativamente.
- Recovery codes BIP39 (mnemonic phrase opcional para clave de cifrado).

### Semana 9-10 — Multi-cliente y robustez

- Tests con Cursor, Cline, Claude Desktop, Claude Code.
- Mejor manejo de concurrencia (multiples instancias simultaneas).
- Detector de conflictos en decisions.
- Self-healing en path traversal y entidades stale.
- Stress testing con 100K entries.

### Semana 11 — Mejoras de retrieval

- Hybrid search refinado: tuning de pesos por workspace.
- Query expansion: usar terminos relacionados de la memoria.
- Filtros avanzados (multi-tag, fechas, scopes complejos).
- Reranker opcional (Cohere Rerank API, opt-in).

### Semana 12 — Pulido + release

- Auditoria de seguridad externa (path traversal, secrets, permisos,
  cifrado).
- Performance benchmarking en proyectos reales.
- Documentacion completa (esta + tutoriales + video).
- Logo, web sencilla con docs.
- Release v1.0.

### Criterio de exito v1.0

- [ ] Adoptado por al menos 1 equipo (3+ devs) en proyecto real durante
      1 mes.
- [ ] Quality gate: 0 corrupciones, 0 secret leaks, > 99% uptime
      (de la perspectiva del cliente).
- [ ] Performance: recall < 100ms p95, curador < 5s p95.
- [ ] Documentacion: tutorial, API reference, troubleshooting.
- [ ] Compatible con Claude Code, Claude Desktop, Cursor.
- [ ] Cifrado auditado externamente.

---

## v2.0 — 6 meses

**Objetivo:** features avanzadas para usuarios power.

### Areas

#### UI de auditoria

- Web app local en `localhost:<puerto>` que muestra:
  - Lista de todas las entries del workspace.
  - Editor para refinar manualmente.
  - Visualizacion del grafo de entidades.
  - Logs del curador y recall en tiempo real.

#### Plugin system

- Hooks: `before_record`, `after_recall`, `before_curator_run`.
- Plugins de terceros para detectar patrones especificos
  (ej: detectar cuando una decision tiene un security issue).

#### Embedders avanzados

- Cohere reranker como segunda etapa.
- Modelos especificos por dominio (codigo vs prosa).
- Embeddings hibridos (sparse + dense).

#### Privacy++

- Encriptacion de campo individual (no DB completa) — opt-in granular.
- Modos "ephemeral" para sesiones que NO persisten.
- Hardware key support (YubiKey para unlock).

#### Sync multi-maquina (modo `private`)

- Backend opcional (Postgres en VPS del usuario) para sync de modo `private`.
- O sync via Git repo cifrado dedicado solo para memoria.
- Resolucion de conflictos cuando dos maquinas escriben.

---

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|---|---|---|---|
| sqlite-vec abandonado | Baja | Alto | Capa de abstraccion en `storage/vector.ts` para swap a LanceDB |
| Modelo embedding obsolete | Media | Medio | Re-embedding job en curador |
| Volumen > 1M entries | Baja (1+ ano) | Medio | LanceDB como upgrade path |
| Cliente cambia API MCP | Baja | Alto | SDK oficial cubre breaking changes |
| Memoria corrompe codigo (sugerir mal) | Media | Alto | Confidence scores, re-ranking, log de reasoning |
| Privacy leak (secret en disco) | Media | Critico | 5 capas de deteccion + audit + sanitize |
| `better-sqlite3-multiple-ciphers` con bugs | Media | Alto | Tests E2E criticos, fallback a SQLCipher CLI tool si fails |
| Usuario pierde clave | Media (modo encrypted) | Critico | Documentar fuerte + recovery codes + multi-key |

---

## Decisiones explicitamente postergadas

Cosas que se discuten ahora pero NO van en v1.0:

- **MCP server compartido en cloud.** Out of scope; memoria-en-proyecto es
  la postura.
- **GUI standalone.** Postergado a v2.0 si hay demanda real.
- **Multi-tenant en una instancia.** Innecesario; cada usuario corre la suya.
- **Fine-tuning de embedder con datos del usuario.** Demasiado caro.
- **Integracion con Slack / Notion / Linear.** Posible plugin v2+.
- **Voice / multimodal memory.** Out of scope.
- **Capa 8 — Global learnings.** Out of scope MVP. Para reglas globales
  del usuario, `~/.claude/CLAUDE.md`.

---

## Metricas a trackear desde MVP

Para evaluar exito honestamente, instrumentar desde dia 1:

| Metrica | Como medir | Target |
|---|---|---|
| Adopcion | sesiones que llaman al MCP / sesiones totales | > 80% |
| Recall hit rate | turns que usan resultado de recall en su respuesta | > 60% |
| Latencia recall p95 | percentil 95 de duration de tool call | < 200ms |
| Decay efectividad | % de entries con confidence > 0.5 a los 6 meses | 30-50% |
| User overrides | veces que usuario invoca `mem.forget` o sanitize | < 5% de entries |
| Errores | tool calls con error_code != null / total | < 1% |
| Modo encrypted adoption | % de workspaces nuevos en modo encrypted | > 30% |
| Secret detection | hallazgos por audit / total entries | < 0.1% (proyecto sano) |

---

## Compromiso de version

| Version | Stability | Breaking changes |
|---|---|---|
| 0.x | Inestable | Permitidos con notice |
| 1.x | Estable | Solo en major bump |
| 2.x+ | Estable | Solo en major bump |

Schema migrations son automaticas e idempotentes en todas las versiones.
Cifrado garantiza compatibilidad forward (DB cifrada en v1.0 abrira en v2.0
sin re-encrypt).

---

## Equipo necesario

Para cumplir el roadmap:

- **MVP (1 sem):** 1 dev FT.
- **v0.5 (4 sem total):** 1 dev FT.
- **v1.0 (12 sem total):** 1 dev FT + 1 reviewer ad-hoc + 1 audit security
  externa.
- **v2.0:** 2 devs FT por 3-4 meses adicionales.

Si solo hay tiempo parcial (~10h/sem), multiplicar tiempos x4.
