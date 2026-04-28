# 13 — Workflow de agentes

> Como se construye este proyecto: agentes especialistas implementan,
> agentes validadores auditan, ciclo hasta aprobacion total.

---

## 1. Filosofia

- **Especializacion fina:** cada agente es experto en UNA cosa.
- **Validacion cruzada:** los validadores son distintos a los
  implementadores. Nadie audita su propio trabajo.
- **Veredictos binarios:** APROBADO o RECHAZADO. Sin grises.
- **Rechazo accionable:** cada rechazo dice archivo + linea + cambio
  concreto. No "esto esta mal" sin detalles.
- **Ciclo hasta perfeccion:** no se cierra una fase hasta que todos los
  validadores aplicables aprueben.

---

## 2. Los 13 agentes

### 2.1 Coordinacion (1)

#### `mcp-orchestrator`
Coordina el ciclo completo: planifica, asigna trabajo a especialistas, lanza
validadores, gestiona rechazos, decide cuando avanzar de fase. Mantiene el
estado del workflow en `.claude/workflow-state.json`.

### 2.2 Implementacion — especialistas (6)

#### `domain-architect`
**Responsable de:** diseñar e implementar TODO el dominio DDD de cada modulo.

**Que produce:**
- `domain/entities/*.ts`
- `domain/value-objects/*.ts`
- `domain/aggregates/*.ts`
- `domain/repositories/*.ts` (interfaces)
- `domain/services/*.ts`
- `domain/events/*.ts`

**Que NO toca:** application, infrastructure, composition.

**Reglas estrictas:**
- Cero imports externos en `domain/`. Solo de `shared/domain/` (mismo nivel).
- Value objects validan invariantes en constructor.
- Agregados garantizan invariantes en cada mutacion.
- Lenguaje del negocio en cada nombre.

#### `mcp-protocol-expert`
**Responsable de:** modulo `mcp-server`. Implementa el protocolo MCP, los
handlers JSON-RPC, validacion Zod de inputs/outputs, errores con codigos
estandarizados.

**Que produce:**
- `modules/mcp-server/domain/`, `application/`, `infrastructure/`
- Handlers para `mem.init`, `mem.context`, `mem.recall`, `mem.remember`,
  `mem.task`, `mem.health` (MVP).
- Schemas Zod en `application/dtos/`.

**Conocimiento profundo:** spec del MCP protocol, JSON-RPC 2.0,
`@modelcontextprotocol/sdk`, capacidades.

#### `crypto-security-expert`
**Responsable de:** modulos `encryption` y `secrets`.

**Que produce:**
- `modules/encryption/`: KDF wiring (argon2id), key validator blob,
  envelopes, unlock flow.
- `modules/secrets/`: 5 capas de deteccion (patrones, entropy, paths,
  pre-commit hook, audit).
- `shared/infrastructure/crypto/argon2id-kdf.ts`,
  `shared/infrastructure/crypto/sqlcipher-driver.ts`.

**Conocimiento profundo:** SQLCipher, argon2id (parametros seguros),
@noble/hashes, Shannon entropy, OWASP cryptographic storage cheat sheet.

#### `retrieval-expert`
**Responsable de:** modulo `retrieval`.

**Que produce:**
- Hybrid search (BM25 via FTS5 + cosine via sqlite-vec + re-ranking).
- Bundle de las 7 capas (`mem.context`).
- Token counter con tiktoken.
- Worker async de embeddings (`embedding_queue` consumer).

**Conocimiento profundo:** FTS5, sqlite-vec, fastembed-js, BM25 scoring,
cosine similarity, RRF (reciprocal rank fusion), tiktoken.

#### `curator-expert`
**Responsable de:** modulo `curator`.

**Que produce:**
- Decay diferencial por kind.
- Consolidacion semantica (cosine > 0.92, mergePair).
- Pruning + tabla `pruned`.
- Self-healing (path stale, decision conflicts, embedding drift,
  open-question aging).
- Sesion-rollup automatico (30 min idle).

**Conocimiento profundo:** algoritmos de decay, fusion semantica,
detection de conflictos.

#### `infrastructure-engineer`
**Responsable de:** lo demas: modulo `workspace`, modulo `cli`, composition
root, setup de tests, config de DB connection, migrations runner, logger.

**Que produce:**
- `modules/workspace/` completo.
- `modules/cli/` (comandos `unlock`, `mode`, `audit`, `sanitize`,
  `import-handoff`, etc.).
- `composition/server.ts`, `composition/cli.ts`,
  `composition/container.ts`.
- `shared/infrastructure/persistence/sqlite-database.ts`,
  `migration-runner.ts`.
- `shared/infrastructure/logger/`, `time/`, `id/`.
- Setup de Vitest y configuracion de tsconfig estricto.

**Conocimiento profundo:** better-sqlite3-multiple-ciphers, migrations
patterns, dependency injection manual (sin framework), Pino, uuid v7.

### 2.3 Validadores (6)

#### `clean-architecture-validator`
**Valida:**
- Cada modulo tiene la estructura `domain/` + `application/` +
  `infrastructure/`.
- `domain/` no importa de `application/` ni `infrastructure/`.
- `application/` no importa de `infrastructure/`.
- Modulos no se importan entre si (excepto `shared/`).
- Composition root es el unico que importa de multiples modulos.
- Hexagonal: cada adaptador implementa una interface declarada en
  domain o application.

**Como valida:** corre `scripts/validate-modules.ts` (analisis estatico de
imports con AST de TypeScript) + revision manual de estructura.

**Veredicto:** `APPROVED` o `REJECTED` con lista de violaciones (file:line +
import indebido).

#### `ddd-validator`
**Valida:**
- Entidades tienen identidad (`id`) y comportamiento; mutaciones via
  metodos con nombres del negocio.
- Value objects son inmutables (`readonly` props), validan en constructor,
  igualdad por valor (metodo `equals()`).
- Agregados tienen una raiz que controla acceso; las entidades internas no
  se exponen directamente.
- Repositorios trabajan con agregados completos (no DTOs internos).
- Lenguaje: cada nombre refleja el dominio. Sin "Item", "Record", "Data"
  genericos.
- Eventos de dominio son inmutables y describen un hecho pasado en past
  tense.

**Como valida:** revision de cada archivo en `domain/`, AST analysis de
mutadores publicos en entidades, lectura semantica de nombres.

#### `solid-validator`
**Valida ambas cosas:**

**SOLID:**
- SRP: clases con una sola razon de cambio. Heuristica: si una clase tiene
  > 7 metodos publicos no relacionados, sospechar.
- OCP: nuevas variantes via extension, no via `if/switch` sobre kind en
  clase central.
- LSP: subtipos no tiran exceptions que el padre no tira.
- ISP: interfaces pequenas. Si una interface tiene > 5 metodos, considerar
  segmentacion.
- DIP: use cases reciben puertos por constructor; nunca instancian
  adaptadores con `new`.

**Type-safety:**
- `tsconfig.json` con todas las flags estrictas (ver `12-lineamientos.md`
  §1.6).
- Cero `any` (busca con grep `: any`, `as any`, `<any>`).
- Cero `// @ts-ignore`, `// @ts-nocheck`.
- `// @ts-expect-error` solo con razon documentada.
- Funciones con tipo de retorno explicito.
- Validacion Zod en boundaries.
- Discriminated unions para variantes.

**Como valida:** corre `tsc --noEmit`, ESLint con reglas estrictas, grep
de patrones prohibidos.

#### `security-auditor`
**Valida:**
- OWASP Top 10:
  - A01 Broken Access Control: paths canonicalizados, sin path traversal.
  - A02 Cryptographic Failures: argon2id con parametros minimos correctos
    (memory >= 64 MiB, iter >= 3, parallelism >= 4); AES-256 via
    SQLCipher; nonce/IV generados con CSPRNG.
  - A03 Injection: prepared statements en TODO SQL. Buscar
    template strings con interpolacion en queries.
  - A04 Insecure Design: revisar puntos de seguridad arquitectonicos.
  - A05 Security Misconfiguration: PRAGMA WAL, foreign_keys, secure
    defaults.
  - A07 Identification and Authentication Failures: gestion de claves
    correcta (no claves en logs, permisos 0600).
  - A08 Software and Data Integrity: validacion de integridad de claves
    (key validator blob), validacion de schema migrations.
  - A09 Security Logging Failures: audit_log presente, no logueamos
    secretos.
  - A10 SSRF: si en algun momento Voyage AI, validar URL.
- Detector de secretos en `shared/infrastructure/secrets/` con patrones
  conocidos + entropy.
- Permisos `0600` en `~/.config/mcp-memoria/keys/`.
- Path sanitizer aplicado en todos los inputs.
- No hay credenciales hardcoded.

**Como valida:** revision manual de codigo critico de seguridad +
herramientas (semgrep si esta disponible) + Bash para verificar permisos.

#### `performance-auditor`
**Valida:**
- Cada query frecuente tiene indice apropiado (revisa migrations).
- Embeddings async (no bloquean writes).
- WAL mode activado.
- Latencias targets cumplidas (corre benchmarks):
  - `mem.recall`: < 100ms p95 con 50K entries.
  - `mem.context`: < 200ms p95.
  - `mem.remember`: < 30ms p95 (excluye embedding async).
  - Cold start: < 200ms.
  - Cold start encrypted: < 400ms.
- No queries N+1 (busca patrones de `.findById` dentro de loops).
- Batch operations en INSERT masivos.
- Streaming de FTS5 results cuando posible.

**Como valida:** revision de queries + corre `tests/benchmarks/` + analiza
plan de queries con `EXPLAIN QUERY PLAN`.

#### `qa-sonarqube-auditor`
**Valida:**
- Cobertura de Vitest:
  - Global: ≥95%.
  - `domain/`: 100%.
  - `application/`: 100%.
  - `infrastructure/`: ≥90%.
- Tests cubren los casos felices, edge cases, y errores.
- Tests de integracion por modulo con DB real.
- Tests E2E cubriendo los flows criticos (init shared, init encrypted,
  recall, remember, unlock).
- SonarQube quality gate **green**:
  - Reliability: A
  - Security: A
  - Maintainability: A
  - Coverage ≥ 95%
  - Duplications < 3%
  - Code smells: 0 blocker, 0 critical
  - Technical debt ratio < 5%

**Como valida:** corre `vitest run --coverage`, sube a SonarQube,
verifica el reporte. Si SonarQube no esta disponible localmente, usa
`sonar-scanner` en CI.

---

## 3. Workflow completo

```
┌──────────────────────────────────────────────────────────────────┐
│ FASE 0 — PLANNING                                                │
│  1. mcp-orchestrator lee docs/ y entiende scope                  │
│  2. Define plan: que modulos, en que orden, dependencias         │
│  3. Crea workflow-state.json                                     │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ FASE 1 — DOMAIN MODELING                                         │
│  domain-architect:                                               │
│    Implementa shared/domain/ + modules/*/domain/                 │
│    Output: codigo en domain/ de cada modulo                      │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼  validadores aplicables: ddd-validator, solid-validator
┌──────────────────────────────────────────────────────────────────┐
│ FASE 2 — INFRASTRUCTURE COMUN                                    │
│  infrastructure-engineer:                                        │
│    Implementa shared/infrastructure/                             │
│    sqlite-database, kdf, embedder, logger, clock, id-gen         │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼  validadores: clean-arch, solid, security, performance
┌──────────────────────────────────────────────────────────────────┐
│ FASE 3 — MODULOS EN PARALELO (cada experto su area)              │
│  En paralelo:                                                    │
│    - mcp-protocol-expert      → mcp-server                       │
│    - crypto-security-expert   → encryption + secrets             │
│    - retrieval-expert         → retrieval                        │
│    - curator-expert           → curator                          │
│    - infrastructure-engineer  → workspace + cli                  │
│  Cada uno implementa application/ + infrastructure/ de su modulo │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼  validadores: clean-arch, ddd, solid, security, perf
┌──────────────────────────────────────────────────────────────────┐
│ FASE 4 — COMPOSITION ROOT                                        │
│  infrastructure-engineer:                                        │
│    Implementa composition/                                       │
│    Inyecta todo, registra tools, expone server.ts y cli.ts       │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼  validadores: clean-arch, solid
┌──────────────────────────────────────────────────────────────────┐
│ FASE 5 — TESTING                                                 │
│  Cada experto escribe tests de SU modulo:                        │
│    - Unit (sin DB)                                               │
│    - Integration (con DB real)                                   │
│  infrastructure-engineer escribe E2E.                            │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼  validador: qa-sonarqube-auditor
┌──────────────────────────────────────────────────────────────────┐
│ FASE 6 — VALIDACION FINAL                                        │
│  Todos los validadores corren en orden:                          │
│    1. clean-architecture-validator                               │
│    2. ddd-validator                                              │
│    3. solid-validator                                            │
│    4. security-auditor                                           │
│    5. performance-auditor                                        │
│    6. qa-sonarqube-auditor                                       │
│  Si TODOS aprueban → DONE.                                       │
│  Si alguno rechaza → vuelve al implementador correspondiente,    │
│  ciclo hasta aprobacion.                                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Comunicacion entre agentes

### 4.1 Estado del workflow

`<repo>/.claude/workflow-state.json`:

```json
{
  "version": "1.0",
  "started_at_ms": 1745000000000,
  "current_phase": "phase-3-modules",
  "phases": {
    "phase-0-planning": { "status": "done", "ended_at_ms": ... },
    "phase-1-domain":   { "status": "done", "ended_at_ms": ... },
    "phase-2-shared-infra": { "status": "done", "ended_at_ms": ... },
    "phase-3-modules":  {
      "status": "in_progress",
      "tasks": {
        "mcp-server":     { "agent": "mcp-protocol-expert",      "status": "in_progress" },
        "encryption":     { "agent": "crypto-security-expert",   "status": "validating" },
        "secrets":        { "agent": "crypto-security-expert",   "status": "done" },
        "retrieval":      { "agent": "retrieval-expert",         "status": "rejected", "rejection_count": 1 },
        "curator":        { "agent": "curator-expert",           "status": "pending" },
        "workspace":      { "agent": "infrastructure-engineer",  "status": "in_progress" },
        "cli":            { "agent": "infrastructure-engineer",  "status": "pending" }
      }
    }
  }
}
```

### 4.2 Veredictos de validacion

Cada validador escribe en `.claude/validations/<phase>-<validator>.json`:

```json
{
  "validator": "clean-architecture-validator",
  "phase": "phase-3-modules",
  "validated_at_ms": 1745020000000,
  "verdict": "REJECTED",
  "violations": [
    {
      "severity": "error",
      "file": "src/modules/memory/application/use-cases/recall.ts",
      "line": 12,
      "rule": "modular-isolation",
      "detail": "Importa de '../../../workspace/domain/aggregates/workspace.ts'. Si necesita esa funcionalidad, mover a shared/.",
      "suggested_fix": "Mover WorkspaceConfig a shared/domain/value-objects/ o crear un puerto en application/ports/out/."
    }
  ]
}
```

### 4.3 Ciclo de rechazo

Cuando un validador rechaza:

1. El validador escribe el reporte JSON detallado.
2. `mcp-orchestrator` lo lee.
3. Identifica al implementador responsable (segun el modulo afectado).
4. Le asigna la tarea de corregir, pasandole el reporte completo.
5. El implementador corrige.
6. Vuelve al validador.
7. Si pasa → siguiente validador.
8. Si rechaza otra vez → ciclo. Limite: 5 ciclos por tarea, despues
   escalar al usuario.

---

## 5. Reglas de los validadores

### 5.1 Independencia
- Un validador NUNCA escribe codigo de produccion. Solo audita.
- Un validador puede sugerir el fix, pero el implementador es quien lo
  aplica.

### 5.2 Especificidad
- Cada rechazo apunta a archivo + linea + cambio concreto.
- "Esto esta mal" sin detalles → el orquestador rechaza el reporte y le
  pide al validador que sea especifico.

### 5.3 Falsa positivos
- Si el implementador cree que el rechazo es falso positivo, escribe en
  `.claude/disputes/<task>.md` con la razon. El orquestador escala al
  validador. Si el validador acepta, retira el rechazo. Si no, el
  orquestador puede pedir excepcion documentada.

---

## 6. Configuracion en `.claude/agents/`

Cada agente vive en `<repo>/.claude/agents/<name>.md` con el formato
estandar de Claude Code. Cada uno tiene:

- `name`
- `description` (cuando invocarlo)
- `tools` (que tools puede usar)
- System prompt detallado con sus responsabilidades, reglas, y heuristicas

Los archivos estan en este repo. Lista:

```
.claude/agents/
├── mcp-orchestrator.md
├── domain-architect.md
├── mcp-protocol-expert.md
├── crypto-security-expert.md
├── retrieval-expert.md
├── curator-expert.md
├── infrastructure-engineer.md
├── clean-architecture-validator.md
├── ddd-validator.md
├── solid-validator.md
├── security-auditor.md
├── performance-auditor.md
└── qa-sonarqube-auditor.md
```

---

## 7. Quality gate de SonarQube

`code/sonar-project.properties`:

```properties
sonar.projectKey=mcp-memoria-inteligente
sonar.projectName=MCP Memoria Inteligente
sonar.projectVersion=0.1.0

sonar.sources=src
sonar.tests=tests
sonar.exclusions=**/*.spec.ts,**/migrations/**,dist/**,node_modules/**
sonar.test.inclusions=**/*.spec.ts,**/*.integration.spec.ts,**/*.e2e.spec.ts

sonar.typescript.tsconfigPath=tsconfig.json
sonar.javascript.lcov.reportPaths=coverage/lcov.info

# Quality gate strict
sonar.qualitygate.wait=true
```

**Quality gate (definido en SonarQube server):**
- Coverage on new code: ≥ 95%
- Coverage on overall code: ≥ 95%
- Duplicated lines (%): ≤ 3.0
- Maintainability rating: A
- Reliability rating: A
- Security rating: A
- Security review rating: A
- Bugs: 0
- Vulnerabilities: 0
- Code smells (blocker): 0
- Code smells (critical): 0
- Technical debt ratio: ≤ 5%

Si el quality gate no pasa, `qa-sonarqube-auditor` rechaza.

---

## 8. Setup de SonarQube (local o cloud)

### Opcion A: Docker local

```bash
docker run -d --name sonarqube -p 9000:9000 sonarqube:lts-community
# Esperar ~30s, abrir http://localhost:9000 (admin/admin), cambiar pass
```

### Opcion B: SonarCloud (gratis para repos publicos)

1. Crear cuenta en sonarcloud.io
2. Conectar el repo
3. Tomar el token y guardarlo en `SONAR_TOKEN` env var (CI)

### Correr el scanner

```bash
cd code
npm run test:coverage     # genera coverage/lcov.info
sonar-scanner             # lee sonar-project.properties y sube reporte
```

---

## 9. Limites del workflow

- **Maximo 5 ciclos** de rechazo-correccion por tarea. Despues, escala al
  usuario humano.
- **Validadores son agentes Claude**, no procesos automatizados. Pueden
  tener falsos positivos. El proceso de disputa los maneja.
- **Tests son obligatorios.** Sin tests, qa-sonarqube-auditor rechaza
  automaticamente.
- **Una tarea no puede estar > 24h en `in_progress`** sin update; si
  pasa, se reasigna.

---

## 10. Cuando NO usar este workflow

- Hotfix critico de produccion: ir directo al implementador relevante
  + security-auditor + qa-sonarqube-auditor.
- Cambio puramente de docs: no requiere workflow.
- Refactor sin cambio de comportamiento: solo
  clean-architecture-validator + qa-sonarqube-auditor.

Para todo el resto: workflow completo.
