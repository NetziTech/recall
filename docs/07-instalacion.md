# 07 — Instalacion y configuracion

> Como integrar el MCP en Claude Code (y otros clientes), elegir modo,
> primer arranque, troubleshooting.

---

## 1. Requisitos

- **Node.js** 20.0+ (para correr el server).
- **macOS / Linux / Windows** (todos soportados).
- **~50 MB de disco** para deps + modelo de embedding inicial (cache global).
- **~25 MB de disco por proyecto** activo.

No requiere:
- Servidor externo.
- API keys (a menos que se elija Voyage cloud opt-in).
- Permisos de admin.

---

## 2. Instalacion

### Opcion A: On-demand via npx (recomendado)

Sin install previo. El cliente lo ejecuta y npx descarga si falta:

```json
{
  "mcpServers": {
    "memoria": {
      "command": "npx",
      "args": ["-y", "recall@latest", "server"]
    }
  }
}
```

**Por que npx:** auto-update implicito, no contamina globals, mismo
patron que otros MCP servers.

### Opcion B: Global

```bash
npm install -g recall
```

Luego en config MCP del cliente:

```json
{
  "mcpServers": {
    "memoria": {
      "command": "recall-server"
    }
  }
}
```

Ventaja sobre npx: el `recall` CLI tambien queda en el PATH para
operaciones manuales (`unlock`, `audit`, `mode`, etc.).

### Opcion C: Build desde fuente

```bash
git clone https://github.com/<owner>/recall
cd recall
npm install
npm run build
```

Apuntar el cliente al binary local:

```json
{
  "mcpServers": {
    "memoria": {
      "command": "node",
      "args": ["/path/to/recall/dist/index.js"]
    }
  }
}
```

---

## 3. Setup en Claude Code

### Ubicacion del config

| OS | Path del config de Claude Desktop |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Para Claude Code CLI:

```bash
claude mcp add memoria npx "-y" "recall@latest" "server"
```

O editar `~/.claude/settings.json`:

```json
{
  "mcp": {
    "memoria": {
      "command": "npx",
      "args": ["-y", "recall@latest", "server"],
      "env": {
        "RECALL_LOG_LEVEL": "info"
      }
    }
  }
}
```

### Verificacion

Reinicia Claude Code y ejecuta:

```
> /mcp
```

Deberia listar `memoria` con sus 6 tools (mas otras de v0.5+ si la version
las incluye).

---

## 4. Variables de entorno

| Variable | Default | Proposito |
|---|---|---|
| `RECALL_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `RECALL_EMBEDDER` | `fastembed` | `fastembed` / `voyage` |
| `RECALL_EMBED_MODEL` | `BGESmallEN15` | `MultilingualE5Base` para espanol |
| `VOYAGE_AI_KEY` | (ninguna) | API key si embedder=voyage |
| `RECALL_AUTO_CURATOR` | `true` | si corre curador automatico |
| `RECALL_SECRET_DETECTION` | `true` | bloquea secrets en input |
| `RECALL_SESSION_IDLE_MIN` | `30` | minutos para auto-cerrar sesion |
| `RECALL_CACHE_DIR` | `~/.cache/recall` | override XDG |
| `RECALL_CONFIG_DIR` | `~/.config/recall` | override XDG |

Definir en `claude_desktop_config.json` via campo `env`:

```json
{
  "mcpServers": {
    "memoria": {
      "command": "npx",
      "args": ["-y", "recall@latest", "server"],
      "env": {
        "RECALL_EMBEDDER": "voyage",
        "VOYAGE_AI_KEY": "${VOYAGE_AI_KEY}"
      }
    }
  }
}
```

---

## 5. Primer arranque

### Que pasa la primera vez en general

1. El server arranca, detecta si `~/.config/recall/` y
   `~/.cache/recall/` no existen.
2. Crea estructura:
   ```
   ~/.config/recall/
   ├── config.json     (defaults)
   └── keys/

   ~/.cache/recall/
   ├── models/
   └── logs/
   ```
3. Descarga modelo de embedding (33 MB para `BGESmallEN15`). Tarda
   ~10-30s la primera vez.
4. Reporta ready al cliente.

**Importante:** primera invocacion puede tomar ~30s. Las siguientes
< 200ms.

### Primera sesion en un proyecto nuevo

```
> claude
[Claude llama mem.init({})]

[Server detecta no hay .recall/ en cwd]
[Server retorna: { is_new: true, requires_mode_choice: true }]

[Claude muestra al usuario:]

  Inicializando memoria para este proyecto. ¿Que modo prefieres?

  1) Compartido (default)
     - Toda la memoria en git plano
     - El equipo ve diffs en code review
     - Sin cifrado
     - Recomendado para: open-source, equipos abiertos

  2) Encriptado
     - Toda la memoria en git, cifrada con SQLCipher
     - Requiere clave para abrir
     - Recomendado para: equipos cerrados con info sensible

  3) Privado
     - .recall/ en .gitignore
     - Tu memoria personal, no se comparte
     - Recomendado para: tus notas privadas o pruebas

[Usuario elige (ej: 2)]

[Claude llama mem.init({mode: "encrypted"})]

[Server crea .recall/, genera clave]

[Server retorna por canal MCP:]
  { workspace_id: "abc-123...", mode: "encrypted",
    key_displayed_via_stdout: true }

[Y por stdout del CLI imprime:]
  ╔══════════════════════════════════════════════════════════════╗
  ║ Clave de cifrado para este workspace                         ║
  ║                                                              ║
  ║   M3-ZK7L-Q4WV-8RTX-9YBN-2HCD-FGJM-1PSE-4ULA                 ║
  ║                                                              ║
  ║ COPIA Y GUARDA esta clave en lugar seguro.                   ║
  ║ Compartela con tu equipo por canal seguro.                   ║
  ║ Si la pierdes, la memoria es irrecuperable.                  ║
  ║                                                              ║
  ║ Esta clave NO se vuelve a mostrar.                           ║
  ╚══════════════════════════════════════════════════════════════╝

[Usuario copia la clave a 1Password]
```

A partir de ahi, cada `mem.remember` agrega memoria. Despues de unas 5-10
sesiones, los `mem.recall` empiezan a tener resultados utiles.

### Primer arranque tras `git pull` (modo encrypted)

```
[dev2] $ cd <repo-clonado>
[dev2] > claude

[Claude llama mem.init({})]
[Server detecta .recall/, lee config.json: mode=encrypted]
[Server busca ~/.config/recall/keys/abc-123.key → no existe]
[Server retorna error -32107 ENCRYPTED_LOCKED]

[Claude muestra al usuario:]
  El workspace esta cifrado. Pidele la clave a alguien del equipo y
  ejecuta en otra terminal:
    recall unlock --workspace .

[dev2] $ recall unlock --workspace .
> Pega la clave de cifrado: M3-ZK7L-Q4WV-8RTX-9YBN-2HCD-FGJM-1PSE-4ULA

[CLI valida y guarda en ~/.config/recall/keys/abc-123.key]
> Workspace desbloqueado.

[dev2] > claude
[Ahora todo funciona transparente]
```

---

## 6. Configuracion por proyecto

`.recall/config.json` se crea al inicializar y se versiona en git
(modos `shared` y `encrypted`). Permite override de defaults globales.

```json
{
  "schema_version": "1.0.0",
  "workspace_id": "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89",
  "display_name": "Coder",
  "mode": "shared",
  "embedder": {
    "model": "MultilingualE5Base",
    "dimension": 768
  },
  "retrieval": {
    "default_top_k": 12,
    "default_max_tokens": 3000
  },
  "context": {
    "max_tokens": 6000,
    "layer_budgets": {
      "code_map": 1000,
      "relevant_memory": 2000
    }
  },
  "curator": {
    "decay_factor": 0.97
  },
  "secrets": {
    "extra_patterns": ["MY_PROJECT_TOKEN_[A-Z0-9]+"],
    "allowed_patterns": ["sk-test-known-public"]
  }
}
```

### Politica de fusion

1. Defaults del binario.
2. `~/.config/recall/config.json` (defaults del usuario).
3. `.recall/config.json` (overrides del proyecto).

El ultimo gana.

---

## 7. CLI: comandos disponibles

```bash
# Inicializacion / modos
recall init [--workspace <path>] [--mode shared|encrypted|private]
recall mode <new-mode> --workspace <path>

# Encriptado
recall unlock --workspace <path>
recall forget-key --workspace <path>
recall export-key --workspace <path>      # imprime clave si esta unlocked
recall rekey --workspace <path>            # v0.5+
recall add-key --workspace <path>          # v0.5+

# Mantenimiento
recall audit --workspace <path> [--check-secrets] [--strict]
recall sanitize --workspace <path> --entry-id <id>
recall curator-run --workspace <path> [--dry-run]
recall curator-log --workspace <path> [--last <n>]

# Migracion
recall import-handoff --workspace <path> --handoff <file.md>

# Backup / restore
recall export --workspace <path> --output backup.json
recall import --workspace <path> --input backup.json
recall wipe --workspace <path> --confirm

# Hooks
recall install-hook --workspace <path>     # pre-commit hook git
recall uninstall-hook --workspace <path>

# Stats / health
recall stats --workspace <path>
recall health --workspace <path>

# Server (lo invoca el cliente MCP, no el usuario)
recall server                              # entry-point del MCP server
```

---

## 8. System prompt recomendado para el cliente

Para que Claude use la memoria efectivamente, el system prompt debe incluir:

```markdown
## Memoria persistente (MCP `memoria`)

Tienes acceso al MCP `memoria` que persiste informacion del proyecto entre
sesiones. La memoria vive en `<proyecto>/.recall/` y, segun el modo,
puede estar versionada en git.

**Al inicio de cada sesion:**
1. Llama `mem.init` (auto-detecta workspace).
2. Si retorna `is_new: true`, pregunta al usuario que modo quiere
   (compartido / encriptado / privado).
3. Si retorna `encryption_status: "locked"`, dile al usuario que ejecute
   `recall unlock --workspace <path>` y espera.
4. Llama `mem.context({query: "<intent del usuario>"})` para cargar contexto.

**Durante la sesion:**
- `mem.recall` cuando necesites contexto sobre algo del proyecto.
- `mem.remember({kind: "decision"})` cuando se tome una decision
  arquitectonica significativa.
- `mem.remember({kind: "learning"})` cuando descubras algo no-obvio.
- `mem.remember({kind: "turn"})` al cerrar un bloque significativo.
- `mem.task` para tasks que persistan entre sesiones.

**Cuando NO usar:**
- No registres cada turno trivial.
- No dupliques info que esta en el archivo actual.
- No registres secretos / credenciales.

**Reglas:**
- Es mejor consultar la memoria de mas que de menos.
- Es peor sub-registrar que sobre-registrar.
- Las decisiones vencen via `superseded_by`, NO via overwrite.
```

Este prompt va en el `CLAUDE.md` global del usuario o en el `.claude/`
del proyecto.

---

## 9. Configuracion para multiples clientes

El MCP soporta:

- **Claude Code** (CLI y desktop).
- **Cursor** (soporta MCP via config similar).
- **Otros clientes MCP** (Cline, Continue, etc.).

Cada cliente tiene su lugar para definir el MCP. La instalacion del server
es la misma; solo cambia donde se registra.

Para Cursor:

```json
// ~/.cursor/mcp.json
{
  "mcpServers": {
    "memoria": {
      "command": "npx",
      "args": ["-y", "recall@latest", "server"]
    }
  }
}
```

**Importante:** dos clientes apuntando al mismo proyecto comparten la
memoria del proyecto (los dos abren el mismo `.recall/recall.db`).
Util si usas Claude Code de dia y Cursor de noche.

---

## 10. Migracion desde HANDOFF.md manual

Si ya tienes un proyecto con `HANDOFF.md` y `CLAUDE.md` muy poblados:

```bash
recall import-handoff \
  --workspace . \
  --handoff HANDOFF.md \
  --claude-md CLAUDE.md \
  [--mode shared]
```

El comando:
1. Si no hay `.recall/`, crea uno con el modo elegido.
2. Parsea las secciones del markdown (lista, headings, tablas).
3. Mapea a tablas (decisions del CLAUDE.md, tasks/turns del HANDOFF).
4. Crea entries con tag `imported_from_handoff`.
5. Reporta cuantas entries creo.

**Que es heuristico:** el parser intenta detectar listas, headings, tablas.
No es perfecto. Revisar entries con tag `needs_review`.

---

## 11. Backup y restore

### Backup manual

Como `.recall/` vive dentro del proyecto, ya esta cubierto por el
backup del proyecto (git, time machine, etc.).

Backup explicito:

```bash
recall export --workspace . --output recall-backup-2026-04-27.json
```

### Restore

```bash
recall import --workspace . --input recall-backup-2026-04-27.json
```

**Atencion:** import a un workspace existente fusiona, no reemplaza. Para
empezar de cero:

```bash
recall wipe --workspace . --confirm
recall import --workspace . --input backup.json
```

### Sync entre maquinas

Para modos `shared` y `encrypted`, **git ES el sync**. Pull y todos los devs
tienen la misma memoria.

Para modo `private`, no hay sync automatico (es deliberado). Si quieres
sincronizar tu memoria privada entre tus maquinas:
- Dropbox / iCloud / OneDrive (folder synced).
- Rsync / Syncthing.

**Atencion:** dos maquinas escribiendo al mismo SQLite via folder sync puede
corromper. Mejor usar la memoria en una sola a la vez.

---

## 12. Desinstalacion

```bash
# Quitar del config MCP del cliente (editar manualmente)

# Opcional: borrar cache compartido
rm -rf ~/.cache/recall/

# Opcional: borrar config global y claves
rm -rf ~/.config/recall/
# (cuidado: si tienes workspaces encriptados, quedan irrecuperables sin las
#  claves a menos que las tengas guardadas en otro lado)

# Si fue install global
npm uninstall -g recall

# Las memorias en cada proyecto (.recall/ dentro de cada proyecto)
# quedan ahi. Si quieres borrarlas:
find ~/proyectos -name ".recall" -type d -exec rm -rf {} +
```

---

## 13. Troubleshooting comun

| Problema | Solucion |
|---|---|
| Server no aparece en `/mcp` | Verificar config JSON, reiniciar cliente |
| Tarda mucho la primera vez | Descarga del modelo embedding, esperar ~30s |
| `mem.recall` devuelve vacio | Aun no hay datos. Llamar `mem.remember` primero |
| `Database is locked` | WAL no se aplico. Verificar permisos en `.recall/` |
| Error -32107 ENCRYPTED_LOCKED | `recall unlock --workspace <path>` |
| Error -32108 INVALID_KEY | Verificar que pegaste la clave correcta |
| Embeddings inconsistentes (modelo cambio) | `recall curator-run --workspace .` para re-embed |
| Disco lleno | `recall curator-run` con prune agresivo, o aumentar limite en config |
| `.recall/` se subio por error en modo `private` | Cambiar a modo `private` no es suficiente; usar `git filter-repo` para borrar de la historia |
| Pre-commit hook bloquea siempre | Revisar reportes; ajustar `secrets.allowed_patterns` en config |

---

## 14. Observabilidad

```bash
# Ver logs en tiempo real
tail -f ~/.cache/recall/logs/$(date +%Y-%m-%d).log

# Ver tamano de cada workspace
find ~ -name ".recall" -type d -exec du -sh {} +

# Estadisticas de un proyecto
recall stats --workspace .

# Health check completo
recall health --workspace .

# Historial del curador
recall curator-log --workspace . --last 10
```

---

## 15. Onboarding de un nuevo dev al equipo (modo encrypted)

```bash
# 1. Clonar el repo
git clone <repo>
cd <repo>

# 2. El team lead (o quien corresponda) le da la clave por canal seguro
#    (1Password compartido, Bitwarden, etc.)

# 3. Hacer unlock
recall unlock --workspace .

# 4. Empezar a trabajar
claude
```

A partir de ahi todo funciona transparente. La clave queda en su HOME y no
hay que volver a unlock hasta que ejecute `forget-key`.
