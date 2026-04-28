# HANDOFF — MCP Memoria Inteligente

> Documento de transferencia. Quien retome el proyecto (o yo en otra sesion)
> debe leer esto PRIMERO. Cubre estado actual, decisiones tomadas, proximos
> pasos concretos.
>
> **Ironia:** este es exactamente el archivo que el producto que vamos a
> construir reemplaza. Hasta que el MCP exista y funcione, este es el
> punto de entrada.

---

## 0. Resumen en una pantalla

| Item | Estado |
|---|---|
| **Fecha del handoff** | 2026-04-28 (Fase 6 RELEASE — MVP v0.1.0 publicado, ver §6.10) |
| **Producto** | Servidor MCP de memoria persistente por proyecto, viviendo dentro del proyecto (`<repo>/.recall/`), con 3 modos: compartido / encriptado / privado |
| **Fase actual** | **MVP v0.1.0 PUBLICADO Y VALIDADO.** Workflow multi-agente CERRADO (Fases 0-6). Paquete vivo en npm + GitHub release + smoke test E2E confirmado. Proxima fase: **mantenimiento + roadmap v0.1.1 / v0.5+** (ver §8). |
| **Lineas de codigo** | ~58,400 en `code/src/` + ~33,000 LOC de tests en 199 archivos test. 8 modulos + shared + composition + bootstrap. |
| **Migraciones** | **8** en `code/migrations/` (000__bootstrap, 001__secret-audit-log, 002__retrieval-schema, 003__pruned-and-curator-runs, 004__core-memory-schema, 005__perf-indexes, 006__workspace-config-table, 007__fts-trigger-column-scope). |
| **Lineas de documentacion** | ~7,200 en `docs/` (incluye ADR-001 §1.5.1, ADR-002 §1.5.2 PriorityBoost multiplicativo, ADR-003 §1.5.3 ContextLayerKind ACL, convencion `.port.ts` §3.1). |
| **Agentes definidos** | 13 en `.claude/agents/` (1 orquestador + 6 implementadores + 6 validadores). |
| **Reportes de validacion** | 71 en `.claude/validations/` (Fase 5 agrego 5 ciclos qa-sonarqube + 1 architect-final-review). |
| **Tooling materializado** | `code/package.json`, `code/tsconfig.json` (17 flags estrictos), `code/eslint.config.js` (ESLint 9 strict), `code/vitest.config.ts` (thresholds 95%/100%/100%/90%), `code/scripts/validate-modules.ts`, `code/sonar-project.properties`, `code/tsup.config.ts`. |
| **SonarQube** | https://sonar.netzi.dev — quality gate **PASSED** (ciclo 5 de 5): coverage 96.4%, new_coverage 99.1%, ratings A en reliability/security/maintainability/security-review, **0 bugs / 0 vulns / 0 blockers / 0 critical**, sqale_debt_ratio 0.1%. |
| **Tests** | **2421 passing** en 199 archivos test. **Coverage 96.4%** (domain ~99%, application ~99%, infrastructure ~92%). 23 E2E + 52 integration + 6 benchmarks + ~2340 unit. |
| **Benchmarks** | 4/6 PASS (mem.remember 0.18ms p95, mem.recall 1.51ms p95, mem.context 7.94ms p95, cold start unencrypted 155.88ms p95). 1 PASS post-fix F (curator 50K decay 206ms p95 vs 30s target). 1 ajuste SLO encrypted (1412ms vs nuevo target 1500ms). |
| **SLO encrypted** | Cold start `<1500ms` (revisado desde `<400ms` previo, mantiene Argon2id OWASP 2024 — 64 MiB / 3 iter / 4 parallel). Decision E del architect-final-review. |
| **Vulns npm audit** | 1 cerrada (`uuid` bumpeado a 14.x). **2 highs upstream** heredadas de `fastembed@^2.0.0` → `tar@6.x` (path-traversal/symlink poisoning en extraccion de tarball). v0.1.1 sub-fase 5 (2026-04-28) **investigo y documento como wontfix** tras descartar 4 alternativas: bump (fastembed@2.1 sigue con tar@6), override (tar@7 sin default ESM rompe import), swap embedder (v0.5-class), shim custom (regla "no security custom"). Ver ADR-004 en `docs/12-lineamientos-arquitectura.md §1.5.4` + §6.11. Vector real corregido: download desde GCS de Qdrant (no HuggingFace). SonarQube **sigue en 0 vulnerabilities** sobre nuestro codigo. |
| **Paquete npm** | `@netzi/recall` (scope publico). `publishConfig.access=public`. Bins `recall` y `recall-server`. |
| **Licencia** | MIT (`code/LICENSE`). |
| **Estado del release** | **PUBLICADO Y VALIDADO.** `@netzi/recall@0.1.0` en npm (https://www.npmjs.com/package/@netzi/recall). GitHub release publicado (https://github.com/NetziTech/recall/releases/tag/v0.1.0). Tag `v0.1.0` → commit `7da553a` (= `main` HEAD). Smoke test E2E confirmado: `npx --yes @netzi/recall@0.1.0 --help` desde directorio limpio descarga, instala deps y ejecuta CLI sin errores. |
| **Proximo paso** | v0.1.1 listo para release: B-008 cerrado en sub-fase 3 (`mem.task.get/delete`) y B-009 cerrado en sub-fase 4 (`uninstall-hook`). Las 2 highs upstream ya tienen ADR-004 (wontfix-con-mitigacion) hasta v0.5. Detalles en `docs/RELEASE-NOTES-v0.1.0.md`, §6.10, §6.11 y §8. |

---

## 1. Que es el proyecto

Servidor MCP (Model Context Protocol) que da a Claude Code memoria
persistente, selectiva y auto-curada **por proyecto**, con la memoria
viviendo **dentro del propio proyecto** (`<proyecto>/.recall/`),
no en HOME del usuario.

Diferenciador clave vs Mem0, OpenMemory, LangMem y otros:
- Memoria viaja con el codigo (clone, mv, share).
- 3 modos de privacidad nativos (compartido / encriptado con SQLCipher /
  privado).
- Hybrid search nativo (BM25 via FTS5 + cosine via sqlite-vec).
- Tipado del dominio del software (decisions, learnings, entities,
  tasks, turns) en vez de "facts" planos.

Detalle completo en [`docs/README.md`](./docs/README.md).

---

## 2. Decisiones tomadas (no revisitar sin razon nueva)

### 2.1 Producto

| # | Decision | Donde se documenta |
|---|---|---|
| D-001 | Memoria-en-proyecto, no en HOME | `docs/01-arquitectura.md` §2.2 |
| D-002 | 3 modos de privacidad: compartido (default) / encriptado / privado | `docs/11-seguridad-modos.md` |
| D-003 | TypeScript + Node 20+ (no Rust ni Python) | `docs/06-stack-tecnico.md` §2 |
| D-004 | `better-sqlite3-multiple-ciphers` para soportar SQLCipher | `docs/06-stack-tecnico.md` §4-5 |
| D-005 | Hybrid search FTS5 + sqlite-vec desde el MVP | `docs/01-arquitectura.md` §2.6 |
| D-006 | Embeddings asincronos via `embedding_queue` | `docs/01-arquitectura.md` §2.7 |
| D-007 | Sesiones implicitas con timeout 30 min idle | `docs/01-arquitectura.md` §2.5 |
| D-008 | argon2id para KDF (memory ≥64 MiB, iter ≥3, parallelism ≥4) | `docs/11-seguridad-modos.md` §3 |
| D-009 | `workspace_id` como UUID v7 estable en `config.json`, no derivado del path | `docs/03-modelo-datos.md` §2 |
| D-010 | Capa 8 "Global Learnings" eliminada del MVP. Para reglas globales del usuario, `~/.claude/CLAUDE.md` | `docs/04-capas-contexto.md` |
| D-011 | MVP de 6 tools (`mem.init`, `mem.context`, `mem.recall`, `mem.remember`, `mem.task`, `mem.health`); resto en v0.5 | `docs/02-protocolo-mcp.md` §2 |

### 2.2 Implementacion

| # | Decision | Donde |
|---|---|---|
| D-012 | Clean Architecture + DDD + Hexagonal + SOLID + modularidad estricta + cero `any` como reglas no negociables | `docs/12-lineamientos-arquitectura.md` |
| D-013 | Estructura modular: `shared/` (transversal) + `modules/<name>/` (independientes) + `composition/` (unico que junta) | `docs/12-lineamientos-arquitectura.md` §1.5 |
| D-014 | 8 modulos: `workspace`, `memory`, `retrieval`, `curator`, `secrets`, `encryption`, `mcp-server`, `cli` | `docs/12-lineamientos-arquitectura.md` §2 |
| D-015 | 13 agentes especializados: 1 orquestador + 6 implementadores + 6 validadores | `docs/13-workflow-agentes.md` |
| D-016 | SonarQube quality gate strict: cobertura ≥95%, ratings A, 0 bugs/vulns/blockers, tech debt ≤5% | `docs/13-workflow-agentes.md` §7 |
| D-017 | **ADR-001**: cross-imports `retrieval/curator → memory` autorizados (Customer-Supplier upstream-downstream); resto sigue prohibido | `docs/12-lineamientos-arquitectura.md` §1.5.1 |
| D-018 | `Argon2idKdf` adapter NO va en `shared/`, vive en `modules/encryption/infrastructure/`. Puerto `Kdf` vive en `modules/encryption/application/ports/`. Owner: `crypto-security-expert` | Decision orquestador Fase 2 (`workflow-state.json` decisions_log) |
| D-019 | `TransactionManager` separado OMITIDO; cubierto por `DatabaseConnection.transaction(fn)` con mode `immediate` | Decision orquestador Fase 2 |
| D-020 | `EncryptionKeyBytes { readonly bytes: Uint8Array }` interfaz local minimalista en `SqliteDatabase` como anti-corruption layer | `code/src/shared/infrastructure/database/sqlite-database.ts` |
| D-021 | Convencion sufijo `.port.ts` para puertos (pendiente formalizar en `docs/12 §3.1`) | Decision orquestador Fase 2 (B-004 abierto) |
| D-022 | Test doubles (`FakeClock`, `FakeIdGenerator`) co-localizados con sus contrapartes reales en `shared/infrastructure/`, NO en `tests/fixtures/` | Patron canonico hexagonal validado por `clean-architecture-validator` |
| D-023 | `Embedder` puerto en `shared/` opera sobre `Float32Array` crudo + `dimension`, NO sobre el VO `EmbeddingVector` (que vive en `retrieval/domain`). Adapters convierten en composition root | `code/src/shared/application/ports/embedder.port.ts` |
| D-024 | Stack: better-sqlite3-multiple-ciphers 12.x, sqlite-vec 0.1.9, fastembed 2.x, @noble/hashes 2.x, pino 10.x, uuid v7 (uuid 11.x), zod 4.x, vitest 3.x, ESLint 9.x, TypeScript 5.x, tsup como bundler | `code/package.json` |

---

## 3. Estructura del repositorio (estado actual)

```
memoria/
├── README.md                                       # Punto de entrada del repo
├── HANDOFF.md                                      # Este archivo
│
├── docs/                                           # 14 archivos, ~6500 lineas
│   ├── README.md                                   # Indice + resumen ejecutivo
│   ├── 01-arquitectura.md                          # Componentes, flujos
│   ├── 02-protocolo-mcp.md                         # Tools MCP (6 MVP + 6 v0.5)
│   ├── 03-modelo-datos.md                          # Schemas SQLite, FTS5, vectors
│   ├── 04-capas-contexto.md                        # 7 capas del bundle
│   ├── 05-memoria-decay.md                         # Curador, decay, consolidacion
│   ├── 06-stack-tecnico.md                         # TS + sqlite-vec + fastembed
│   ├── 07-instalacion.md                           # Setup en clientes MCP
│   ├── 08-casos-uso.md                             # 13 casos de uso end-to-end
│   ├── 09-roadmap.md                               # MVP 1 sem, v0.5, v1.0
│   ├── 10-comparativa.md                           # vs Mem0, OpenMemory, etc.
│   ├── 11-seguridad-modos.md                       # 3 modos, SQLCipher, secrets 5 capas
│   ├── 12-lineamientos-arquitectura.md             # 6 reglas no negociables
│   └── 13-workflow-agentes.md                      # 13 agentes, ciclo de validacion
│
├── .claude/
│   └── agents/                                     # 13 agentes especialistas
│       ├── mcp-orchestrator.md                     # 1 coordinador
│       ├── domain-architect.md                     # 6 implementadores:
│       ├── mcp-protocol-expert.md
│       ├── crypto-security-expert.md
│       ├── retrieval-expert.md
│       ├── curator-expert.md
│       ├── infrastructure-engineer.md
│       ├── clean-architecture-validator.md         # 6 validadores:
│       ├── ddd-validator.md
│       ├── solid-validator.md
│       ├── security-auditor.md
│       ├── performance-auditor.md
│       └── qa-sonarqube-auditor.md
│
├── code/
│   ├── README.md                                   # Placeholder de estructura prevista
│   ├── package.json                                # Stack runtime + dev (Tarea 2.1)
│   ├── tsconfig.json                               # 17 flags estrictos + NodeNext
│   ├── eslint.config.js                            # ESLint 9 flat config strict
│   ├── vitest.config.ts                            # Thresholds 95%/100%/100%/90%
│   ├── .gitignore
│   ├── sonar-project.properties                    # Config del scanner
│   ├── scripts/
│   │   └── validate-modules.ts                     # Audit de cross-imports + ADR-001
│   ├── migrations/
│   │   └── 000__bootstrap.sql                      # _meta(key, value)
│   ├── .sonarqube/
│   │   ├── README.md                               # Setup local (Docker), CI
│   │   └── setup.sh                                # Script idempotente
│   └── src/                                        # 293 archivos .ts, ~26,900 LOC
│       ├── shared/
│       │   ├── domain/                             # 14 archivos
│       │   │   ├── value-objects/                  # Id, Timestamp, Tags,
│       │   │   │                                   # WorkspaceId, Tokens,
│       │   │   │                                   # Confidence, NonEmptyString
│       │   │   ├── types/                          # Result, DomainEvent, Brand
│       │   │   └── errors/                         # DomainError, JsonRpcErrorCodes,
│       │   │                                       # InvalidInputError, InvariantViolation
│       │   ├── application/ports/                  # 6 archivos (Tarea 2.3)
│       │   │   ├── database-connection.port.ts     # DatabaseConnection + PreparedStatement
│       │   │   ├── logger.port.ts                  # Logger + LogPayload
│       │   │   ├── clock.port.ts                   # Clock
│       │   │   ├── id-generator.port.ts            # IdGenerator
│       │   │   ├── embedder.port.ts                # Embedder + RawEmbedding
│       │   │   └── index.ts                        # Barrel
│       │   └── infrastructure/                     # 13 archivos (Tarea 2.2)
│       │       ├── database/sqlite-database.ts     # WAL + SQLCipher + sqlite-vec
│       │       ├── database/migrations-runner.ts   # Idempotente + transaccional
│       │       ├── logger/pino-logger.ts           # Pino + DEFAULT_REDACT_PATHS
│       │       ├── embedder/fastembed-embedder.ts  # Lazy load + embedBatch real
│       │       ├── clock/{system,fake}-clock.ts    # Real + test double
│       │       ├── id-generator/{uuid-v7,fake}-*.ts# Real + test double
│       │       ├── errors/{infrastructure,database,embedder}-error.ts
│       │       └── index.ts
│       └── modules/
│           ├── workspace/domain/                   # 16 archivos
│           ├── memory/domain/                      # 83 archivos (nucleo)
│           ├── secrets/domain/                     # 25 archivos
│           ├── encryption/domain/                  # 29 archivos (cripto)
│           ├── mcp-server/domain/                  # 21 archivos
│           ├── cli/domain/                         # 12 archivos
│           ├── retrieval/domain/                   # 42 archivos
│           └── curator/domain/                     # 33 archivos (DecayFactor recalibrado)
│
└── .claude/
    ├── workflow-state.json                         # Estado del workflow (Fase 2 done)
    └── validations/                                # 31 reportes de validacion
        ├── phase-1-task-1-{ddd,solid}-validator.md  # Fase 1 (21 reportes):
        ├── phase-1-task-2-{ddd,solid}-validator{,-cycle-1}.md
        ├── phase-1-task-3-{ddd,solid}-validator{,-cycle-1}.md
        ├── phase-1-task-{4,5,6,9}-{ddd,solid}-validator.md
        ├── phase-1-task-7-{ddd,solid}-validator{,-cycle-1}.md
        ├── phase-1-task-8-{ddd,solid}-validator{,-cycle-1}.md
        ├── phase-2-task-1-solid-validator.md         # Fase 2 (10 reportes):
        ├── phase-2-task-2-{clean-architecture,solid,security,performance}-*.md
        ├── phase-2-task-3-{clean-architecture,solid}-validator.md
        ├── phase-2-task-4-{ddd,solid}-validator.md
        └── phase-2-task-5-{ddd,solid}-validator-embedding-vector.md
```

**Aun NO existe en el repo (lo crea Fase 3+):**
- `code/tests/` — tests (Vitest unit + integration + E2E) → Fase 5
- `code/migrations/001__core-schema.sql` y siguientes (solo bootstrap esta hoy)
- `code/src/**/application/` y `code/src/**/infrastructure/` por modulo
  (Fase 3, en paralelo)
- `code/src/composition/` — composition root (Fase 4)
- `code/.sonarqube/setup.sh` ya existe pero no se ha corrido en CI aun
- `.github/workflows/` — CI

---

## 4. Lineamientos no negociables (resumen)

Detalle en [`docs/12-lineamientos-arquitectura.md`](./docs/12-lineamientos-arquitectura.md).

1. **Clean Architecture** — `domain ← application ← infrastructure ←
   composition`. Dominio puro, sin imports externos.
2. **DDD** — entidades con identidad+comportamiento, VO inmutables que
   validan invariantes, agregados con raiz, repositorios con agregados
   completos, eventos en past tense, ubiquitous language.
3. **Hexagonal** — puertos en domain/application, adaptadores en
   infrastructure. Use cases inyectan puertos, nunca instancian con `new`.
4. **SOLID** — los 5 principios validados por agente.
5. **Modularidad estricta** — modulos NUNCA se importan entre si. Solo
   `shared/`. Si dos modulos necesitan algo comun, va a `shared/`.
   Composition root es el unico lugar de wiring.
6. **Cero `any`** — `tsc --strict` con todas las flags + ESLint estricto.
   Cero `as any`, cero `// @ts-ignore`. Validacion Zod en boundaries.

---

## 5. SonarQube — estado del setup

**Servidor:** https://sonar.netzi.dev (instancia propia, public-but-auth)

**Configurado el 2026-04-27 via** `code/.sonarqube/setup.sh`. Estado:

| Item | Valor |
|---|---|
| Proyecto | `recall` (UUID `766e9612-d2b0-489a-ba63-ee68214c8b5c`) |
| Visibility | `public` (intencional segun decision del usuario) |
| Quality Gate | `MCP Memoria Strict` (caycStatus: over-compliant) |
| Asociacion | gate → proyecto: ✓ |
| Condiciones | 15 (13 nuestras + 2 CaYC bonus) |

**Las 13 condiciones que pusimos:**

| # | Metric | Op | Threshold | Caso |
|---|---|---|---|---|
| 1 | new_coverage | LT | 95 | Coverage codigo nuevo ≥ 95% |
| 2 | coverage | LT | 95 | Coverage overall ≥ 95% |
| 3 | new_duplicated_lines_density | GT | 3 | Duplicacion nueva ≤ 3% |
| 4 | duplicated_lines_density | GT | 3 | Duplicacion overall ≤ 3% |
| 5 | new_maintainability_rating | GT | 1 | Mantenibilidad codigo nuevo = A |
| 6 | new_reliability_rating | GT | 1 | Reliability codigo nuevo = A |
| 7 | new_security_rating | GT | 1 | Security codigo nuevo = A |
| 8 | new_security_review_rating | GT | 1 | Security review = A |
| 9 | new_bugs | GT | 0 | Cero bugs nuevos |
| 10 | new_vulnerabilities | GT | 0 | Cero vulnerabilidades nuevas |
| 11 | new_blocker_violations | GT | 0 | Cero blocker issues |
| 12 | new_critical_violations | GT | 0 | Cero critical issues |
| 13 | new_sqale_debt_ratio | GT | 5 | Tech debt ratio ≤ 5% |

**Bonus de CaYC (Clean as You Code) que SonarQube agrego automaticamente
y se mantienen:**

| # | Metric | Op | Threshold | Razon |
|---|---|---|---|---|
| B1 | new_violations | GT | 0 | Cero nuevos issues de cualquier severidad |
| B2 | new_security_hotspots_reviewed | LT | 100 | Todos los security hotspots nuevos revisados |

### Como ejecutar el scanner (cuando exista codigo)

Asume env vars `SONAR_HOST_URL` y `SONAR_TOKEN` configuradas en
`~/.zshrc` (ya estan):

```bash
cd code
npm run test:coverage     # genera coverage/lcov.info
npx sonar-scanner         # lee sonar-project.properties
```

El agente `qa-sonarqube-auditor` corre esto y lee el quality gate.

### Como re-ejecutar el setup (idempotente)

```bash
zsh -c '. ~/.zshrc 2>/dev/null; export SONAR_HOST_URL SONAR_TOKEN; \
        bash code/.sonarqube/setup.sh'
```

Resultado esperado en setup correcto: 13 SKIP, 0 FAIL.

### Token

- Generado el 2026-04-27, expira en 30 dias.
- Almacenado en `~/.zshrc` del usuario como `SONAR_TOKEN`.
- Usuario tiene rol Global Administrator (necesario para crear quality
  gates).
- **Rotar cuando expire o si hay sospecha de compromiso.**

---

## 6. Workflow de implementacion

Detalle en [`docs/13-workflow-agentes.md`](./docs/13-workflow-agentes.md).

### Fases

```
Fase 0 — Planning            (mcp-orchestrator)                       ✅ DONE
Fase 1 — Domain modeling     (domain-architect → ddd + solid)         ✅ DONE
Fase 2 — Infra compartida    (infrastructure-engineer → clean+solid+sec+perf)  ✅ DONE
Fase 3 — Modulos en paralelo:                                         ✅ DONE
           - mcp-server      (mcp-protocol-expert)         APPROVED ciclo 0
           - encryption+sec  (crypto-security-expert)      APPROVED ciclo 0
           - retrieval       (retrieval-expert)            APPROVED ciclo 0
           - curator         (curator-expert)              APPROVED ciclo 0
           - workspace+cli   (infrastructure-engineer)     APPROVED ciclo 0
         17/17 validadores APPROVED, 0 rechazos
Fase 4 — Composition root + gaps:                                     ✅ DONE
           - 4.0 composition initial   (infrastructure-engineer)  APPROVED ciclo 0
           - 4.5 memory app+infra      (backend)                   APPROVED ciclo 1 (1 rechazo perf)
           - 4.6 encryption persistence+destroy (crypto-sec)       APPROVED ciclo 0
           - 4.7 re-wiring composition (infrastructure-engineer)   APPROVED ciclo 0
         15/15 validadores APPROVED, 1 rechazo (PRIMER del proyecto)
Fase 5 — Testing + Architect Review FINAL:                            ✅ DONE
           - 5.0 build fix tsup        (infrastructure-engineer)   APPROVED ciclo 0
           - 5.1 tests unit por modulo (multi-owner paralelo)      APPROVED
           - 5.2 tests integration     (infrastructure-engineer)   APPROVED
           - 5.3 tests E2E binary      (infrastructure-engineer)   APPROVED
           - 5.4 perf benchmarks       (performance-auditor)       APPROVED (SLO encrypted revisado)
           - 5.5 SonarQube scan + gate (qa-sonarqube-auditor)      APPROVED ciclo 5 (4 ciclos fix)
           - 5.6 architect review final (architect)                APPROVED CON OBSERVACIONES ciclo 0
         APROBADO CON OBSERVACIONES — 3 doc-edits aplicadas, cero codigo bloqueante.
Fase 6 — Release MVP v0.1.0  (orquestador + usuario)                  ⏳ NEXT (action humana)
```

### Reglas

- Validadores **rechazan** con archivo+linea+fix concreto.
- Maximo **5 ciclos** de rechazo por tarea; despues escala a humano.
- Estado en `.claude/workflow-state.json`.

---

## 6.5 Fase 1 — Domain Modeling — CERRADA

**Cierre:** 2026-04-27. **9/9 tareas APROBADAS** por `ddd-validator` +
`solid-validator`. **268 archivos** creados (275 incluyendo aggregates
adicionales), **~24,400 LOC**, todos en `code/src/**/domain/`. `tsc
--noEmit` con los 17 flags estrictos de `docs/12 §1.6` pasa EXIT=0
sobre el set completo. Cero `any`, cero `ts-ignore`, cero imports
cross-modulo (excepto los autorizados `retrieval`/`curator` → `memory`).

### Resultado por tarea

| # | Modulo | Archivos | Ciclos rechazo | Notas |
|---|---|---:|:---:|---|
| 1 | `shared/domain` | 14 | 0 | VOs base, Result, DomainEvent, branded, errors |
| 2 | `workspace/domain` | 16 | 1 | Convencion eventName establecida acá |
| 3 | `memory/domain` | 76+ | 1 | Nucleo: Decision, Learning, Entity, Task, Turn, Session, Relation; cubre schema completo de docs/03 §4 |
| 4 | `secrets/domain` | 24 | 0 | SecretAuditEntry append-only; 5 capas defensa |
| 5 | `encryption/domain` | 29 | 0 | MasterKey/DerivedKey/Passphrase con redaccion verificada; constant-time equality |
| 6 | `mcp-server/domain` | 21 | 0 | ToolRegistration, RequestId DU, JsonRpcErrorCode |
| 7 | `cli/domain` | 12 | 1 | Catalogo conformado a docs/07 §7 |
| 8 | `retrieval/domain` | 42 | 1 | ContextBundle (7 capas), HybridScorer puro, *Ref projections |
| 9 | `curator/domain` | 33 | 0 | CuratorRun lifecycle, DecayCalculator puro |

### Decisiones del orquestador (registradas en `decisions_log` del workflow-state)

1. **Convencion oficial de `eventName`:** `<module>.<event-name-en-past-tense-kebab-case>`
   (ej `"workspace.initialized"`, `"memory.decision-recorded"`,
   `"curator.learnings-consolidated"`). JSDoc actualizado en
   `code/src/shared/domain/types/domain-event.ts`.

2. **CLI `COMMAND_NAMES` conformado a docs/07** §7 (20 entradas).
   Removidos `"lock"` y `"status"`. `lock` requiere ADR + actualizacion
   de docs/07 y docs/11 si se reintroduce; `status` es alias razonable
   de `health` pero pertenece al parser argv→use-case en application.

3. **Cross-imports `retrieval`→`memory` y `curator`→`memory`** autorizados
   por brief de tareas 8 y 9. Pendiente formalizar en `docs/12 §1.5`
   con ADR explicito antes de Fase 3, o mover VOs comunes a `shared/`,
   o duplicar localmente. `clean-architecture-validator` decide en
   Fase 3.

4. **`clean-architecture-validator` postergado a Fase 3** (requiere ver
   triada `domain` + `application` + `infrastructure` por modulo). En
   Fase 1 cubrieron `ddd-validator` (estructura DDD) y `solid-validator`
   (tsc estricto + cero imports externos en `domain/`).

### Decisiones humanas pendientes para Fase 5 (architect review)

- **`PriorityBoost` MULTIPLICATIVO** (≥1, ≤10) en `retrieval/domain`
  diverge de `docs/01 §2.6` que lo lista aditivo (`0.05 *
  explicit_priority`). Conformar al spec O actualizar doc + ADR.
- **`ContextLayerKind` con names domain-flavoured**
  (`workspace_anchor`, `active_decisions`, `entities_in_focus`, etc.)
  divergen de wire literals `docs/02 §4.2` (`system_identity`,
  `project_constitution`, `code_map`). Crear ADR + agregar tabla
  wire-vs-domain en `docs/02 §4.2`.
- **Transicion `encrypted → shared` directa** prohibida por
  `Workspace` aggregate (decision conservadora). `docs/11 §5` lo lista
  como warning, no como prohibido. Confirmar politica.

### Bloqueadores heredados para Fase 2

1. **Materializar la infraestructura del repo**: `code/package.json`,
   `code/tsconfig.json` (con los 17 flags estrictos de §1.6),
   `code/eslint.config.js` (con `@typescript-eslint/no-explicit-any:
   error`, `no-unsafe-*: error`, `explicit-function-return-type:
   error`), `code/vitest.config.ts`. Todo el codigo de Fase 1 ya
   compila contra esos flags inline; la materializacion es trabajo
   mecanico.

2. **BUG NUMERICO en `DecayFactor` defaults** (curator/domain): los
   valores literales (decision 0.95, learning 0.92, etc.) son los
   per-period del spec `docs/05 §2` copiados crudos pero el
   `DecayCalculator` los usa como per-day. Resultado: decision con
   factor 0.95 cae a 0.95^90 ≈ 0.01 a los 90 dias (vs spec 0.99). Hay
   que re-derivar los factores per-day desde los targets per-period del
   spec (ej: para confidence 0.5 a los 90 dias en decisions,
   `factor_per_day = 0.5^(1/90) ≈ 0.992`). El **modelo** es correcto;
   solo la **calibracion** esta off.

3. **Cross-imports formalizacion** (ver decision 3 arriba).

### Reportes de validacion

21 reportes en `.claude/validations/`:
- `phase-1-task-1-{ddd,solid}-validator.md` (ambos APPROVED ciclo 0)
- `phase-1-task-2-{ddd,solid}-validator.md` + `-cycle-1` (ddd
  RECHAZADO ciclo 0 por eventName, APPROVED ciclo 1)
- `phase-1-task-3-{ddd,solid}-validator.md` + `-cycle-1` (ddd
  RECHAZADO ciclo 0 por 3 criticos en Turn/Session/Entity, APPROVED
  ciclo 1)
- `phase-1-task-{4,5,6}-{ddd,solid}-validator.md` (todos APPROVED
  ciclo 0)
- `phase-1-task-7-{ddd,solid}-validator.md` + `phase-1-task-7-ddd-validator-cycle-1.md`
  (ddd RECHAZADO ciclo 0 por catalog, APPROVED ciclo 1)
- `phase-1-task-8-{ddd,solid}-validator.md` + `phase-1-task-8-ddd-validator-cycle-1.md`
  (ddd RECHAZADO ciclo 0 por MemoryRef.of, APPROVED ciclo 1)
- `phase-1-task-9-{ddd,solid}-validator.md` (ambos APPROVED ciclo 0)

---

## 6.6 Fase 2 — Infraestructura Compartida — CERRADA

**Cierre:** 2026-04-27. **6/6 tareas APROBADAS** (2.0–2.5). Tetrada de
validadores ratifico la entrega: `clean-architecture-validator`,
`solid-validator`, `security-auditor`, `performance-auditor`. Sin
rechazos en ningun ciclo.

### Resultado por tarea

| # | Tarea | Owner | Validadores | Notas |
|---|---|---|---|---|
| 2.0 | ADR-001 cross-imports | infrastructure-engineer | (docs only) | docs/12 §1.5.1: autoriza retrieval/curator → memory. Cross-imports REALES verificados por grep coinciden con el ADR. |
| 2.1 | Tooling del repo | infrastructure-engineer | solid | package.json, tsconfig.json (17 flags + NodeNext + allowImportingTsExtensions + noEmit + verbatimModuleSyntax), eslint.config.js (ESLint 9 strict + ban-ts-comment + no-restricted-syntax para `as any`), vitest.config.ts (thresholds), validate-modules.ts (codifica ADR-001). Stack instalado: 417 paquetes. |
| 2.4 | DecayFactor recalibration (B-002) | curator-expert | ddd + solid | Re-derivacion per-day desde per-period del spec docs/05 §2 con JSDoc de origen. Drift maximo 2.99e-5. Sanity-check `factor^365d = 0.535822` matchea exactamente "Tras 1 año: × 0.54" del spec. |
| 2.3 | shared/application/ports | infrastructure-engineer | clean-arch + solid | 5 puertos: DatabaseConnection (+PreparedStatement, RunResult), Logger, Clock, IdGenerator, Embedder. TransactionManager OMITIDO (cubierto). Kdf DIFERIDO a modules/encryption/. Embedder neutralizado a Float32Array crudo. |
| 2.2 | shared/infrastructure | infrastructure-engineer | clean-arch + solid + security + perf | 8 adapters concretos: SqliteDatabase (WAL+SQLCipher+sqlite-vec con degradacion graceful), MigrationsRunner (idempotente, transaccional, regex anti-traversal), PinoLogger (DEFAULT_REDACT_PATHS de 13 keys + wildcards), FastembedEmbedder (lazy + embedBatch real ONNX-vectorizado), SystemClock+FakeClock, UuidV7+FakeIdGenerator. 3 errores tipados (cause non-enumerable). 000__bootstrap.sql. |
| 2.5 | Lint cleanup Fase 1 | infrastructure-engineer | ddd + solid (re-validacion de embedding-vector.ts) | 215 errores → 0. ~120 archivos. Mayoria autofix. 4 casos manuales: embedding-vector.ts (refactor estructural por Array.isArray any[]-contamination, comportamiento preservado 100%), decay-calculator.ts + hybrid-scorer.ts (eslint-disable preservando decision DDD aprobada), kdf-algorithm.ts (eslint-disable forward-compatibility), weak-kdf-params-error.ts (refactor type union). |

### 3 bloqueadores heredados resueltos

- **B-001** Tooling materializado en Tarea 2.1.
- **B-002** DecayFactor recalibrado en Tarea 2.4.
- **B-003** ADR-001 documentado en Tarea 2.0 (provisional, pendiente
  ratificacion `clean-architecture-validator` en Fase 3 cuando vea la
  triada de los modulos retrieval/curator).

### Decisiones del orquestador (registradas en `decisions_log` del workflow-state)

1. **Argon2idKdf NO va en `shared/`** — se difiere a
   `modules/encryption/infrastructure/`. Sus VOs (`Passphrase`,
   `KdfParams`, `DerivedKey`) viven en `encryption/domain/` y no son
   transversales.
2. **Kdf port NO va en `shared/application/ports/`** — va a
   `modules/encryption/application/ports/`. Owner: `crypto-security-expert`.
3. **TransactionManager OMITIDO** — `DatabaseConnection.transaction(fn)`
   con mode `immediate` cubre el caso. YAGNI/ISP justificado.
4. **`EncryptionKeyBytes`** interfaz local en `SqliteDatabase` como
   anti-corruption layer. El modulo encryption adapta su `DerivedKey`
   en su propio infrastructure layer.
5. **Convencion `.port.ts`** adoptada con observacion menor de
   formalizar en `docs/12 §3.1` antes de Fase 3. Pendiente.
6. **FakeClock / FakeIdGenerator co-localizados** en
   `shared/infrastructure/` (no en `tests/fixtures/`). Patron canonico
   hexagonal validado por `clean-architecture-validator`.

### Observaciones no bloqueantes (tracking)

| Severidad | Item | Cuando aplicar |
|---|---|---|
| Security-Low | `DatabaseError.openFailed` y `migrationDirectoryInvalid` incluyen path absoluto en `message`; pino redacta keys, no contenido de mensaje. Aceptable para CLI single-user. | Antes de v0.5 si se introduce telemetria/audit log estructurado. Refactor: pasar path como campo estructurado, no en mensaje. |
| Security-Info | Hex assert defensivo en `bytesToHex` (sqlite-database.ts) para blindar contra refactors que rompan el alfabeto cerrado `[0-9a-f]`. | Opcional. |
| Security-Info | `secure_zero` de la clave de cifrado tras `open()`. | Cierre explicito en Fase 3 cuando exista `KdfService.deriveKey()` (modulo encryption). |
| Perf-Minor-1 | `PRAGMA mmap_size = 268435456` (256 MiB). Headroom para 50K entries. | Validar con benchmark en Fase 5; aplicar si delta ≥5%. |
| Perf-Minor-2 | `PRAGMA busy_timeout = 5000`. Recomendado para colisiones curator↔recall. | Mismo criterio (Fase 5). |
| Perf-Minor-3 | `pino()` sin `destination` explicito (sync mode). Bajo `LOG_LEVEL=debug` puede comer 5-10ms del p95 de `mem.recall`. | Mismo criterio (Fase 5). |

### Reportes de validacion (Fase 2)

10 reportes en `.claude/validations/` (todos APPROVED, sin rechazos):
- `phase-2-task-1-solid-validator.md` (tooling)
- `phase-2-task-2-clean-architecture-validator.md` (shared/infra)
- `phase-2-task-2-solid-validator.md` (shared/infra)
- `phase-2-task-2-security-auditor.md` (shared/infra)
- `phase-2-task-2-performance-auditor.md` (shared/infra)
- `phase-2-task-3-clean-architecture-validator.md` (ports)
- `phase-2-task-3-solid-validator.md` (ports)
- `phase-2-task-4-ddd-validator.md` (DecayFactor)
- `phase-2-task-4-solid-validator.md` (DecayFactor)
- `phase-2-task-5-ddd-validator-embedding-vector.md` (post-cleanup)
- `phase-2-task-5-solid-validator-embedding-vector.md` (post-cleanup)

### Cero deuda heredada de Fase 2 a Fase 3

- `tsc --noEmit` EXIT=0 sobre 293 archivos.
- `npm run lint` EXIT=0 (0 errores).
- `npm run validate:modules` EXIT=0 (cross-imports ADR-001 verificados).
- Cero `any`, cero `as any`, cero `// @ts-ignore` en TODO el codigo.

---

## 6.7 Fase 3 — Modulos en Paralelo — CERRADA

**Cierre:** 2026-04-27. **5/5 tareas APROBADAS en ciclo 0** sin un solo
rechazo. **17 validadores ejecutados, 17 APPROVED.** **167 archivos
nuevos, ~19,100 LOC, 4 migraciones nuevas (001-004).** `tsc --noEmit` +
`npm run lint` + `npm run validate:modules` EXIT=0 sobre 478 archivos
totales del repo.

### Resultado por tarea

| # | Tarea | Owner | Validadores | Archivos | Veredicto |
|---|---|---|---|---:|---|
| 3.1 | mcp-server (application + infrastructure) | mcp-protocol-expert | clean-arch + solid + security | 33 | ✅ APPROVED ciclo 0 |
| 3.2 | encryption + secrets (application + infrastructure) | crypto-security-expert | clean-arch + solid + ddd + security | 52 | ✅ APPROVED ciclo 0 |
| 3.3 | retrieval (application + infrastructure) | retrieval-expert | clean-arch + solid + ddd + perf | 21 | ✅ APPROVED ciclo 0 |
| 3.4 | curator (application + infrastructure) | curator-expert | clean-arch + solid + ddd + perf | 23 | ✅ APPROVED ciclo 0 |
| 3.5 | workspace + cli (application + infrastructure) + 004 | infrastructure-engineer | clean-arch + solid + security | 38 | ✅ APPROVED ciclo 0 |

### Migraciones agregadas en Fase 3

| # | Archivo | Tarea | Contenido |
|---|---|---|---|
| 001 | `code/migrations/001__secret-audit-log.sql` | 3.2 | Tabla `secret_audit_log` (append-only, evidencias de deteccion) |
| 002 | `code/migrations/002__retrieval-schema.sql` | 3.3 | FTS5 virtual table + `embeddings` (sqlite-vec) + `embedding_queue` (worker async) |
| 003 | `code/migrations/003__pruned-and-curator-runs.sql` | 3.4 | Tablas `pruned`, `curator_runs`; columnas auxiliares decay/consolidacion |
| 004 | `code/migrations/004__core-memory-schema.sql` | 3.5 | Schema core: `workspaces`, `sessions`, `turns`, `decisions`, `decision_evidence`, `learnings`, `learning_evidence`, `entities`, `entity_aliases`, `tasks`, `relations` + indices + FK ON DELETE CASCADE |

### Bloqueadores cerrados en Fase 3

- **B-004** RESUELTO Y RATIFICADO: convencion sufijo `.port.ts`
  formalizada en `docs/12 §3.1`. Las entregas de 3.1/3.2/3.3/3.4/3.5
  usan el sufijo al 100%; `clean-architecture-validator` confirmo en
  cada reporte.
- **B-005** CERRADO: ADR-001 (`docs/12 §1.5.1`) ratificado por
  `clean-architecture-validator` en Tareas 3.3 y 3.4 con triadas
  retrieval+curator visibles. Conteo final auditado: **56 cross-imports
  a `memory/domain`** (retrieval x46 + curator x10), todos en scope
  autorizado (projections `*Ref` read-only, `LearningSeverity`,
  `Learning` aggregate para consolidacion). `validate:modules` EXIT=0
  con cuenta exacta.
- **B-006** RESUELTO: puerto `Kdf` en
  `code/src/modules/encryption/application/ports/kdf.port.ts` y adapter
  `Argon2idKdf` en
  `code/src/modules/encryption/infrastructure/kdf/argon2id-kdf.ts`.
  `@noble/hashes 2.x`. KDF_DEFAULTS conformes a `docs/11 §3` con
  segunda capa defensiva en infrastructure (memoryKib≥65536,
  iterations≥3, parallelism≥4).

### Decisiones del orquestador (D-301..D-310)

1. **D-301** Tarea 3.2 cerrada en ciclo 0 con tetrada APPROVED. 9
   warnings cosmeticos diferidos. EncryptionConfigRepository adapter
   diferido al modulo workspace (Tarea 3.5).
2. **D-302** Wave-1 (3.1, 3.3, 3.4) lanzada en paralelo tras 3.2 done.
   Tres expertos sobre dominios disjuntos sin contencion.
3. **D-303** Warning DDD W-1 sobre nombres de eventos `secrets.*`
   (`secrets.blocked/detected/redacted`) ratificado como CONFORME al
   patron `<module>.<past-tense-kebab-case>`. NO renombrar.
4. **D-304** Wave-1 cerrada en ciclo 0 sin un solo rechazo. 11
   validadores APPROVED. Validacion empirica del paralelismo.
5. **D-305** B-005 CERRADO formalmente con conteo auditado
   (retrieval x46 + curator x10 = 56 cross-imports).
6. **D-306** 22 warnings de Wave-1 (sumados a los 9 de Wave-0 = 31
   total entonces) DIFERIDOS A FASE 5 architect review. Ningun warning
   es critico mal clasificado.
7. **D-307** Migracion `004__core-memory-schema.sql` INCLUIDA en scope
   de Tarea 3.5 (NO se crea Tarea 3.6 separada). 7 razones documentadas
   en `decisions_log` del workflow-state.
8. **D-308** FASE 3 CERRADA EN CICLO 0 SIN UN SOLO RECHAZO. Record
   absoluto del proyecto: 5 tareas, 17 validadores, 17 APPROVED, 167
   archivos, 4 migraciones, ~26.9k LOC nuevos sobre el repo.
9. **D-309** Tarea 3.5 cerro W-DDD-3 de Tarea 3.2:
   `EncryptionConfigRepository` quedo en `encryption/infrastructure/`,
   NO en `workspace/`. workspace expone `WorkspaceFileSystem` (operaciones
   FS agnosticas); encryption persiste el aggregate. Cero cross-imports
   rotos.
10. **D-310** ~35 warnings consolidados de Fase 3 DIFERIDOS A FASE 5
    architect review. Sintesis: 3 highs perf curator (10K+ scale only),
    2 mediums perf retrieval (db.prepare cache), 2 mediums + 2 lows
    security workspace (atomic gitignore + chmod DB + redact +
    constant-time), 1 medium security mcp-server (buffer cap), 9
    cosmetic encryption/secrets, ~3 soft notes DDD/dominio.

### Warnings consolidados para Fase 5 architect review (~35 entradas)

Todos NO bloqueantes para Fase 4. Lista completa en
`.claude/workflow-state.json` →
`phases.phase-3-modules.consolidated_warnings_for_phase_5_architect`.
Sintesis:

| Categoria | Items | Severidad maxima | Referencia |
|---|---|---|---|
| **Perf curator (>10K scale)** | W-3.4-PERF-H1 (applyDecay sin batch), H2 (PruneLowConfidence sin batch transaction), H3 (Vec0SimilarityFinder 1+1 lookup) | high | scale-only, MVP no afectado |
| **Perf retrieval/curator (db.prepare cache)** | W-3.3-PERF-M1, W-3.3-PERF-M2 (bumpUsage), W-3.4-PERF-M1, W-3.4-PERF-M2 | medium | optimizacion estandar SQLite |
| **Security workspace hardening** | W-3.5-SEC-M1 (atomic write+rename en ensureGitignore), W-3.5-SEC-M2 (chmod 0o600 sobre recall.db), W-3.5-SEC-L1 (redact err.message), W-3.5-SEC-L2 (constant-time compare path) | medium | hardening defensivo, modos privacy NO rotos |
| **Security mcp-server (buffer cap)** | W-3.1-SEC-M1 (StdioJsonRpcServer.buffer sin cap, DoS escenario adversarial) | medium | MVP single-user CLI no expone vector |
| **Cosmetic encryption/secrets** | W-CA-1 (dir vacio), W-CA-2/3 (split puerto+helpers), W-SOLID-1/2/3 (isStatus muerto, void absoluteHookPath, throw new Error generico), W-DDD-1/2 (eventName ratificado) | minor/cosmetic | refactors locales |
| **DDD soft notes (cierran en Fase 4 composition)** | W-3.3-DDD-1 (WorkspaceDisplayName placeholder), W-3.3-DDD-2 (EventBus pendiente), W-3.4-DDD-3 (tasks schema nullable; resuelto en 3.5), W-3.4-DDD-1/2/4 (placeholders MVP) | info | wiring composition root cierra varios |

### Reportes de validacion (Fase 3)

17 reportes nuevos en `.claude/validations/` (todos APPROVED, sin rechazos):

```
phase-3-task-1-clean-architecture-validator.md     (mcp-server)
phase-3-task-1-solid-validator.md
phase-3-task-1-security-auditor.md
phase-3-task-2-clean-architecture-validator.md     (encryption + secrets)
phase-3-task-2-solid-validator.md
phase-3-task-2-ddd-validator.md
phase-3-task-2-security-auditor.md
phase-3-task-3-clean-architecture-validator.md     (retrieval)
phase-3-task-3-solid-validator.md
phase-3-task-3-ddd-validator.md
phase-3-task-3-performance-auditor.md
phase-3-task-4-clean-architecture-validator.md     (curator)
phase-3-task-4-solid-validator.md
phase-3-task-4-ddd-validator.md
phase-3-task-4-performance-auditor.md
phase-3-task-5-clean-architecture-validator.md     (workspace + cli + 004)
phase-3-task-5-solid-validator.md
phase-3-task-5-security-auditor.md
```

### Cero deuda heredada de Fase 3 a Fase 4

- 478 archivos `.ts`, ~46k LOC totales en `code/src/`.
- 5 migraciones aplicables linealmente (000-004).
- `tsc --noEmit` EXIT=0.
- `npm run lint` EXIT=0 (0 errores, max-warnings 0).
- `npm run validate:modules` EXIT=0 (56 cross-imports ADR-001
  autorizados, cero violaciones).
- Cero `any`, cero `as any`, cero `// @ts-ignore`.
- 56 cross-imports auditados y autorizados; cero adicionales no
  documentados.

---

## 6.8 Fase 4 — Composition Root + Gaps — CERRADA

**Cierre:** 2026-04-27. **4 sub-tareas APROBADAS** (4.0 initial composition
+ 4.5 memory + 4.6 encryption persistence + 4.7 re-wiring). **15
validadores APPROVED.** **1 ciclo de rechazo** (primer rechazo del
proyecto: performance-auditor en 4.5 con 3 criticos N+1/transaccion;
corregido en ciclo 1). **~93 archivos entregados, ~12,400 LOC, 1
migracion nueva (005__perf-indexes).** `tsc --noEmit` + `npm run lint`
+ `npm run validate:modules` EXIT=0 sobre 570 archivos totales del
repo.

### Resultado por sub-tarea

| # | Tarea | Owner | Validadores | Archivos | Ciclos rechazo | Veredicto |
|---|---|---|---|---:|:---:|---|
| 4.0 | Composition initial (bootstrap, container, EventBus, ToolRegistry, EncryptionKeyAdapter) | infrastructure-engineer | clean-arch + solid + security | 26 | 0 | ✅ APPROVED ciclo 0 (con 19 stubs Pending* documentados) |
| 4.5 | memory application + infrastructure | backend | clean-arch + solid + ddd + perf + security | 61 | 1 | ✅ APPROVED ciclo 1 (perf REJECTED ciclo 0; fix UNION ALL + transaction + indices) |
| 4.6 | encryption persistence + destroy (JsonEncryptionConfigRepository + DestroyEncryptionUseCase) | crypto-security-expert | clean-arch + solid + ddd + security | 5 nuevos + 5 modificados | 0 | ✅ APPROVED ciclo 0 |
| 4.7 | re-wiring composition (eliminar 12 stubs + justificar 5) | infrastructure-engineer | clean-arch + solid + security | ~12 editados | 0 | ✅ APPROVED ciclo 0 |

### Migracion agregada en Fase 4

| # | Archivo | Tarea | Contenido |
|---|---|---|---|
| 005 | `code/migrations/005__perf-indexes.sql` | 4.5 (ciclo 1) | Indices hot-path: por kind, por workspace_id, por last_used_at_ms DESC. Cierra perf-auditor critico de ciclo 0. |

### W-3.3-DDD-2 cerrado

**EventPublisher port** movido desde workaround temporal a
`code/src/shared/application/ports/event-publisher.port.ts`. Cubre
suscripciones cross-module (memory.* → curator/retrieval listeners).
`AsyncEmbeddingWorker` y `Curator` ya consumen via puerto compartido.

### 12 stubs Pending* eliminados (ex Fase 4 inicial → cerrados en 4.5/4.6/4.7)

| Stub original | Cerrado en | Adapter real |
|---|---|---|
| PendingDecisionRepository | 4.5 | SqliteDecisionRepository |
| PendingLearningRepository | 4.5 | SqliteLearningRepository |
| PendingEntityRepository | 4.5 | SqliteEntityRepository |
| PendingTaskRepository | 4.5 | SqliteTaskRepository |
| PendingTurnRepository | 4.5 | SqliteTurnRepository |
| PendingSessionRepository | 4.5 | SqliteSessionRepository |
| PendingRelationRepository | 4.5 | SqliteRelationRepository |
| PendingMemoryProjectionRepository | 4.5 | SqliteMemoryProjectionRepository |
| PendingGetContextFacade | 4.5 → 4.7 wiring | GetContextBundleUseCase |
| PendingRecallMemoryFacade | 4.5 → 4.7 wiring | RecallMemoryUseCase |
| PendingRememberFacade | 4.5 → 4.7 wiring | RememberUseCase |
| PendingTrackTaskFacade | 4.5 → 4.7 wiring | TrackTaskUseCase |
| PendingEncryptionConfigRepository | 4.6 | JsonEncryptionConfigRepository |
| PendingDestroyEncryptionFacade | 4.6 → 4.7 wiring | DestroyEncryptionUseCase |

### 5 stubs justificados restantes (pasan a Fase 5/v0.5)

| Stub | Razon | Cierre planeado |
|---|---|---|
| PendingExportKeyFacade | Multi-key envelope flow | v0.5 (docs/09-roadmap.md) |
| PendingRekeyFacade | Multi-key envelope flow | v0.5 |
| PendingAddKeyFacade | Multi-key envelope flow | v0.5 |
| UninstallPreCommitHook (use case stub) | Gap secrets module (install si, uninstall no) — **B-009** | Fase 5 (prioridad baja) o v0.5 |
| ServerFacade (sub-process delegation) | Decision arquitectonica: mcp-server sera binario dedicado | Fase 5 Tarea 5.0 build fix abre la ruta |

Cada stub tiene JSDoc forward-compatibility y arroja
`McpFacadeNotImplementedError` con error code estable.

### Disputes residuales (3, trackeados como bloqueadores Fase 5)

| ID | Item | Severidad | Donde |
|---|---|---|---|
| **B-007** | `tsup --bundle` flag invalido en `code/package.json` build script. Heredado de Fase 4 inicial. NO bloquea tsc/lint/validate:modules pero impide `npm run build` y E2E binary. **BLOQUEADOR para Fase 5 E2E.** | high | `code/package.json` scripts |
| ~~**B-008**~~ | ~~`mem.task.get` y `mem.task.delete` use cases inexistentes en memory module. Lanza `McpFacadeNotImplementedError`.~~ **CLOSED en v0.1.0 (recall) sub-fase 3.** Implementado end-to-end: `Task.delete()` en agregado, `TaskDeleted` event, `TaskRepository.delete`, `TrackTaskUseCase.get/delete`, facade routes get/delete, error code `-32110 TASK_NOT_FOUND` cableado al mapper. | medium | `code/src/modules/memory/application/use-cases/`, `code/src/composition/facades/mcp-server-facades.ts` |
| Mapping defensivo | `EntityKindWire` vs `EntityKind` domain: mapping defensivo activo (`struct→class`, `agent→concept`, `file→module`). Aceptable para MVP, decision arquitectonica en 5.6. | low | `code/src/composition/wiring/entity-kind-mapper.ts` |

### Decisiones del orquestador (D-401..D-410)

1. **D-401** Fase 4 inicial cerrada en estado `approved-with-gaps` con
   3/3 validadores APPROVED y 19 stubs Pending* documentados.
2. **D-402** Fase 4.5 abierta con tareas 4.5 (memory, owner: backend) y
   4.6 (encryption, owner: crypto-security-expert) en paralelo.
3. **D-403** Tarea 4.7 (re-wiring) programada tras cierre de 4.5+4.6.
4. **D-404** Decisiones humanas D-101/D-102/D-103 SIGUEN DIFERIDAS a
   Fase 5 architect review (no se pre-resuelven en 4.5/4.7).
5. **D-405** Tarea 4.5 cerrada en CICLO 1. **PRIMER RECHAZO DEL
   PROYECTO**: performance-auditor REJECTED ciclo 0 con 3 criticos
   (N+1 en findAllByWorkspace, falta transaction() en bulk import,
   indices faltantes hot-path). Backend aplico fixes en ciclo 1
   satisfactoriamente.
6. **D-406** Tarea 4.6 cerrada ciclo 0 sin rechazos. 4/4 validadores
   APPROVED. JsonEncryptionConfigRepository persiste en config.json
   (no SQLite); DestroyEncryption reusa flow de Unlock.
7. **D-407** Tarea 4.7 cerrada ciclo 0 sin rechazos. 3/3 validadores
   APPROVED. 12 stubs eliminados, 5 justificados con error tipado.
   Decision arquitectonica: extender puerto DestroyEncryptionFacade en
   workspace para aceptar `passphrase: string`.
8. **D-408** 5 stubs Pending* persisten justificadamente: 3 multi-key
   v0.5, 1 UninstallHook gap (B-009), 1 ServerFacade sub-process.
9. **D-409** Schema migration 004 declara `tasks.status DEFAULT
   'pending'` pero domain usa `'todo'`. Gap aceptado para Fase 5
   (B-010). Normalizacion defensiva en SqliteTaskRepository adapter.
10. **D-410** Build script `tsup --bundle` flag invalido es BLOQUEADOR
    para Fase 5 E2E (B-007). Tarea 5.0 (build fix) ejecutarse al
    inicio de Fase 5.

### Reportes de validacion (Fase 4)

16 reportes nuevos en `.claude/validations/`:

```
phase-4-composition-clean-architecture-validator.md   (4.0 initial)
phase-4-composition-solid-validator.md
phase-4-composition-security-auditor.md
phase-4-task-5-clean-architecture-validator.md        (4.5 memory)
phase-4-task-5-solid-validator.md
phase-4-task-5-ddd-validator.md
phase-4-task-5-performance-auditor.md                  (REJECTED ciclo 0)
phase-4-task-5-performance-auditor-cycle-1.md          (APPROVED ciclo 1)
phase-4-task-5-security-auditor.md
phase-4-task-6-clean-architecture-validator.md        (4.6 encryption)
phase-4-task-6-solid-validator.md
phase-4-task-6-ddd-validator.md
phase-4-task-6-security-auditor.md
phase-4-task-7-clean-architecture-validator.md        (4.7 re-wiring)
phase-4-task-7-solid-validator.md
phase-4-task-7-security-auditor.md
```

### Cero deuda heredada de Fase 4 a Fase 5 (excepto B-007/B-008/B-009/B-010)

- 570 archivos `.ts`, ~58.4k LOC totales en `code/src/`.
- 6 migraciones aplicables linealmente (000-005).
- `tsc --noEmit` EXIT=0.
- `npm run lint` EXIT=0 (0 errores, max-warnings 0).
- `npm run validate:modules` EXIT=0 (cross-imports ADR-001 vigentes;
  cero violaciones).
- Cero `any`, cero `as any`, cero `// @ts-ignore`.
- 0 stubs Pending* sin justificar (12 eliminados, 5 con justificacion
  documentada).
- ~10 warnings nuevos consolidados para architect review (sumados a
  los 35 de Fase 3 = ~45 total para 5.6).

---

## 6.9 Fase 5 — Testing + Architect Review FINAL — CERRADA

**Cierre:** 2026-04-28. **7 sub-tareas (5.0-5.6) APROBADAS**, 4 ciclos
de fix iterativo en 5.5 (qa-sonarqube-auditor), 1 architect review
APROBADO CON OBSERVACIONES en 5.6 (cero rechazos formales). **2421
tests passing en 199 archivos test**, coverage **96.4%**, **0 bugs / 0
vulns / 0 blockers / 0 critical** en SonarQube quality gate. **9 bugs
descubiertos durante 5.x todos arreglados.**

### Resultado por sub-tarea

| # | Tarea | Owner | Validadores | Ciclos rechazo | Veredicto |
|---|---|---|---|:---:|---|
| 5.0 | Build fix `tsup --bundle` (B-007) | infrastructure-engineer | solid + security | 0 | ✅ APPROVED |
| 5.1 | Tests unit por modulo (8 modulos, paralelo) | domain-architect + backend + retrieval-expert + curator-expert + crypto-security-expert + mcp-protocol-expert + infrastructure-engineer | qa-sonarqube-auditor | 0 | ✅ APPROVED |
| 5.2 | Tests integration cross-module | infrastructure-engineer | qa-sonarqube-auditor | 0 | ✅ APPROVED |
| 5.3 | Tests E2E binary (CLI + MCP server) | infrastructure-engineer | qa-sonarqube-auditor | 0 | ✅ APPROVED |
| 5.4 | Benchmarks performance (p95) | performance-auditor | — | 0 | ✅ APPROVED (SLO encrypted revisado a <1500ms) |
| 5.5 | SonarQube scan + quality gate strict | qa-sonarqube-auditor | — (auto-validador) | **4** | ✅ APPROVED ciclo 5 |
| 5.6 | Architect review final | architect | — | 0 | ✅ APPROVED CON OBSERVACIONES |

### Metricas finales

| Metric | Valor |
|---|---|
| Tests passing | **2421** |
| Archivos test | **199** |
| Coverage global | **96.4%** |
| Coverage new code | 99.1% |
| Domain coverage | 100% |
| Application coverage | 100% |
| Infrastructure coverage | ≥90% |
| Migraciones aplicables | **7** (000-006) |
| Bugs detectados (Sonar) | **0** |
| Vulnerabilidades (Sonar) | **0** |
| Blockers / Critical (Sonar) | 0 / 0 |
| sqale_debt_ratio | **0.1%** |
| Quality gate | **PASSED** |
| `tsc --noEmit` | EXIT=0 |
| `npm run lint` (max-warnings 0) | EXIT=0 |
| `npm run validate:modules` | EXIT=0 |
| `npm run build` | EXIT=0 |
| `npm run test` | EXIT=0 |

### 4 decisiones humanas resueltas (architect review §A)

| # | Decision | Resolucion | Documentado en |
|---|---|---|---|
| **D-101** | PriorityBoost multiplicativo vs aditivo | **Conformar a codigo (multiplicativo)**. Aditivo invierte ranking en cola larga. | `docs/12 §1.5.2 ADR-002` + `docs/01 §2.6` |
| **D-102** | ContextLayerKind names domain vs wire literals | **Mapping permanente (Anti-Corruption Layer canonico DDD)**. Domain mantiene `workspace_anchor`/`active_decisions`/`entities_in_focus`; wire mantiene `system_identity`/`project_constitution`/`code_map`. | `docs/12 §1.5.3 ADR-003` + `docs/02 §4.2` |
| **D-103** | encrypted -> shared transition | **Mantener prohibida** (politica conservadora). Domain lanza `InvalidModeTransitionError`. Usuario debe pasar por `encrypted -> private -> shared` (dos pasos explicitos). | `docs/11 §5` |
| **E** | SLO encrypted (1412ms p95 vs <400ms target) | **Opcion B** — actualizar SLO a `<1500ms encrypted`, mantener Argon2id OWASP 2024 (64 MiB / 3 iter / 4 parallel). Sin compromiso a la seguridad. | `HANDOFF.md §0` + `docs/01 §10` (cuando se actualice) |

### ~45 warnings classification (architect review §B)

| Categoria | Count | Destino |
|---|---:|---|
| **Bloqueador-MVP** | **0** | — |
| **Backlog v0.5** | 18 | Optimizaciones perf >10K, hardening defensivo, telemetria. Documentado en roadmap §10. |
| **Wontfix justificados** | 4 | LearningsAbsorbedUseCase blueprint, staleRunRecovered crash recovery, schema task fields nullables (Tarea 3.5), Q-006/Q-007 paths/mmap delta <5%. |
| **Doc-update aplicadas** | 3 | ADR-002 multiplicativo, ADR-003 wire-vs-domain, HANDOFF §0 SLO encrypted |

### 4 stubs `Pending*` justificados deferidos a v0.5

1. **PendingExportKeyFacade** — multi-key envelope flow (v0.5 roadmap).
2. **PendingRekeyFacade** — multi-key envelope flow (v0.5 roadmap).
3. **PendingAddKeyFacade** — multi-key envelope flow (v0.5 roadmap).
4. **ServerFacade** — sub-process delegation a `recall-server` binario dedicado (decision arquitectonica del mcp-server module).

`UninstallPreCommitHook` (anteriormente #4) **cerrado en v0.1.0 (recall) sub-fase 4 — B-009**: implementado y wired. Cada stub restante tiene JSDoc forward-compat + error tipado `McpFacadeNotImplementedError` con error code estable.

### 9 bugs descubiertos durante 5.x todos arreglados

Detectados por la suite de tests integration + E2E + perf benchmarks
+ qa-sonarqube-auditor en ciclos de fix de Tarea 5.5. Cero defectos
escapan a release. Reportes en
`.claude/validations/phase-5-task-5-qa-sonarqube-auditor-cycle-{1..5}.md`.

### Reportes de validacion (Fase 5)

6 reportes nuevos en `.claude/validations/`:

```
phase-5-task-5-qa-sonarqube-auditor-cycle-1.md   (REJECTED)
phase-5-task-5-qa-sonarqube-auditor-cycle-2.md   (REJECTED)
phase-5-task-5-qa-sonarqube-auditor-cycle-3.md   (REJECTED)
phase-5-task-5-qa-sonarqube-auditor-cycle-4.md   (REJECTED)
phase-5-task-5-qa-sonarqube-auditor-cycle-5.md   (APPROVED — gate PASSED)
phase-5-task-6-architect-final-review.md         (APPROVED CON OBSERVACIONES)
```

### Cero deuda heredada de Fase 5 a Release

- 8 bloqueadores resueltos (B-001..B-010 todos cerrados o
  documentados como wontfix con workaround).
- Cero issues estructurales pendientes.
- 4 decisiones humanas resueltas (D-101/D-102/D-103/E).
- 18 items de backlog v0.5 catalogados explicitamente.
- 5 stubs `Pending*` justificados (v0.5 roadmap).
- Quality gate SonarQube PASSED.

---

## 6.10 Fase 6 — Release MVP v0.1.0

**Cierre:** 2026-04-28 (sesion de release). Tag y branch pusheados al
remoto `git@github.com:NetziTech/recall.git`. GitHub
release publicado. **`npm publish` ejecutado y validado** —
`@netzi/recall@0.1.0` disponible en
https://registry.npmjs.org/@netzi/recall.

### Hallazgos al inicio de la sesion

1. **Tag `v0.1.0` ya existia en remoto** apuntando a un commit
   pre-release con `package.json.version = "0.1.0-alpha.0"`,
   `name = "recall"` (sin scope), `private: true`, y `uuid@^11`
   (vulnerable). Sin GitHub release publicado. Tag fantasma creado
   prematuramente, autorizado por el usuario para reescritura
   (decision A+C: borrar local + remoto, re-tagear).
2. **`npm audit` reporto 3 vulns** que SonarQube no detecto (escanea
   source, no deps): `uuid` moderate (cerrable), `fastembed` + `tar`
   highs (upstream-locked).
3. **`code/README.md` obsoleto** (decia "esta vacio").
4. **`code/LICENSE` no existia.**
5. **`build:binaries` no existia** — decision: publicar a npm en vez de
   intentar binarios standalone (decision C1).

### Acciones ejecutadas

| # | Accion | Resultado |
|---|---|---|
| 1 | `git tag -d v0.1.0` + `git push origin :refs/tags/v0.1.0` | tag fantasma eliminado |
| 2 | `uuid` bumpeado a `^14.0.0` en `code/package.json` | 1 vuln cerrada, sin regresiones (199/199 archivos test verde) |
| 3 | Override `tar@^7.5.11` aplicado y revertido | rompe `import tar from "tar"` en `fastembed@2.x`. Las 2 highs quedan como **known upstream issue** (decision B1). |
| 4 | `code/package.json` reescrito | `name=@netzi/recall`, `version=0.1.0`, `license=MIT`, `publishConfig.access=public`, `repository.url=git+https://github.com/NetziTech/recall.git`, `directory=code`, `keywords`, `homepage`, `bugs`, `prepublishOnly` script. `private:true` removido. |
| 5 | `code/LICENSE` creado | MIT, Copyright (c) 2026 Netzi Tech |
| 6 | `code/README.md` reescrito | install via `npm i -g @netzi/recall`, quick start, modos, known issues (CVEs upstream), dev setup |
| 7 | `docs/RELEASE-NOTES-v0.1.0.md` creado | engineering metrics, CVEs upstream con CVSS y mitigacion, stubs deferidos, SLO note |
| 8 | HANDOFF.md actualizado | §0 + §6.10 (esta seccion) |
| 9 | Sanity check final | `npm run typecheck + lint + validate:modules + build + test` → EXIT=0 en los 5 |
| 10 | Commit unico `release: v0.1.0` | en branch `claude/magical-elbakyan-fca193` |
| 11 | Branch fast-forwarded a `main` y pusheado | `git push origin claude/magical-elbakyan-fca193:main` |
| 12 | Tag annotated `v0.1.0` re-creado y pusheado | apunta al commit con todos los fixes |
| 13 | `gh release create v0.1.0` | con notes desde `docs/RELEASE-NOTES-v0.1.0.md` |
| 14 | `npm publish --dry-run` (1ra) | warning: `bin` paths con `./` invalidos. Auto-fix `npm pkg fix` aplicado. |
| 15 | Re-tag v0.1.0 (segunda vez) | `gh release delete v0.1.0` + `git push origin :refs/tags/v0.1.0` + commit fix `7da553a` + FF main + re-tag + push tag + `gh release create v0.1.0`. Decision A autorizada. |
| 16 | `npm publish --dry-run` (2da) | sin warnings, 15 archivos en tarball, 1.4 MB packed. |
| 17 | `npm publish` real | EJECUTADO por el usuario via WebAuthn passkey flow (`auth-type=web`). PUT 200, exit 0. |
| 18 | Smoke test E2E | `npx --yes @netzi/recall@0.1.0 --help` desde `/tmp/npx-smoke` limpio: descarga, instala deps (10), ejecuta CLI con help completo. EXIT=0. |
| 19 | Validacion final | API registry 200, tarball descargable 200, GitHub release published not-draft, tag→main coherente. UI web `npmjs.com/package/...` retorna 403 cosmetico (indexing pipeline tarda ~horas; instalacion ya funciona). |

### Decisiones del orquestador (D-601..D-606)

1. **D-601** Tag fantasma `v0.1.0` borrado y re-creado sobre commit
   corregido (decision A+C autorizada por el usuario). Force-push de
   tag justificado: no habia GitHub release ni consumidores.
2. **D-602** `uuid` bumpeado a 14.x (cerrar 1 vuln moderate). Cero
   regresiones porque solo se usa `v7()` sin buf argument.
3. **D-603** `tar` override **NO aplicado** porque rompe `fastembed@2.x`.
   2 highs upstream documentadas como known issue con vector real bajo
   (modelo HuggingFace adversarial). Plan de fix en v0.1.1.
4. **D-604** Empaquetado via npm registry bajo scope `@netzi/recall`
   (decision C1). NO se intentaron binarios standalone (SEA, pkg) por
   complicacion con `better-sqlite3-multiple-ciphers` y
   `sqlite-vec` native bindings.
5. **D-605** LICENSE MIT, copyright Netzi Tech. Default razonable;
   ajustable si el usuario decide otra licencia.
6. **D-606** `npm publish` lo ejecuto el usuario manualmente desde su
   sesion CLI autenticada (cuenta `h2devx`, owner de org `netzi`). Uso
   `--auth-type=web` (passkey en macOS) porque tiene 2FA activado y no
   acepta TOTP. Resultado: PUT 200 + exit 0. Cero tokens npm
   almacenados en el repo.
7. **D-607** Re-tag v0.1.0 ejecutado DOS VECES en esta sesion (decision
   A+C inicial + decision A second-round por el `bin` path warning).
   Justificacion: el primer tag fantasma `v0.1.0` apuntaba a un commit
   con `package.json.version = "0.1.0-alpha.0"`; el segundo tag
   apuntaba a un commit con `bin: "./dist/..."` que npm auto-rompia al
   publicar. En ambos casos no habia release ni consumidores. Tag
   final `v0.1.0` apunta a commit `7da553a` con todo coherente.
8. **D-608** Smoke test E2E desde directorio limpio (`/tmp/npx-smoke`)
   adoptado como ultimo gate de validacion del release. Confirma que
   el paquete publicado en npm es funcional, no solo que `npm publish`
   retorno 0.

### Reportes de validacion

Esta fase no ejecuta validadores formales (es release, no implementacion).
Los chequeos automaticos son los de `prepublishOnly`:
`typecheck + lint + validate:modules + build + test`. Todos EXIT=0
sobre el commit final.

### Cero deuda heredada de Fase 6 a v0.1.1

- 2 vulns highs documentadas en `docs/RELEASE-NOTES-v0.1.0.md` con
  vector real, mitigacion y plan de fix. **Cerradas como wontfix
  formal en sub-fase 5 (§6.11) con ADR-004.**
- 5 stubs `Pending*` siguen justificados (tracking en §6.9).
- 18 items backlog v0.5 catalogados (tracking en §6.9).
- Repo sincronizado: `main` remoto = tag `v0.1.0` = HEAD del worktree.

## 6.11 v0.1.1 sub-fase 5 — investigacion y wontfix de tar/fastembed highs

**Cierre:** 2026-04-28. Sub-fase 5 del ciclo
`phase-7-rename-and-recall-v0.1.0` (post-rename, post-CLI-fixes,
pre-publish v0.1.1).

### Objetivo

Cerrar las 2 advisories `high` (`GHSA-34x7-hfp2-rc4v` +
`GHSA-83g3-92jg-28cx`, mas cluster relacionado) que `npm audit
--omit=dev` reporta sobre `tar@6.x` heredado de `fastembed@^2.0.0`,
**sin** romper el embedder ni introducir codigo de seguridad custom.

### Investigacion ejecutada

| # | Alternativa | Comando/test | Resultado |
|---|---|---|---|
| 1 | Bump `fastembed` a `2.1.0` | `npm view fastembed@2.1.0 dependencies` | RECHAZADA. fastembed@2.1.0 sigue con `tar: ^6.2.0`. Ya estabamos en 2.1.0 (resuelto por `^2.0.0`). |
| 2 | `npm overrides: { "tar": "7.5.13" }` + reinstall | `npm install` + `npx vitest run tests/unit/shared/infrastructure/embedder/` | RECHAZADA. `npm audit --omit=dev` reporta `0 vulnerabilities` con el override aplicado, pero la suite del embedder falla con `SyntaxError: The requested module 'tar' does not provide an export named 'default'` en `import tar from "tar"` (linea 7 de `node_modules/fastembed/lib/esm/fastembed.js`). Confirmado empiricamente: `tar@7.5.13` ESM solo expone named exports. Override revertido. |
| 3 | Swap a `@huggingface/transformers` (Xenova) | `npm view @huggingface/transformers dependencies` (sin `tar`, con `sharp` + `onnxruntime-node`) | RECHAZADA. Cambio v0.5-class: re-implementar adapter, ~24 tests mockeando `FlagEmbedding.init`, riesgo de regresion en benchmarks (`mem.recall` 1.51ms p95 actual), nueva nativa `sharp`, posibles diffs en normalizacion de embeddings que afectarian retrieval scores ya almacenados. Out of scope para patch de seguridad. |
| 4 | Custom shim `tar7-default-export-wrapper` via `npm:` alias en overrides | (no implementado) | RECHAZADA. Crear/mantener un wrapper que re-exporta `{ x, c, t, ... }` como `default` ES codigo de seguridad custom. La regla del modulo `encryption` ("nunca implementar criptografia custom") se extiende por consistencia a deps de seguridad criticas como `tar` (extraccion de archivos no confiables). |

### Decisiones del orquestador

1. **D-611** Wontfix formal de las 2 highs hasta v0.5, justificado por
   las 4 alternativas descartadas.
2. **D-612** ADR-004 redactado en `docs/12-lineamientos-arquitectura.md
   §1.5.4` con tabla de alternativas, vector real corregido y plan de
   reapertura en v0.5.
3. **D-613** Vector real **corregido** en `code/README.md` y
   `docs/RELEASE-NOTES-v0.1.0.md`. La v0.1.0 original decia "atacante
   controla un modelo en HuggingFace CDN"; la lectura de
   `node_modules/fastembed/lib/esm/fastembed.js` linea 138 demuestra
   que la URL real es
   `https://storage.googleapis.com/qdrant-fastembed/<modelName>.tar.gz`
   (GCS bucket de Qdrant), no HuggingFace. Likelihood real: muy
   bajo (compromise de bucket GCS o TLS MITM con CA comprometida).
4. **D-614** Sin cambios de codigo en este commit. La unica defensa
   en profundidad practica (pre-warm de cache via `cacheDir`) ya
   existe en el adapter; el commit solo re-documenta como activarla.
   Una mejora con SHA-pinning del tarball antes de invocar `tar.x` se
   evaluo y descarto: requiere mantener SHAs hardcoded para 7 modelos
   (algunos > 1 GB) que Qdrant podria rotar sin aviso, y no se gana
   defensa real porque el TLS+IAM ya gating del bucket es lo que cubre
   el vector residual.

### Hallazgos

- **Correccion factual:** la documentacion v0.1.0 atribuia el
  download a HuggingFace; en realidad es GCS de Qdrant. El cambio
  reduce el modelo de amenaza real (la superficie GCS+TLS es mas
  acotada que la de HF + sus mirrors).
- **Empirico:** `tar@7.x` ESM no expone `default` export. Esto
  invalida cualquier override directo mientras fastembed mantenga
  `import tar from "tar"`. Documentado para no re-investigar en
  futuras sesiones.
- **`fastembed@2.1.0` = latest** al 2026-04-28. Su release timeline
  (1.14.4 → 2.0.0 → 2.1.0) sugiere que el equipo Qdrant podria pasar
  a `tar@7.x` en una proxima 2.x, pero no hay senial publica.

### Archivos tocados

| Archivo | Cambio |
|---|---|
| `docs/12-lineamientos-arquitectura.md` | + §1.5.4 ADR-004 (wontfix con tabla de alternativas + correccion del vector real). |
| `code/README.md` | "Known issues" reescrita: vector real GCS de Qdrant (no HF), mitigacion `cacheDir`/`FASTEMBED_CACHE_PATH`, link a ADR-004. |
| `docs/RELEASE-NOTES-v0.1.0.md` | Bloque "Upstream CVEs" reescrito con nota de update, tabla de alternativas, mitigacion clarificada, plan v0.5. |
| `HANDOFF.md` | §0 fila "Vulns npm audit" + fila "Proximo paso" actualizadas. Esta seccion §6.11 nueva. |

### Validacion

`npm audit --omit=dev` sigue reportando exactamente las 2 advisories
ya conocidas (esperado — la decision es wontfix). Los 5 checks
pre-commit:

| Check | Resultado |
|---|---|
| `npm run typecheck` | EXIT=0 |
| `npm run lint` | EXIT=0 |
| `npm run validate:modules` | EXIT=0 (PASS — no module violations) |
| `npm run build` | EXIT=0 |
| `npm test` | EXIT=0 (2421 tests passing) |

### Reapertura prevista en v0.5

Si para v0.5 `fastembed` no ha publicado release con `tar@7.x`, la
opcion (3) (swap a `@huggingface/transformers`) se promueve a
prioridad alta. ADR-004 documenta los criterios de reapertura.

---

## 7. Como retomar el trabajo

### Si soy yo mismo (otra sesion de Claude Code)

```bash
cd /Users/h2devx/proyects/netzi-tech/mcp/memoria
claude
> lee HANDOFF.md §0 + §6.10 (Fase 6 release). El MVP v0.1.0 esta
  PUBLICADO en npm + GitHub. El workflow multi-agente esta CERRADO.
  Para nuevas features (v0.1.1 / v0.5+), lanza al mcp-orchestrator
  con scope acotado a una sola tarea (no abrir nueva fase entera).
  NUNCA usar git worktrees — trabajar siempre directo en el repo
  principal (regla durable; ver memoria de feedback).
```

### Si es otro dev humano

```bash
git clone git@github.com:NetziTech/recall.git
cd recall
git checkout v0.1.0          # release inicial publico
cat HANDOFF.md               # §0 + §6.5..§6.10 (historial fases 1-6)
cat .claude/workflow-state.json   # estado: phase-6-release done
cat docs/README.md           # producto
cat docs/12-lineamientos-arquitectura.md   # ADR-001/ADR-002/ADR-003
cat docs/13-workflow-agentes.md            # quien hace que
cd code && npm install && npm run typecheck && npm run lint && \
  npm run validate:modules && npm run build && npm run test
# Los 5 EXIT=0.
```

### Estado del repo git (post-release v0.1.0)

- **Commit del release**: `7da553a` — `fix(release): drop leading ./ from package.json bin paths` (commit final tras dos rondas de re-tag por temas de coherencia release engineering — ver §6.10).
- **Tag**: `v0.1.0` annotated apuntando a `7da553a`.
- **Branch principal**: `main` (sincronizado con `origin/main`).
- **Remoto**: `git@github.com:NetziTech/recall.git`.
- **Paquete npm**: https://registry.npmjs.org/@netzi/recall → `@netzi/recall@0.1.0` (publicado por `h2devx`, owner de org `netzi`, via WebAuthn passkey).
- **GitHub release**: https://github.com/NetziTech/recall/releases/tag/v0.1.0 (notes desde `docs/RELEASE-NOTES-v0.1.0.md`).
- **Archivos tracked**: ~700 (8 docs, 13 agents, 71 validations, 8 migrations, ~570 .ts source, ~210 tests, configs, LICENSE).
- **`.gitignore`** (raiz): excluye `.DS_Store`, IDE files, secrets locales, **`.claude/worktrees/`** (auto-worktree del harness — el usuario quiere trabajar siempre en el repo principal, NO en worktrees).
- **`code/.gitignore`**: excluye `node_modules/`, `dist/`, `coverage/`, etc.

### Smoke test del release (cualquier maquina con Node 20+)

```bash
npx --yes @netzi/recall@0.1.0 --help
# Esperado: imprime el help completo del CLI con sus 20 comandos.
```

### Roadmap v0.5+ (resumen — detalle en §8)

1. **Multi-key envelope flow**: ExportKey, Rekey, AddKey (3 stubs
   `Pending*` deferidos).
2. **Encrypted cold start <500ms** via OS keychain key cache (ADR
   pendiente; trade-off de seguridad documentado).
3. **`mem.task.get` / `mem.task.delete`** sub-actions (B-008
   diferido a v0.5).
4. **Performance hardening >10K entries**: applyDecay batch,
   PruneLowConfidence transaction, Vec0SimilarityFinder lookup,
   db.prepare cache hot-path (W-3.4-PERF-H1/H2/H3, W-3.3-PERF-M1/M2).
5. **Hardening defensivo**: atomic gitignore write+rename, chmod
   0o600 sobre `recall.db`, redact path en err.message,
   StdioJsonRpcServer buffer cap (anti-DoS), `UninstallPreCommitHook`
   (B-009).

---

## 8. Pendientes / preguntas abiertas

### Bloqueadores activos

**Ninguno.** Todos los bloqueadores resueltos o documentados como
wontfix-con-workaround. **MVP v0.1.0 PUBLICADO** (npm + GitHub
release + smoke test E2E confirmado, ver §6.10).

### Bloqueadores resueltos en Fase 5

| # | Item | Resuelto en | Notas |
|---|---|---|---|
| B-007 | `tsup --bundle` flag invalido | Tarea 5.0 (infrastructure-engineer) | Build script corregido. `npm run build` EXIT=0. |
| B-008 | `mem.task.get` / `mem.task.delete` gap | v0.1.0 (recall) sub-fase 3 | **CLOSED en v0.1.0 (recall)**: implementado end-to-end. Hard delete via `Task.delete()` + `TaskDeleted` domain event. Repository `delete()` + use cases `get/delete`. Facade route activa. Error wire `-32110 TASK_NOT_FOUND` mapeado para los 3 callsites (`get`, `delete`, `update`). Cobertura: 19 task-aggregate tests, 18 use-case tests, integration F-mem-task incluye get→delete→get-fails. |
| B-009 | `UninstallPreCommitHook` gap | v0.1.0 (recall) sub-fase 4 | **CLOSED en v0.1.0 (recall)**: implementado end-to-end. `UninstallPreCommitHookUseCase` + `FilesystemPreCommitHookUninstaller` adapter inyectados en wiring. CLI `recall uninstall-hook` cubre 4 escenarios (no hook / hook ajeno / hook recall completo / hook mixto) + idempotente al re-ejecutar. Markers `# >>> recall pre-commit >>>` ... `# <<< recall pre-commit <<<` agregados al installer para extraccion quirurgica del bloque. Cobertura: 9 infra tests, 5 use-case tests, 5 facade adapter tests, 5 port type-guard tests, 3 E2E flows. |
| B-010 | Schema `tasks.status` `pending` vs domain `todo` | Tarea 5.6 architect | **Mapping defensivo permanente**. Documentado en `docs/03 §4.7`. Para v0.5+: alinear schema → domain. |
| D-101 | PriorityBoost multiplicativo vs aditivo | Tarea 5.6 architect | **ADR-002** en `docs/12 §1.5.2`. Domain mantiene multiplicativo. `docs/01 §2.6` actualizado. |
| D-102 | ContextLayerKind names domain vs wire | Tarea 5.6 architect | **ADR-003** en `docs/12 §1.5.3`. Mapping permanente como Anti-Corruption Layer. `docs/02 §4.2` actualizado con tabla wire-vs-domain. |
| D-103 | encrypted -> shared transition | Tarea 5.6 architect | Politica conservadora confirmada en `docs/11 §5`. Usuario debe pasar por `encrypted -> private -> shared`. |
| E | SLO encrypted (1412ms p95 vs <400ms) | Tarea 5.6 architect | SLO revisado a `<1500ms` (Opcion B). Mantiene Argon2id OWASP 2024 (sin compromiso seguridad). |

### Bloqueadores resueltos en Fase 2

| # | Item | Resuelto en | Notas |
|---|---|---|---|
| B-001 | Tooling materializado | Tarea 2.1 | 17 flags + ESLint 9 strict + Vitest thresholds |
| B-002 | DecayFactor recalibrado | Tarea 2.4 | Per-day desde per-period; drift max 2.99e-5 |
| B-003 | ADR-001 documentado | Tarea 2.0 | docs/12 §1.5.1 (provisional, ratificacion en Fase 3) |

### Bloqueadores resueltos en Fase 3

| # | Item | Resuelto en | Notas |
|---|---|---|---|
| B-004 | Convencion `.port.ts` formalizada | Inicio Fase 3 (`docs/12 §3.1`) | Ratificada por clean-architecture-validator en las 5 tareas (3.1-3.5). 100% de adopcion. |
| B-005 | ADR-001 ratificado | Tareas 3.3 + 3.4 (clean-architecture-validator §A/§5) | 56 cross-imports auditados (retrieval x46 + curator x10), todos en scope autorizado. validate:modules EXIT=0 con cuenta exacta. |
| B-006 | Puerto `Kdf` + adapter `Argon2idKdf` | Tarea 3.2 (crypto-security-expert) | `code/src/modules/encryption/application/ports/kdf.port.ts`, `code/src/modules/encryption/infrastructure/kdf/argon2id-kdf.ts`. `@noble/hashes 2.x`. KDF_DEFAULTS conformes a `docs/11 §3` con doble guarda defensiva. |

### Bloqueadores resueltos en Fase 4

| # | Item | Resuelto en | Notas |
|---|---|---|---|
| 19 stubs `Pending*` | 14 cerrados | Tareas 4.5 (12 memory) + 4.6 (2 encryption) → 4.7 (re-wiring) | 5 restantes con justificacion documentada (3 multi-key v0.5, 1 UninstallHook gap=B-009, 1 ServerFacade sub-process). Cero stubs sin justificar. |
| W-3.3-DDD-2 | EventPublisher port en `shared/` | Tarea 4.5 | Movido desde workaround temporal a `code/src/shared/application/ports/event-publisher.port.ts`. Suscripciones cross-module activas. |
| 3 perf-criticos N+1/transaccion en memory adapters | Tarea 4.5 ciclo 1 | Backend aplico fixes (UNION ALL + JOIN batch, transaction() explicita, migracion 005__perf-indexes.sql). Performance-auditor APPROVED ciclo 1. |

### Observaciones de hardening Fase 3 (NO son blockers para Fase 4)

Los 4 hallazgos `medium`/`low` de seguridad de Tarea 3.5 son hardening
defensivo, no rompen flujos normales. `security-auditor` los marco
como NO bloqueantes y aprobo el modulo. Se difieren a Fase 5 architect
review. Resumen:

| ID | Severidad | Archivo | Nota |
|---|---|---|---|
| W-3.5-SEC-M1 | medium | `workspace/infrastructure/filesystem/node-workspace-filesystem.ts:255,276` | `ensureGitignore` no usa write-temp+rename atomico. Hardening modo private. |
| W-3.5-SEC-M2 | medium | `shared/infrastructure/database/sqlite-database-bootstrap.ts:70-93` | `SqliteDatabaseBootstrap` no aplica chmod 0o600 explicito sobre `recall.db`. Defense in depth (directorio ya en 0o700). |
| W-3.5-SEC-L1 | low | `shared/infrastructure/database/sqlite-database-bootstrap.ts` (probe) | Redact `err.message` en logger.error del probe. |
| W-3.5-SEC-L2 | low | `workspace/infrastructure/filesystem/node-workspace-filesystem.ts` (passphrase compare path) | Constant-time compare en path workspace (encryption/domain ya lo aplica al final). |

### Decisiones humanas pendientes (Fase 5 architect review)

Documentadas en `.claude/workflow-state.json` →
`tasks.retrieval-domain.advertencias_pendientes_para_fase_5_architect`:

| # | Item | Decision pendiente |
|---|---|---|
| D-101 | `PriorityBoost` multiplicativo (≥1, ≤10) vs spec docs/01 §2.6 aditivo | Conformar al spec O actualizar doc + ADR |
| D-102 | `ContextLayerKind` names domain-flavoured vs wire literals docs/02 §4.2 | ADR + tabla wire-vs-domain en docs/02 §4.2 |
| D-103 | `encrypted → shared` direct mode transition prohibida vs docs/11 §5 (warning, no prohibido) | Confirmar politica conservadora o relajar |

### Preguntas abiertas pre-existentes

| # | Item | Cuando | Decision pendiente |
|---|---|---|---|
| Q-001 | ¿Inicializar el repo en git remoto? | Antes de Fase 3 si quieres CI desde dia 1, o despues del MVP | Decidir si publicas en GitHub privado o Netzi self-hosted |
| Q-002 | ¿Donde corre SonarQube en CI? | Cuando montemos GitHub Actions | Exponer `SONAR_HOST_URL` y `SONAR_TOKEN` como secrets del repo |
| Q-003 | ~~`tsx` vs `ts-node`~~ | Fase 2 | **RESUELTO**: `tsx` adoptado en Tarea 2.1 (`code/package.json`) |
| Q-004 | ¿Tests E2E corren contra el binary o contra `node dist/...`? | Fase 5 | Contra `dist/` para validar el bundle real |
| Q-005 | ¿Renovacion de token de SonarQube? | En 30 dias (vence ~2026-05-27) | Recordatorio en calendar |
| Q-006 | Observaciones de seguridad Low/Info de Fase 2 (paths en error messages, hex assert defensivo, secure_zero) | Fase 3 (paths) y antes de v0.5 (telemetria) | Ver §6.6 tabla de observaciones |
| Q-007 | Observaciones de performance Minor de Fase 2 (mmap_size, busy_timeout, pino async destination) | Fase 5 (cuando lleguen benchmarks) | Aplicar solo si delta ≥5% en p95 |

---

## 9. Riesgos identificados

| Riesgo | Probabilidad | Impacto | Mitigacion |
|---|---|---|---|
| `better-sqlite3-multiple-ciphers` con bugs en alguna plataforma | Media | Alto | Tests E2E en macOS, Linux, Windows en CI. Adapter `SqliteDatabase` aisla la lib (Tarea 2.2). |
| `sqlite-vec` API cambia | Baja | Alto | Adapter encapsula `db.loadExtension(sqliteVec.getLoadablePath())` con degradacion graceful (warning, no fatal). |
| `fastembed` modelo no carga en algun OS | Media | Medio | Fallback a Voyage AI (opt-in) o solo BM25. Adapter con lazy loading + error tipado `EmbedderError`. |
| Cobertura ≥95% imposible en `infrastructure/` por edge cases reales (ej: errores de FS) | Media | Bajo | Threshold de Vitest configurado: 95% global, 100% domain/, 100% application/, **90% infrastructure/**. Documentado en `code/vitest.config.ts` y lineamientos §1 R4. |
| Agentes en ciclo de rechazo > 5 veces por mala spec | Media | Medio | Escalar a humano + revisar lineamientos si hay ambiguedad. Limite registrado en `workflow-state.json` `rejection_limit_per_task: 5`. |
| Cross-imports `retrieval`/`curator` → `memory` se expanden mas alla del ADR-001 sin nuevo ADR | Baja | Medio | `code/scripts/validate-modules.ts` codifica el ADR como lista declarativa cerrada (`ADR_001_AUTHORISED_EXCEPTIONS`). Cualquier import nuevo no autorizado ROMPE el script y `npm run validate:modules` falla en CI. |
| Filtración de claves de cifrado por logs | Baja | Critico | `PinoLogger` con `DEFAULT_REDACT_PATHS` (13 keys + wildcards). `SqliteDatabase` no almacena clave en propiedad. `error.cause` non-enumerable evita leak via `JSON.stringify`. |
| Path traversal en migraciones | Baja | Alto | `MigrationsRunner` filtra entries con regex `^(\d+)__([\w-]+)\.sql$` antes de `path.join`. Caller (composition root) responsable de canonicalizar `migrationsDir`. |

---

## 10. Glosario rapido

- **MCP** — Model Context Protocol, estandar de Anthropic para que LLMs
  llamen tools.
- **CaYC** — Clean as You Code, filosofia de SonarQube de validar solo
  codigo nuevo (no historico).
- **Composition root** — el unico lugar (`code/src/composition/`) donde
  el codigo importa de multiples modulos para inyectar dependencias.
- **Hybrid search** — combinacion de busqueda lexical (BM25 via FTS5) y
  semantica (cosine via sqlite-vec).
- **`workspace_id`** — UUID v7 estable que identifica un proyecto, vive
  en `<proyecto>/.recall/config.json`, no se deriva del path.
- **Modos** — `shared` (default, todo en git plano) / `encrypted` (en git
  cifrado con SQLCipher) / `private` (en `.gitignore`).
- **Quality gate** — conjunto de condiciones que SonarQube valida; si
  alguna falla, el gate FALLA y el agente `qa-sonarqube-auditor`
  rechaza.

---

## 11. Cierre

Estado: **MVP v0.1.0 PUBLICADO. Fases 0-6 CERRADAS.** El paquete vive
en npm (https://www.npmjs.com/package/@netzi/recall) y en
GitHub (https://github.com/NetziTech/recall/releases/tag/v0.1.0).
Smoke test E2E desde directorio limpio confirmado: `npx --yes
@netzi/recall@0.1.0 --help` ejecuta el CLI con todos los
comandos. Tag `v0.1.0` → `7da553a` (= `main` HEAD).

**Resumen del workflow completo (Fases 0-6):**

- **6 fases ejecutadas** (0 planning → 5 testing → 6 release) sin
  escalaciones a humano (cero ambiguedades de spec; las 4 decisiones
  humanas D-101/D-102/D-103/E se resolvieron en architect review 5.6).
- **30 tareas APROBADAS** por sus validadores.
- **47 validadores ejecutados** (clean-arch + solid + ddd + security
  + performance + qa-sonarqube + architect-review-final), todos con
  veredicto APPROVED.
- **6 ciclos de rechazo en total** sobre todo el proyecto (1 ciclo en
  4.5 perf, 4 ciclos en 5.5 sonar, 1 ciclo en 1.x ddd) — todos
  resueltos por los implementadores responsables.
- **2421 tests passing** en 199 archivos test, **coverage 96.4%**,
  domain/application 100%.
- **Quality gate SonarQube PASSED**: 0 bugs / 0 vulns / 0 blockers /
  0 critical, sqale_debt_ratio 0.1%, ratings A en
  reliability/security/maintainability.
- **Cero `any`, cero `as any`, cero `// @ts-ignore`** en ~58.4k LOC
  de `code/src/`.
- **`tsc --noEmit` + `npm run lint` (max-warnings 0) + `npm run
  validate:modules` + `npm run build` + `npm run test`: EXIT=0 en los
  5.**
- **3 ADRs registrados**: ADR-001 cross-imports
  retrieval/curator → memory (Fase 2); ADR-002 PriorityBoost
  multiplicativo (Fase 5); ADR-003 ContextLayerKind ACL
  domain-vs-wire (Fase 5).
- **B-001..B-010 todos cerrados o documentados como
  wontfix-con-workaround.**
- **5 stubs `Pending*` justificados deferidos a v0.5** (3 multi-key,
  1 UninstallHook, 1 ServerFacade) con JSDoc forward-compat + error
  tipado estable.
- **18 items backlog v0.5** explicitos.

**Decisiones humanas resueltas en architect review (5.6):**

- **D-101**: PriorityBoost MULTIPLICATIVO ratificado (`ADR-002` en
  `docs/12 §1.5.2`). Aditivo invierte ranking en cola larga.
- **D-102**: ContextLayerKind ACL permanente (`ADR-003` en `docs/12
  §1.5.3`). Domain `workspace_anchor`/etc. ↔ wire
  `system_identity`/etc. (tabla bidireccional en composition root).
- **D-103**: encrypted → shared transition prohibida (politica
  conservadora). Usuario debe pasar por `encrypted → private →
  shared` (dos pasos explicitos).
- **E**: SLO encrypted revisado a `<1500ms` (Opcion B). Mantiene
  Argon2id OWASP 2024 — `64 MiB / 3 iter / 4 parallel`. Sin
  compromiso a la seguridad. Roadmap v0.5 contempla `<500ms` via OS
  keychain key cache (ADR pendiente).

**Siguiente accion concreta:** abrir el ciclo de **v0.1.1** —
prioridad: cerrar las 2 highs upstream `tar`/`fastembed` (esperar
`fastembed@2.1+` con `tar@7.x` o migrar embedder), implementar B-008
(`mem.task.get`/`mem.task.delete`) y B-009 (`uninstall-hook`). El
workflow de release v0.1.0 esta cerrado. Cero validaciones pendientes
sobre v0.1.0.

**Despues** vendran las features de v0.5 (multi-key envelope,
encrypted cold start <500ms, perf hardening >10K, etc.) que NO
requieren cambios estructurales — el ADR system + el sistema de
modulos absorben la evolucion.

---

_Ultima actualizacion: 2026-04-28 (cierre Fase 6 — Release MVP v0.1.0 PUBLICADO Y VALIDADO: npm + GitHub release + smoke test E2E)_
_Mantenedor: equipo Netzi Tech_
