# MCP Memoria Inteligente — convenciones del repo

## REGLA #1 (NO NEGOCIABLE): nunca trabajar desde un git worktree

Este repo **debe operarse siempre desde su checkout principal**:
`/Users/h2devx/proyects/netzi-tech/mcp/memoria/`.

**No usar worktrees** — ni los que crea Claude Desktop / Cowork
automaticamente al abrir el proyecto, ni los que crea el `Agent` tool
con `isolation: "worktree"`.

### Por que

Un release fallido en este repo (publish v0.1.0 a npm + GitHub) se
debio a que la sesion arranco dentro de
`.claude/worktrees/<random>/` mientras el repo principal del usuario
estaba estancado en un commit anterior. Resultado: el `git pull` del
usuario fallo con conflictos, hubo que rescatar cambios uncommitted de
una sesion previa, y se perdio confianza en el estado del repo. Ver
`HANDOFF.md` §6.10 para el log completo.

### Que debes hacer si detectas que arrancaste en un worktree

1. **Comprobacion**: si `pwd` contiene `.claude/worktrees/`, estas en
   un worktree (no debes estarlo aqui).
2. El hook `.claude/settings.json` te imprime un
   `WARNING_NETZI_NO_WORKTREES:` en cada prompt del usuario si el cwd
   esta dentro de un worktree.
3. **Detente** antes de ejecutar cualquier `git`, `Edit`, `Write` o
   `Bash` que toque archivos del repo.
4. **Avisa al usuario** con el mensaje exacto:
   > Detecte que esta sesion arranco en un worktree de Cowork
   > (`<path>`). Este proyecto NO permite trabajar desde worktrees
   > (ver `CLAUDE.md` regla #1). Por favor:
   > 1. Cierra esta sesion.
   > 2. Abre Claude directamente sobre
   >    `/Users/h2devx/proyects/netzi-tech/mcp/memoria/` (no via
   >    Cowork).
   > 3. Si el worktree quedo sucio, limpialo con:
   >    `git worktree remove <path> --force` +
   >    `git branch -D claude/<worktree-name>`.
5. **No insistas**. No "trabajes alrededor" del worktree. No
   intentes redirigir cwd. No ejecutes nada hasta que el usuario
   abra una sesion nueva sobre el repo principal.

### Como evitar el worktree (lado usuario)

- En la app Claude Desktop, al abrir este proyecto evita el modo
  Cowork (worktree por sesion). Usa el CLI `claude` directamente
  desde una terminal `cd /Users/h2devx/proyects/netzi-tech/mcp/memoria`.
- O desactivar Cowork globalmente eliminando
  `~/Library/Application Support/Claude/cowork-enabled-cli-ops.json`
  (afecta TODOS los proyectos).

---

## Otras convenciones del repo

- **Idioma**: documentacion + UI en espanol; codigo + commits en
  ingles.
- **Workflow multi-agente**: descrito en `docs/13-workflow-agentes.md`.
- **Estado actual**: ver `HANDOFF.md` §0 y §6.10.
- **Release publicado**: `@netzi/mcp-memoria@0.1.0` en npm; tag
  `v0.1.0` apunta a commit del release.
- **Proximos pasos**: v0.1.1 (cerrar 2 highs upstream tar/fastembed,
  B-008, B-009). Ver `docs/RELEASE-NOTES-v0.1.0.md` y `HANDOFF.md` §8.
