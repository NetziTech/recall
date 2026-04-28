# 08 — Casos de uso

> Ejemplos concretos de como se ve usar el MCP en la practica. Cada caso
> incluye el flujo de tools y el efecto observable para el usuario.

---

## Caso 1: Inicializar proyecto nuevo (modo compartido)

**Situacion:** primer dia trabajando en Coder. No hay `.mcp-memoria/` aun.

### Flujo

**Usuario:**
```
> claude
> arrancamos con la fase 1 del proyecto Coder
```

**Claude:**
```
mem.init({})
→ {
    is_new: true,
    requires_mode_choice: true,
    workspace_path: "/Users/h2devx/proyects/coder"
  }
```

**Claude responde:**
```
Primera vez en este proyecto. ¿En que modo quieres inicializar la memoria?

  1) Compartido (default)
     - Toda la memoria se versiona en git (legible)
     - El equipo ve diffs en code review
     - Recomendado para: open-source, equipos abiertos

  2) Encriptado
     - Memoria en git, pero cifrada (requiere clave)
     - Recomendado para: equipos cerrados con info sensible

  3) Privado
     - Memoria local solo en tu maquina (.gitignore)
     - Recomendado para: notas personales

¿Cual eliges?
```

**Usuario:** "el 1, quiero compartirla con el equipo"

**Claude:**
```
mem.init({mode: "shared", display_name: "Coder", metadata: {language: "rust", phase: "1"}})
→ {
    workspace_id: "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89",
    mode: "shared",
    is_new: true,
    total_entries: 0
  }
```

**Claude responde:**
```
Memoria inicializada en .mcp-memoria/. Modo: compartido.
Cuando quieras versionarla, hace `git add .mcp-memoria/` y comitealo.

¿Por donde arrancamos la fase 1?
```

### Que paso

- Cero archivos de bootstrap manual.
- `.mcp-memoria/` creado con UUID estable que sobrevive renames del folder.
- Listo para acumular memoria desde el primer turno.

---

## Caso 2: Onboarding (segundo dia) — proyecto compartido

**Situacion:** segundo dia trabajando en Coder. Ayer registramos decisiones
y avanzamos en fase 1. Hoy abrimos Claude Code en el mismo folder.

### Flujo

**Usuario:**
```
> claude
> hola, sigamos con la fase 1
```

**Claude:**
```
mem.init({})
→ {
    workspace_id: "01952f3b...",
    is_new: false,
    total_entries: 247,
    mode: "shared"
  }

mem.context({query: "continuar fase 1"})
→ {
  bundle: {
    layers: [...],
    total_tokens: 4280
  }
}
```

**Claude responde:**
```
Bienvenido de vuelta. Estado segun memoria:

**Donde estamos:** fase 1 cerrada en lo principal. Ultimo commit fef1584:
  cleanup automatico de WindowSessions al destruir ventanas + boton X
  para quitar recientes rotos. 116/116 tests, cobertura 83.2%.

**Pendiente fase 1:**
- Setup vitest (low priority — quedo abierto)

**Pregunta abierta de la sesion anterior:**
- ¿Vitest setup va en fase 2 o lo postergamos?

¿Cerramos fase 1 con un PR a develop o seguimos validando?
```

### Que paso

- Cero archivos manuales leidos.
- Claude trajo contexto exacto de la sesion anterior.
- Tiempo total: ~250ms (2 calls al MCP).

---

## Caso 3: Onboarding al equipo — modo encrypted

**Situacion:** dev nuevo se une al equipo. El proyecto usa modo `encrypted`.

### Flujo

```bash
[dev2] $ git clone git@github.com:company/proyecto-cerrado.git
[dev2] $ cd proyecto-cerrado
[dev2] > claude
> ayudame a entender el proyecto

[Claude llama mem.init({})]
[MCP detecta .mcp-memoria/, lee config: mode=encrypted, workspace_id=abc-123]
[MCP busca ~/.config/mcp-memoria/keys/abc-123.key → no existe]
[MCP retorna -32107 ENCRYPTED_LOCKED]
```

**Claude responde:**
```
El workspace esta cifrado y aun no tienes la clave en tu maquina.

Pidele al team lead la clave de cifrado de este proyecto, y luego ejecuta
en otra terminal:

    mcp-memoria unlock --workspace .

Cuando este desbloqueado, vuelve aqui y seguimos.
```

**Usuario en otra terminal:**
```bash
$ mcp-memoria unlock --workspace .
> Pega la clave de cifrado: M3-ZK7L-Q4WV-8RTX-9YBN-2HCD-FGJM-1PSE-4ULA
✓ Workspace desbloqueado.
```

**Usuario vuelve a Claude:**
```
> ya, sigamos
```

**Claude:**
```
mem.init({})
→ {
    workspace_id: "abc-123...",
    is_new: false,
    total_entries: 423,
    mode: "encrypted",
    encryption_status: "unlocked"
  }

mem.context({query: "entender el proyecto"})
→ { bundle: {...} }
```

**Claude responde:**
```
Listo. Resumen del proyecto segun memoria del equipo:

[explicacion completa con decisions, learnings, code map]
```

### Que paso

- La clave queda en HOME. Sesiones siguientes no piden clave.
- El equipo tiene memoria comun, sin filtrar info al repo publico.
- Onboarding en 30 segundos vs leer 200 paginas de docs.

---

## Caso 4: Implementar feature nueva con context relevante

**Usuario:**
```
> implementa el editor con CodeMirror para fase 2
```

**Claude:**
```
mem.recall({
  query: "editor CodeMirror fase 2",
  top_k: 12,
  kinds: ["decision", "learning"]
})
→ {
  results: [
    { kind: "decision", content: "CodeMirror 6 elegido vs Monaco por liviandad y mejor performance Tauri", score: 0.94 },
    { kind: "decision", content: "Modulo `editor/` con domain/application/infrastructure", score: 0.87 },
    { kind: "learning", content: "En Tauri webview, plugins de CM pueden tener problemas con CSP, ajustar tauri.conf.json", score: 0.81 },
    { kind: "decision", content: "Validacion de zones (untouchable, critical) antes de escribir", score: 0.79 },
    ...
  ]
}

mem.search_entities({           // v0.5+, tambien funciona en MVP via mem.recall sobre kind=entity
  query: "editor",
  follow_relations: ["uses", "exposes"],
  max_depth: 2
})
→ { entities: [...], edges: [...] }
```

**Claude responde:**
```
Para empezar fase 2 con CodeMirror, segun decisiones registradas:

1. Crear modulo `editor/` siguiendo patron DDD/Hexagonal
   (domain/application/infrastructure) — decision de fase 0.

2. Frontend: CodeMirror 6 con `@codemirror/lang-rust` y resto de
   lenguajes. Cuidado con CSP de Tauri (registramos esa leccion al
   investigar fase 0).

3. Antes de escribir un archivo, consultar zones del project_config.

Plan de tareas:
[ ] EditorPort trait (read_file, write_file, list_directory, watch)
[ ] FilesystemAdapter como impl
[ ] Tab atom + organism EditorPanel
[ ] CodeMirror integration con HMR
[ ] Tests del modulo

¿Arrancamos por el backend (ports + filesystem adapter) o el frontend
(scaffold de tabs + CM)?
```

### Que paso

Claude no leyo `arquitectura.md` ni `CLAUDE.md`. La memoria le dio:
- Las decisiones tecnicas relevantes.
- Una leccion no-obvia (CSP en Tauri).
- El mapa de codigo del modulo.

---

## Caso 5: Debug con pista de session anterior

**Usuario:**
```
> el test de cleanup falla intermitentemente
```

**Claude:**
```
mem.recall({
  query: "test cleanup intermitente window sessions",
  top_k: 6
})
→ {
  results: [
    {
      kind: "learning",
      content: "WindowSessions::remove no es thread-safe sin mutex; en
                tests con tokio multi-thread puede haber race",
      severity: "warning",
      tags: ["concurrency", "testing"],
      score: 0.91
    },
    {
      kind: "turn",
      content: "Bug encontrado: cleanup no se llamaba en window destroy.
                Fix: register_cleanup_on_destroy con on_window_event",
      created_at: "2026-04-17"
    },
    ...
  ]
}
```

**Claude:**
```
Ya hay una leccion registrada que aplica directo:

> WindowSessions::remove no es thread-safe sin mutex; en tests con tokio
> multi-thread puede haber race [warning]

El test probablemente usa `#[tokio::test(flavor = "multi_thread")]`.
Como el cleanup en produccion se hace via `on_window_event` (que corre
en el thread de Tauri), no choca, pero los tests si pueden chocar.

Te muestro los dos paths:
1. Cambiar el test a `single_thread` flavor.
2. Agregar Mutex a WindowSessions (verifico el test antes).

¿Cual prefieres que indague?
```

### Que paso

Sin memoria, Claude habria gastado 3-5 turnos investigando. Con la
leccion previa, va directo al diagnostico probable.

---

## Caso 6: Decision arquitectonica con archivo historico

**Usuario:**
```
> ¿por que no usamos Electron?
```

**Claude:**
```
mem.recall({
  kinds: ["decision"],
  query: "electron vs tauri",
  include_superseded: false
})
→ {
  results: [
    {
      kind: "decision",
      content: "Tauri v2 sobre Electron",
      metadata: {
        title: "Tauri v2 elegido sobre Electron",
        rationale: "Liviano (~15MB vs 150+MB), performance, IP, stack Rust coherente",
        alternatives_rejected: ["Electron", "Neutralino", "Wails"]
      },
      created_at: "2026-04-12"
    }
  ]
}
```

**Claude:**
```
Decision registrada el 12 abr 2026:

**Tauri v2 sobre Electron**

Razones:
- Liviano (binario nativo ~15 MB vs 150+ MB de Electron)
- Mejor performance (sin Chromium overhead)
- Proteccion IP (binario compilado vs JS legible)
- Stack Rust coherente con el backend

Alternativas descartadas: Electron, Neutralino, Wails.

¿Quieres revisitarla? Si hay nueva info, podemos marcarla como
`superseded_by` con la nueva decision.
```

---

## Caso 7: Cambiar de modo a mitad de proyecto

**Situacion:** proyecto arranco como `private`. El equipo crece y quieren
compartir la memoria.

```bash
$ mcp-memoria mode shared --workspace .
> Cambiando modo: private → shared
> Quitando .mcp-memoria/ del .gitignore raiz
> ⚠ La historia de git no tiene este folder. Cuando hagas el primer commit,
   todos los devs tendran tu memoria al hacer pull.
> ✓ Modo cambiado.

$ git add .mcp-memoria/
$ git commit -m "chore: compartir memoria del proyecto"
$ git push
```

Otros devs hacen pull y ya tienen toda la memoria.

---

## Caso 8: Cierre de fase con HANDOFF auto-generado

**Usuario:**
```
> cierra fase 1 y prepara handoff
```

**Claude (v0.5+):**
```
mem.task({action: "list", filter: {status: "any"}})
→ ...

mem.recall({
  kinds: ["decision", "turn"],
  order_by: "recency",
  top_k: 20
})
→ ...

mem.export_handoff({
  format: "markdown",
  include: ["summary", "decisions", "tasks", "learnings", "open_questions"]
})
→ {
  format: "markdown",
  content: "# HANDOFF — Fase 1\n\n## 1. Estado...\n..."
}
```

**Claude:**
```
HANDOFF generado a partir de la memoria:

[muestra el markdown]

¿Lo escribo a `HANDOFF.md` o lo agregamos como apendice del existente?
```

---

## Caso 9: Curador detecta consolidacion

**Despues de muchos turnos:**

```
[background] mem.curator_run

  → consolidaciones detectadas: 3
     - learning_a3f ("siempre canonicalizar paths") + learning_b9e
       ("paths de tempfile son canonicalizados") → fusionados en a3f
     - learning_c12 ("usar #[tokio::test]") + learning_d45
       ("tokio test single thread por default") → fusionados
     - turn_xyz + turn_abc (resumen redundante) → fusionados
  → decay aplicado a 1240 entries
  → 0 conflictos detectados
  → 5 paths stale marcados (carpetas borradas)
```

**Sesion siguiente:**

Recall ahora devuelve resultados mas concisos sin perdida de informacion.
El usuario puede ver el log via:

```bash
mcp-memoria curator-log --workspace . --last 5
```

---

## Caso 10: Onboarding desde HANDOFF.md existente

**Usuario tiene un proyecto con HANDOFF.md grande, quiere migrarlo:**

```bash
$ mcp-memoria import-handoff \
    --workspace . \
    --handoff HANDOFF.md \
    --claude-md CLAUDE.md \
    --mode shared

> Inicializando .mcp-memoria/ en modo shared...
> Parseando HANDOFF.md...
>   - Detectadas 23 decisions en seccion "Decisiones tecnicas"
>   - Detectadas 47 learnings en seccion "Lecciones aprendidas"
>   - Detectadas 12 tasks abiertas
>   - Detectadas 5 preguntas abiertas
> Parseando CLAUDE.md...
>   - Detectadas 8 reglas → mapeadas a decisions con scope=project
> Generando embeddings (37 entries)... 12s
> ✓ Imports completos. 87 entries con tag `imported_from_handoff`.
> Revisa entries con tag `needs_review` (12 detectadas con baja confianza).
```

A partir de ahi, todo funciona como si la memoria hubiera estado desde el
inicio.

---

## Caso 11: Privacy / forget

**Usuario:**
```
> olvida todo lo que aprendiste sobre el proyecto X (que era confidencial)
```

**Claude (v0.5+):**
```
mem.forget({
  query: "*"
})
→ {
  candidates: [
    { id: "...", kind: "decision", preview: "..." },
    ...
  ],
  total: 247
}
```

**Claude:**
```
Encontre 247 entries en este workspace. ¿Borrar todas?

(Alternativa: si quieres borrar TODO el workspace, ejecuta
`mcp-memoria wipe --workspace . --confirm` desde otra terminal.)
```

**Usuario:** "si"

**Claude:**
```
mem.forget({
  confirm_ids: [...todos...]
})
→ { deleted_count: 247 }
```

**Claude:**
```
247 entries borradas permanentemente. La memoria del workspace queda
vacia (config.json y schema preservados).
```

---

## Caso 12: Audit antes de hacer push publico

**Situacion:** repo privado va a hacerse publico. Antes de push, audit.

```bash
$ mcp-memoria audit --workspace . --check-secrets --strict

Auditando .mcp-memoria/memoria.db...
  Total entries escaneadas: 423
  - Patrones AWS: 0
  - JWT: 0
  - GitHub tokens: 0
  - Generic API keys: 0
  - Passwords en URLs: 0
  - High entropy strings: 2 sospechosos

Hallazgos:
  [warning] entry abc123 (decision)
    Tipo: high entropy
    Detalle: "...usar token TOK_3vF9k... en config..."
    Sugerencia: revisar manualmente

  [warning] entry def456 (learning)
    Tipo: high entropy
    Detalle: "...api key xyz1234567890abcdef en .env..."
    Sugerencia: revisar manualmente

Total: 2 warnings.
Exit code: 1 (--strict)
```

**Usuario:**
```bash
$ mcp-memoria sanitize --workspace . --entry-id abc123
> Reemplazando contenido de abc123 por [REDACTED]...
> Regenerando embedding...
> ✓ Sanitizado.

$ mcp-memoria sanitize --workspace . --entry-id def456
> ...

$ mcp-memoria audit --workspace . --check-secrets --strict
> ✓ 0 hallazgos. OK para push.
```

---

## Caso 13: Resolver pregunta abierta

**Sesion 1 (martes):**
```
mem.session_force({
  action: "end",
  summary: "...",
  open_questions: [
    "¿Vitest setup va en fase 2 o postergamos?"
  ]
})
```

(O via auto-rollup despues de 30 min idle.)

**Sesion 5 (viernes):**

**Usuario:** "decidamos lo de vitest. Lo metemos en fase 2."

**Claude:**
```
mem.remember({
  kind: "decision",
  title: "Vitest setup incluido en fase 2",
  content: "Vitest setup incluido en fase 2",
  rationale: "Fase 2 introduce CodeMirror que necesita testing del frontend.
              Posponer mas crearia deuda. Decision tomada en sesion del 21 abril.",
  scope: "project",
  tags: ["testing", "vitest", "fase-2", "answers:q-vitest-001"]
})
```

**Claude:**
```
Decision registrada y vinculada a la pregunta abierta del martes.
La pregunta queda resuelta.
```

### Que paso

Las preguntas abiertas no se pierden entre sesiones, y cuando se
responden, la memoria lo registra explicitamente.

---

## 14. Patrones que NO son casos de uso del MCP

Cosas que el MCP NO debe hacer (pero parecen tentadoras):

- **Recordar conversaciones literales.** Solo turnos resumidos.
- **Indexar codigo fuente.** Eso es Code Intelligence (otro modulo).
- **Generar resumenes con LLM al pasar el turno.** Solo si el cliente
  manda summary; el MCP no llama a Claude.
- **Auto-aplicar lecciones al codigo.** El MCP es lectura/escritura de
  memoria, no agente.
- **Reemplazar Git history.** Git tiene la verdad del codigo; memoria
  tiene el "por que".
- **Aplicar reglas globales del usuario.** Eso es `~/.claude/CLAUDE.md`,
  no el MCP.

---

## 15. Anti-patrones del usuario

Cosas que el usuario podria hacer y que el MCP debe rechazar/avisar:

- Registrar 100 learnings irrelevantes en una sesion → el MCP avisa
  cuando detecta tasa anormalmente alta.
- Dejar 50 tasks `in_progress` sin cerrar → `mem.task({action: "list"})`
  muestra warning.
- Pegar un secret en `mem.remember` → secret detection lo rechaza.
- Inicializar en modo `shared` con info sensible → audit y/o cambio a
  `encrypted`.
- Apuntar al mismo workspace_path desde dos paths distintos
  (`/Users/x/proj` y `/Users/x/proj/`) → canonicalizacion los une.
- Committear `.mcp-memoria/` cuando el modo es `private` → pre-commit hook
  lo bloquea.
