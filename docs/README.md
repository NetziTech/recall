# MCP Memoria Inteligente — Documentacion del proyecto

> Servidor MCP (Model Context Protocol) que da a Claude Code memoria persistente,
> selectiva y auto-curada **por proyecto**, viviendo dentro del propio proyecto.

---

## 0. Resumen ejecutivo

**Que es.** Un servidor MCP standalone (single binary / `npx -y recall`) que
Claude Code conecta para tener memoria estructurada, persistente y consultable
sobre cualquier proyecto en el que trabaje el usuario. La memoria vive **dentro
del proyecto** (`<proyecto>/.recall/`) — viaja con el codigo cuando lo
clonas, lo mueves o lo compartes.

**Que problema resuelve.**

1. **Context rot inter-sesion.** Cada sesion arranca limpia. Hoy se transmite
   via `CLAUDE.md` y `HANDOFF.md` manuales que crecen sin control y se
   desactualizan.
2. **Context rot intra-sesion.** En conversaciones largas la atencion del
   modelo se diluye. Lo importante se pierde entre lo que importaba hace 50
   turnos.
3. **Memoria fragmentada.** Decisiones, lecciones, patrones quedan esparcidos
   en commits, PRs, slack, notas. Nada indexado para recuperacion semantica.
4. **Sin self-healing.** Si el modelo olvida una restriccion del proyecto,
   nadie se la recuerda automaticamente.
5. **Sin compartir.** La memoria del proyecto vive en la cabeza de un dev. No
   se transfiere al equipo ni a otra maquina cuando clonas el repo.

**Filosofia.**

- **Memoria-en-proyecto.** `.recall/` vive dentro del repo, junto al
  codigo. Como `.git/`, viaja con el proyecto.
- **3 modos de privacidad.** Compartido (default, todo en git plano),
  encriptado (en git pero cifrado con SQLCipher), o privado (en `.gitignore`).
- **Recuperacion selectiva, no dump.** Cada turno el MCP devuelve las N piezas
  mas relevantes; no toda la historia.
- **Auto-curacion.** El MCP decide que recordar, que olvidar (decay) y que
  consolidar sin intervencion del usuario.
- **Standalone.** No depende de IDE; funciona con cualquier cliente MCP
  (Claude Code, Cursor, Cline, etc.).
- **Single source of truth.** Toda la memoria de un proyecto vive en un solo
  folder dentro del proyecto. Lo que vive en HOME es solo cache (modelo
  embedder), borrable sin perdida.

**Que NO es.**

- No reemplaza Git. No versiona codigo.
- No es un cache de respuestas LLM. No guarda turnos enteros.
- No es un sistema de tickets. No asigna ni rastrea trabajo formal.
- No es un knowledge base manual estilo Obsidian. Indexa lo que existe; no
  reemplaza la documentacion humana.

---

## 1. Por que un MCP y no un script o un archivo

| Opcion | Pros | Contras |
|---|---|---|
| Script bash al inicio de sesion | Simple | Dump completo, sin recuperacion selectiva |
| `CLAUDE.md` + `HANDOFF.md` | Funciona hoy | Manual, crece, se desactualiza, no se comparte automaticamente |
| Servidor MCP | Recuperacion selectiva por turno, herramientas que Claude llama segun necesidad, persistencia estructurada, compartible | Hay que construirlo |

El protocolo MCP existe **exactamente** para este caso: dar al LLM
herramientas que decide cuando invocar segun el contexto. Un script no puede
hacer esa decision; siempre dumpea todo. Un MCP solo devuelve lo que el LLM
pide.

---

## 2. La gran decision: memoria EN el proyecto

A diferencia de otras soluciones MCP de memoria que centralizan en HOME del
usuario, este MCP guarda la memoria **dentro del proyecto**, en
`<proyecto>/.recall/`.

### Por que

1. **La memoria viaja con el codigo.** Si copias el folder, mueves el repo o
   lo clonas en otra maquina, la memoria viene con el.
2. **Compartible con el equipo.** Si commiteas `.recall/`, otros devs
   tienen acceso al historial de decisiones, learnings y entidades que el
   equipo ha construido en sus sesiones con Claude.
3. **Sin hashes que se rompen.** Renombrar el folder no destruye la memoria
   (el `workspace_id` vive dentro del proyecto, no se deriva del path).
4. **Backup natural.** Tu backup del codigo incluye la memoria.
5. **Privacy por contexto.** Cada proyecto decide su modo: compartido,
   encriptado o privado.

### Que vive donde

```
<proyecto>/.recall/                ← TODA la memoria del proyecto
├── recall.db                          ← decisions, learnings, tasks, turns, entities
├── vectors.db                          ← embeddings
├── config.json                         ← config del workspace (incluye modo y workspace_id)
└── .gitignore                          ← auto-creado segun modo

~/.cache/recall/                   ← SOLO cache (XDG-compliant)
└── models/                             ← modelo de embeddings (compartido entre proyectos)

~/.config/recall/                  ← SOLO defaults globales minimos (XDG-compliant)
├── config.json                         ← que modelo embedder usar
└── keys/                               ← claves de modos encriptados, indexadas por workspace_id
    └── <workspace_id>.key
```

**Regla de oro:** si borras `~/.cache/recall/`, no pierdes nada del
proyecto (se redescarga el modelo). Si borras `~/.config/recall/keys/`,
los workspaces encriptados quedan bloqueados hasta que vuelvas a hacer unlock
(la memoria sigue ahi, solo no la puedes leer sin la clave).

---

## 3. Indice del documento

### Producto
1. **[01-arquitectura.md](./01-arquitectura.md)** — Componentes, flujos de datos, separacion de responsabilidades.
2. **[02-protocolo-mcp.md](./02-protocolo-mcp.md)** — Tools que el MCP expone: 6 en MVP, mas en v0.5.
3. **[03-modelo-datos.md](./03-modelo-datos.md)** — Esquemas SQLite, indices vectoriales, FTS5, ciclo de vida.
4. **[04-capas-contexto.md](./04-capas-contexto.md)** — Las 7 capas de memoria por proyecto, presupuestos de tokens.
5. **[05-memoria-decay.md](./05-memoria-decay.md)** — Self-healing, decay temporal, consolidacion, deduplicacion.
6. **[06-stack-tecnico.md](./06-stack-tecnico.md)** — TypeScript + better-sqlite3-multiple-ciphers + sqlite-vec + fastembed.
7. **[07-instalacion.md](./07-instalacion.md)** — Setup en Claude Code, eleccion de modo, primer arranque.
8. **[08-casos-uso.md](./08-casos-uso.md)** — Ejemplos: nueva feature, debug, refactor, onboarding, modo encriptado.
9. **[09-roadmap.md](./09-roadmap.md)** — MVP en 1 semana, v0.5 en 4 semanas, v1.0 en 12 semanas.
10. **[10-comparativa.md](./10-comparativa.md)** — vs HANDOFF.md manual, vs OpenMemory, vs Mem0, vs LangMem.
11. **[11-seguridad-modos.md](./11-seguridad-modos.md)** — Los 3 modos en detalle, SQLCipher, gestion de claves, deteccion de secrets.

### Implementacion (no negociables)
12. **[12-lineamientos-arquitectura.md](./12-lineamientos-arquitectura.md)** — Clean + Hexagonal + DDD + SOLID + modularidad estricta + cero `any`. Reglas obligatorias para cada PR.
13. **[13-workflow-agentes.md](./13-workflow-agentes.md)** — 13 agentes especialistas (6 implementadores + 6 validadores + 1 orquestador), ciclo de validacion, integracion SonarQube ≥95%.

---

## 4. Lectura recomendada por rol

| Quieres... | Lee en este orden |
|---|---|
| Decidir si construirlo | README → 10-comparativa → 09-roadmap |
| Implementarlo desde cero | **12-lineamientos** → **13-workflow-agentes** → 01-arquitectura → 06-stack → 11-seguridad → 02-protocolo → 03-datos → 04-capas → 05-memoria → 09-roadmap |
| Solo usarlo (cuando exista) | 07-instalacion → 11-seguridad-modos → 08-casos-uso |
| Auditar la propuesta | 01-arquitectura → 12-lineamientos → 11-seguridad → 04-capas → 05-memoria → 10-comparativa |

---

## 5. Convenciones del documento

- **Idioma:** UI/docs en espanol, codigo/identificadores en ingles.
- **Pseudocodigo:** estilo TypeScript (legible para frontend y backend).
- **Tablas:** preferidas sobre listas para datos estructurados.
- **Decisiones:** cada decision tiene seccion "Por que esto y no X".
- **Que NO se especifica:** UI del cliente — es un servidor headless.

---

## 6. Estado del proyecto

Esto es **especificacion**, no codigo aun. La intencion es:

1. Que cualquier dev pueda implementarlo con esta doc como input unico.
2. Que sea independiente del proyecto Coder (donde nacio la idea).
3. Que un futuro Coder lo use como adapter de memoria, no como duplicacion.

Cuando se construya el codigo, vivira en repo separado:
`github.com/<owner>/recall` o similar.

---

## 7. Resumen de los 3 modos de privacidad

Detalle completo en [`11-seguridad-modos.md`](./11-seguridad-modos.md).

| Modo | Que se versiona en git | Caso |
|---|---|---|
| **Compartido** (default) | Todo `.recall/` plano | Open-source, equipo abierto, sin info sensible |
| **Encriptado** | Todo `.recall/` cifrado con SQLCipher | Equipo cerrado, info sensible, repo privado o publico con seguridad extra |
| **Privado** | Nada (todo en `.gitignore`) | Memoria personal, no se comparte |

El modo se elige al primer arranque y queda en
`.recall/config.json`. Cambiable despues con
`recall mode <nuevo-modo>`.
