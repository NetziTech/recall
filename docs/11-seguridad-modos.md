# 11 — Seguridad y modos de privacidad

> Los 3 modos en detalle, gestion de claves, deteccion de secrets en 5
> capas, cambios de modo, recovery.

---

## 1. Los 3 modos

| Modo | Que se versiona en git | Cifrado | Caso |
|---|---|---|---|
| `shared` (default) | Todo `.recall/` plano | No | Open-source, equipo abierto, sin info sensible |
| `encrypted` | Todo `.recall/` cifrado | SQLCipher AES-256 | Equipo cerrado, info sensible, repo privado o publico con seguridad extra |
| `private` | Nada (`.gitignore`) | No (no se sube) | Memoria personal, no se comparte |

El modo se elige al primer arranque y queda en `.recall/config.json`.
Cambiable despues con `recall mode <nuevo>`.

---

## 2. Modo `shared` (default)

### Que ocurre al inicializar

```
> claude  [primera sesion en proyecto sin .recall/]
[Claude llama mem.init({ mode: "shared" })]

MCP crea:
  .recall/
  ├── config.json          { workspace_id, mode: "shared", schema_version }
  ├── recall.db           SQLite plano
  ├── vectors.db           SQLite plano
  └── .gitignore           (vacio: nada se ignora)

Si existe `.gitignore` en el proyecto, NO toca nada (el modo shared no
necesita exclusiones).
```

### Ventajas

- Cualquiera que clone tiene la memoria al instante.
- Diff de git muestra que aprendio el equipo (decisions, learnings) en cada PR.
- Cero ceremonia.

### Riesgos

- Cualquier secret que se cuele a la DB queda en el historial publico.
- **Mitigacion:** capas 1-5 de deteccion de secrets (seccion 6).

### Cuando usarlo

- Proyectos open-source.
- Equipos donde la informacion del proyecto no es sensible.
- Single-dev con repo privado donde el riesgo de leak es bajo.

---

## 3. Modo `encrypted`

### Que ocurre al inicializar

```
> claude  [Claude llama mem.init({ mode: "encrypted" })]

MCP genera:
  - workspace_id = uuid v7
  - encryption_key = 32 bytes cripto-aleatorios

MCP escribe (con SQLCipher):
  .recall/
  ├── config.json          { workspace_id, mode: "encrypted", schema_version,
  │                          kdf: "argon2id", kdf_params: {...},
  │                          key_validator_blob: "..." }
  ├── recall.db           cifrado AES-256
  ├── vectors.db           cifrado AES-256
  └── .gitignore           (vacio: todo se versiona)

  ~/.config/recall/keys/<workspace_id>.key   (0600)

MCP imprime UNA SOLA VEZ por stdout del CLI (NO por canal MCP):
  ╔══════════════════════════════════════════════════════════════╗
  ║ Clave de cifrado para este workspace                         ║
  ║                                                              ║
  ║   M3-ZK7L-Q4WV-8RTX-9YBN-2HCD-FGJM-1PSE-4ULA                 ║
  ║                                                              ║
  ║ COPIA Y GUARDA esta clave en lugar seguro (1Password, etc.)  ║
  ║ Compartela con tu equipo por canal seguro.                   ║
  ║ Si la pierdes, la memoria es irrecuperable.                  ║
  ║                                                              ║
  ║ Esta clave NO se vuelve a mostrar.                           ║
  ╚══════════════════════════════════════════════════════════════╝
```

### Por que solo por stdout y no por canal MCP

El canal MCP es leido por Claude (LLM). Si la clave aparece ahi:
- Puede quedar en transcripts.
- Puede ser vista por screenshots compartidos.
- Puede ser logueada por el cliente.

Por stdout del CLI, la clave queda solo en el terminal del usuario y nunca
toca el LLM.

### Que pasa cuando otro dev hace `git pull`

```
[dev2] $ git clone <repo>
[dev2] $ cd <repo>
[dev2] > claude

[Claude llama mem.context(...)]
MCP arranca:
  - Detecta .recall/, lee config.json
  - mode: "encrypted", workspace_id: "abc-123..."
  - Busca ~/.config/recall/keys/abc-123.key → no existe
  - Retorna error -32107 ENCRYPTED_LOCKED al cliente:
    {
      "code": -32107,
      "message": "Workspace encrypted, key not available",
      "data": {
        "workspace_id": "abc-123...",
        "workspace_path": "/path/to/proyect",
        "unlock_command": "recall unlock --workspace ."
      }
    }

Claude muestra el mensaje al usuario.

[dev2] $ recall unlock --workspace .
> Pega la clave de cifrado: M3-ZK7L-Q4WV-8RTX-9YBN-2HCD-FGJM-1PSE-4ULA

MCP valida la clave:
  - Deriva clave AES-256 con argon2id usando kdf_params del config.
  - Intenta abrir recall.db con esa clave.
  - Lee key_validator_blob (un blob conocido cifrado al inicializar).
  - Si decifra correctamente → clave correcta.

Si OK:
  Guarda en ~/.config/recall/keys/abc-123.key (permisos 0600)
  Imprime: "Workspace desbloqueado. Esta clave persiste hasta que
            ejecutes 'recall forget-key --workspace .'"

[dev2] > claude
[ahora todo funciona transparente]
```

### Sesiones siguientes

Transparente: el MCP encuentra la clave en HOME y la usa automaticamente al
abrir las DBs.

### Comandos relacionados

```bash
recall unlock --workspace <path>           # Pegar clave + guardar en HOME
recall forget-key --workspace <path>       # Borrar clave local; DB queda bloqueada
recall export-key --workspace <path>       # Re-imprimir clave (si esta unlocked)
recall rekey --workspace <path>            # Rotar envelopes (passphrases); master estable (v0.5+)
recall add-key --workspace <path>          # Agregar envelope adicional (multi-key, v0.5+)
```

### Formato de la clave de recuperacion (printable master key)

El bloque mostrado al inicializar (`M3-ZK7L-...` en el ejemplo arriba) es un
**placeholder ilustrativo**. El formato real esta definido por la spec
Bech32 (BIP-173) y se ratifica en ADR-005 (`docs/12 §1.5.5`). Esta seccion
es la fuente de verdad del rendering y del parser.

**Por que Bech32 (BIP-173) y no hex / BIP-39 / un encoding custom:**

| Opcion | Pros | Contras | Por que descartada / elegida |
|---|---|---|---|
| Hex crudo (`a3f8...`) | Trivial | Cero deteccion de errores de transcripcion; ambiguo (`B/8`, `0/O`) | Recovery footgun: un typo da "wrong key" sin pista de la posicion |
| BIP-39 mnemonic | Humanamente memorable; wordlists validan | 24 palabras EN para 256 bits ~200 chars; depende de wordlist + i18n; UX divergente del init actual | Anade dependencia >2KB; no aporta seguridad cripto sobre Bech32 |
| Encoding custom | Control total | Sin auditoria, sin libreria, alto riesgo de bug | Viola "no security custom" del repo (ADR-004) |
| **Bech32 (BIP-173)** | Auditado en Bitcoin desde 2017; detecta hasta 4 errores en strings de ≤90 chars; detecta swaps adyacentes; implementacion en npm `bech32` | Curva de aprendizaje minima | **Elegida** |

**Spec del rendering.**

```
Estructura:  <hrp> "1" <data> <checksum>

  hrp        = "m3"
                 ^  ^
                 |  +-- version (mayor; bump en breaking changes del schema)
                 +----- prefijo del producto (memoria/master key)

  separador  = "1"                    (literal, una sola ocurrencia)

  data       = Base32(master_key)     32 bytes -> 52 chars del alfabeto
                                      Bech32 (qpzry9x8gf2tvdw0s3jn54khce6mua7l).
                                      Codifica cada 5 bits a un char.

  checksum   = 6 chars finales BCH    Polinomio BIP-173 const 0x2bc830a3,
                                      computado sobre [hrp_expand || data].
                                      Garantiza deteccion de hasta 4 errores
                                      en strings hasta 90 chars.

Longitud total:  2 + 1 + 52 + 6 = 61 chars.
```

**Grouping cosmetico al imprimir.** El string de 61 chars se renderiza con
guiones cada 4 chars para legibilidad humana. Los guiones **NO** entran al
checksum BCH y se eliminan antes de validar. Ejemplo de rendering:

```
m31-q92x-zy4g-7vnp-jw3t-cspr-fk6a-dx5n-zsre-h8m4-tk9q-x2pf-yvuc-3jhg-ldwa
```

(15 grupos de 4 + el ultimo grupo de 1; los grupos son uniformes excepto el
ultimo. Implementacion: insertar `-` cada 4 chars al renderizar, strip
todos los `-` al parsear.)

**Alfabeto Bech32 (lowercase obligatorio en wire):**

```
0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
q  p  z  r  y  9  x  8  g  f  2  t  v  d  w  0

16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
s  3  j  n  5  4  k  h  c  e  6  m  u  a  7  l
```

Excluye `1`, `b`, `i`, `o` por confusables con `l/I`, `8/B`, `1/l`, `0/O`.

**Algoritmo de checksum** (referencia BIP-173, no reimplementar):
- Input: `hrp_expand(hrp) || data_5bit_values`
- Polinomio generador: `0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3`
- Constante final: `0x2bc830a3` (Bech32, no Bech32m)
- Output: 6 valores de 5 bits anexados al data

**Vectores de prueba** (3 keys validas + 3 con typos):

| # | Input | Resultado esperado |
|---|---|---|
| V1 | master = 32 bytes de `0x00` | `m31qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq2t3pgr` (rendering ejemplo; computar valor real en test) |
| V2 | master = 32 bytes de `0xff` | (calcular con bech32 lib y fijar como test vector congelado) |
| V3 | master = vector pseudo-random fijo | (fijar) |
| T1 | V1 con char 8 flipped (`q`→`p`) | rejection con `error_position=8` |
| T2 | V2 con swap chars 12-13 | rejection con `error_kind=transposition` |
| T3 | V3 con 5 chars cambiados | rejection con `error_kind=unrecoverable` (>4 errores) |

Los vectores deben ser congelados en el repo (probablemente
`code/tests/fixtures/printable-master-key.vectors.json`) y referenciados
por los unit tests del VO `PrintableMasterKey`.

**Parser (path inverso).**

```
1.  Strip todos los caracteres `-` del input.
2.  Lowercase normalize (Bech32 requiere case uniforme; rechazar mixed-case
    como en BIP-173).
3.  Validar longitud exacta: 61 chars.
4.  Verificar prefix `m3` + separador `1` en posiciones 0..2.
5.  Decodificar los 52 chars de data + 6 chars de checksum usando la
    tabla del alfabeto (chars fuera del alfabeto -> rechazo con posicion).
6.  Verificar el polinomio BCH. Si falla:
       - reportar posicion de error si t=1 (corregible).
       - reportar "unrecoverable" si t>=2.
       - rechazo HARD-REJECT (no intentar unlock con la key candidata).
7.  Si checksum OK, reconstruir los 32 bytes de master desde los 52
    chars de data (decodificacion base32, ultimo char tiene 1 bit de
    padding cero).
```

**Comportamiento ante checksum-fail:**

- Por defecto: **HARD REJECT**. No intentar `unlockWith()`. Mensaje claro:
  `"Recovery key invalid: checksum mismatch at position 14"` o
  `"Recovery key invalid: 2+ errors detected, please re-check"`.
- Override `--skip-checksum`: permite intentar unlock saltando la
  verificacion BCH. Loggea evento `RECOVERY_SKIP_CHECKSUM` al
  `encryption.audit_log` (ver `docs/12 §1.5.5` apendice Q4). Justificacion
  documentada: usuarios con keys v0.1.x sin checksum (legacy) o casos de
  emergencia. **No es la ruta default**.

**Migracion de claves legacy (pre-spec).**

Keys generadas antes de esta spec (ej. en v0.1.x si llegaron a usarse en
algun workspace de prueba) **no tienen checksum** y no son parseables por
el VO `PrintableMasterKey`. Path de migracion:

1. Usuario corre `recall unlock --workspace . --skip-checksum`
2. El facade detecta legacy y emite warning: `"Legacy key without
   checksum. Re-export with 'recall export-key' to get the v3 format."`
3. Despues del unlock exitoso, opcionalmente loggea
   `LEGACY_KEY_UNLOCK` al audit_log.
4. El usuario corre `recall export-key` que renderiza con la spec v3.

**Implementacion (referencia).**

Vive en `code/src/modules/encryption/domain/value-objects/printable-master-key.ts`
como Value Object DDD. Usa la libreria `bech32` (npm package, BIP-173
auditada). Tests con los vectores congelados. El reverse path es invocado
por `UnlockEncryptionUseCase` cuando el input parece tener el prefix `m3`.

### Cuando usarlo

- Equipo cerrado con repo publico donde no quieren exponer decisiones internas.
- Repo privado pero defensa en profundidad por compliance.
- Proyectos con info sensible (decisions sobre clientes, integraciones, etc.).

### Trade-offs

- Diffs de git de `.recall/*.db` son binarios opacos, no se pueden
  revisar en code review.
- Si pierdes la clave Y todos los miembros del equipo pierden la suya, la
  memoria es irrecuperable. Es la promesa del cifrado.
- Latencia ligeramente mayor (~10-20% sobre operaciones de DB).

---

## 4. Modo `private`

### Que ocurre al inicializar

```
> claude  [Claude llama mem.init({ mode: "private" })]

MCP crea:
  .recall/
  ├── config.json          { workspace_id, mode: "private", schema_version }
  ├── recall.db
  ├── vectors.db
  └── .gitignore           contenido: *

Y agrega ".recall/" al `.gitignore` raiz del proyecto si existe (con
prompt de confirmacion).
```

### Ventajas

- Imposible que se filtre por commit accidental.
- Cero exposicion publica de decisiones / lecciones.
- Cada dev tiene su memoria personal del proyecto.

### Trade-offs

- No se comparte con el equipo. Otro dev al clonar empieza con memoria vacia.
- Si cambias de maquina, no se sincroniza (a menos que tu mismo sincronices
  `.recall/` por otro canal: rsync, Dropbox, etc.).

### Cuando usarlo

- Tu memoria personal en proyecto del que no quieres compartir notas
  internas.
- Proyectos de cliente donde no se permite committear nada relacionado al
  trabajo del equipo.
- Pruebas y exploracion personal.

---

## 5. Cambios de modo

```bash
recall mode shared    --workspace .
recall mode encrypted --workspace .
recall mode private   --workspace .
```

### Reglas

| De | A | Que pasa |
|---|---|---|
| `shared` | `encrypted` | Genera nueva clave, re-cifra DBs, imprime clave una vez |
| `shared` | `private` | Mueve `.recall/` a `.gitignore`. **Warning:** la historia de git ya tiene los datos en plano (ver "post-leak hygiene") |
| `encrypted` | `shared` | **PROHIBIDA** (politica conservadora). El domain lanza `InvalidModeTransitionError`. Dos pasos explicitos requeridos: `encrypted → private → shared` (ver nota abajo) |
| `encrypted` | `private` | Requiere unlock. Mueve a `.gitignore`. Borra clave de HOME (opt-in) |
| `private` | `shared` | Quita de `.gitignore`. Comitealo cuando estes listo |
| `private` | `encrypted` | Genera clave, cifra. Quita de `.gitignore`. Comitealo |

**Nota sobre `encrypted → shared` (politica conservadora,
ratificada en architect review final 2026-04-28, decision D-103):**

La transicion directa `encrypted → shared` esta **prohibida por
diseño** en el dominio del aggregate `Workspace`. Razon: la
transicion implica un **leak intencional** de la historia de git —
un `git log -p` revelaria el ultimo state cifrado y el state plano
nuevo en el mismo branch, lo cual es una degradacion de garantias de
privacidad por accion no obvia.

Si el usuario realmente quiere desencriptar y compartir, debe seguir
**dos pasos explicitos** que actuan como confirmacion deliberada:

```bash
# Paso 1 — desencriptar destruyendo el cifrado y moviendo a .gitignore
recall mode private --workspace .   # requiere unlock previo

# Paso 2 — quitar de .gitignore y comitear
recall mode shared --workspace .
```

El patron es **seguro-por-defecto**: cualquier comando que mezcle
descifrado + commit a git plano debe ser deliberado y reconocido
como tal. Un warning de doc no detiene un comando que debe ser
explicitamente intencional.

Si una version futura (v0.5+) necesita relajar esta politica (por
ej: para operaciones de migracion masiva), bastara con levantar la
prohibicion en el aggregate `Workspace` y actualizar este ADR
informal con la nueva politica.

### Post-leak hygiene

Si vas de `shared` o `encrypted` a `private` despues de tener commits, los
datos siguen en la historia de git. El comando warning sugiere:

```bash
# Si era informacion sensible, considera filtrar la historia:
git filter-repo --invert-paths --path .recall/
git push --force-with-lease origin main
```

El MCP no ejecuta esto automaticamente — es destructivo y require decision
manual.

---

## 6. Deteccion de datos sensibles (5 capas)

### Capa 1 — Pre-write detection (siempre activa)

Antes de cualquier `record_*`, el MCP corre:

| Detector | Que busca | Accion |
|---|---|---|
| Patrones AWS | `AKIA[0-9A-Z]{16}`, `aws_secret_access_key=...` | Rechaza con `-32105` |
| JWT | `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | Rechaza |
| GitHub tokens | `gh[ps]_[A-Za-z0-9]{36,}` | Rechaza |
| Generic API keys | `[a-z_]*key[a-z_]*\s*[=:]\s*['"][A-Za-z0-9_-]{20,}` | Rechaza |
| Passwords en URL | `://[^/\s]+:[^@/\s]+@` | Rechaza |
| Private keys | `-----BEGIN [A-Z ]+PRIVATE KEY-----` | Rechaza |
| Entropy check | strings > 20 chars con entropia Shannon > 4.5 bits/char | Warning + log, no rechaza (muchos falsos positivos posibles) |

Configurable via `.recall/config.json`:

```json
{
  "secrets": {
    "enabled": true,
    "extra_patterns": ["MY_CUSTOM_TOKEN_[0-9]+"],
    "allowed_patterns": ["sk-test-known-public"],
    "entropy_threshold": 4.5
  }
}
```

### Capa 2 — Path sanitizer (siempre activa)

Cualquier path absoluto con segmento de username del sistema se reescribe:

```
/Users/h2devx/proyects/coder/src/lib.rs   →   ~/proyects/coder/src/lib.rs
/home/john/work/repo                       →   ~/work/repo
C:\Users\Jane\Projects\app                 →   ~\Projects\app
```

Si el path esta dentro del workspace, se reescribe a relativo:

```
/Users/h2devx/proyects/coder/src/lib.rs   →   src/lib.rs   (workspace = /Users/h2devx/proyects/coder)
```

### Capa 3 — Modo encriptado (opt-in)

Si el modo del workspace es `encrypted`, todos los datos en disco estan
cifrados con AES-256 via SQLCipher. Aunque un secret se cuele a la DB,
quien clone el repo sin la clave no puede leerlo.

### Capa 4 — Pre-commit hook opcional

```bash
recall install-hook --workspace .
```

Instala un git pre-commit hook que, antes de cada commit:

1. Lista archivos staged dentro de `.recall/`.
2. Si modo es `shared`, escanea contenido completo (no solo el delta) con
   detectores actualizados de la version actual del MCP.
3. Si modo es `encrypted`, valida que las DBs siguen cifradas (proteccion
   contra cambio de modo accidental).
4. Si modo es `private`, valida que NO hay archivos staged en
   `.recall/` (alguien podria haber removido el `.gitignore`).
5. Si encuentra problemas → bloquea el commit con mensaje claro: archivo,
   linea, patron detectado, como permitirlo si es falso positivo.

#### Desinstalacion

```bash
recall uninstall-hook --workspace .
```

Comportamiento (idempotente, exit 0 en los cuatro escenarios):

- **Sin hook** → mensaje informativo (`No habia hook pre-commit instalado.`).
- **Hook ajeno** (sin marcador `managed-by: recall`) → no se modifica el
  archivo (politica conservadora). Mensaje colapsado al mismo "no habia
  hook" en stdout; el log preserva la distincion en `status=not-managed`
  para auditoria.
- **Hook gestionado por recall** (delimitadores
  `# >>> recall pre-commit >>>` ... `# <<< recall pre-commit <<<` o solo
  el marcador `managed-by:` legacy de versiones anteriores) → archivo
  eliminado.
- **Hook mixto** (delimitadores recall + contenido de otra herramienta) →
  solo se excisa el bloque entre los marcadores; el resto del archivo
  sobrevive verbatim y conserva su bit de ejecucion.
- **Re-ejecucion despues de uninstall** → idempotente, exit 0 con el
  mensaje de "no habia hook".

### Capa 5 — Auditoria on-demand

```bash
recall audit --workspace . --check-secrets [--strict]
```

Escanea TODA la DB (no solo lo nuevo) con detectores actualizados. Reporta
cada hallazgo con confidence score y entry_id. Util:

- Despues de actualizar el MCP (los detectores pueden mejorar).
- Antes de hacer push de un repo a publico.
- Como rutina mensual.

`--strict` hace que el comando exit 1 si encuentra cualquier hallazgo, util
para CI.

### Sanitizacion post-hoc

```bash
recall sanitize --workspace . --entry-id abc123
```

Reemplaza el contenido por `[REDACTED:secret-detected-by-audit-2026-04-27]`,
conserva la estructura (relations no se rompen), regenera el embedding,
registra en `audit_log`.

---

## 7. Gestion de claves

### Almacenamiento local

`~/.config/recall/keys/<workspace_id>.key` con permisos `0600`.

Formato del archivo:
```
mcpmem-key-v1
M3ZK7LQ4WV8RTX9YBN2HCDFGJM1PSE4ULA
```

### Validacion de clave

Al inicializar el modo encrypted, el MCP escribe en `config.json`:

```json
{
  "kdf": "argon2id",
  "kdf_params": { "memory": 65536, "iterations": 3, "parallelism": 4, "salt": "<base64>" },
  "key_validator_blob": "<base64-encrypted-known-string>"
}
```

Cuando un dev hace unlock:
1. Deriva clave AES-256 con argon2id usando los params + salt del config.
2. Intenta descifrar `key_validator_blob`. Si el plaintext == `"VALID"`,
   la clave es correcta.
3. Si no, error `-32108 INVALID_KEY`.

Asi se valida sin abrir la DB completa, en < 100ms.

### Multi-key (v0.5+)

```bash
recall add-key --workspace .
```

Genera una segunda clave que tambien puede abrir la DB. SQLCipher no
soporta multiples claves nativamente, asi que la implementacion es:

1. La clave maestra real es interna y aleatoria.
2. Cada clave de usuario cifra la clave maestra y la guarda como entry en
   `config.json` (campo `key_envelopes`).
3. Al unlock con una clave de usuario, se descifra el envelope, se obtiene
   la clave maestra, se abre la DB.

Casos:
- Cada miembro del equipo con su propia clave (no comparten una sola).
- Rotar claves removiendo envelopes obsoletos.
- Tener una clave de "recovery" guardada offline.

### Rotacion de clave

```bash
recall rekey --workspace .
```

1. Requiere unlock previo (DB abierta).
2. Genera nueva clave maestra.
3. Re-cifra ambas DBs con la nueva clave (transaction-safe, snapshot pre).
4. Genera nuevo envelope con la nueva clave de usuario.
5. Imprime nueva clave de usuario por stdout.
6. Invalida envelopes anteriores.

Caso de uso: alguien sale del equipo. Se rota la clave, los demas hacen pull
y unlock con la nueva, el ex-miembro queda fuera.

---

## 8. Errores estandar relacionados

| Codigo | Significado | Accion del cliente |
|---|---|---|
| `-32105` | Secret detected in input | Sanitizar y reintentar |
| `-32107` | ENCRYPTED_LOCKED — workspace cifrado, sin clave en HOME | Pedir al usuario que ejecute `unlock` |
| `-32108` | INVALID_KEY — la clave no abre la DB | Verificar que sea la correcta |
| `-32109` | KEY_REVOKED — la clave fue invalidada por rekey | Pedir al usuario la clave nueva |

---

## 9. Privacidad cross-cliente

Si el usuario tiene Claude Code y Cursor abiertos en el mismo proyecto:

- Ambos abren las mismas DBs en `.recall/`.
- WAL mode permite multi-reader y un escritor a la vez.
- Si el modo es `encrypted`, ambos clientes leen la misma clave de
  `~/.config/recall/keys/<workspace_id>.key`. No hay duplicacion.

Si dos usuarios distintos en la misma maquina (cuentas distintas):
- Cada cuenta tiene su propio `~/.config/recall/keys/`.
- Si ambos comparten el folder del proyecto (poco comun), cada uno necesita
  unlock con la clave en su propia HOME.

---

## 10. Privacidad: `mem.forget`

Tool que el cliente expone al usuario para borrado deliberado:

```typescript
mem.forget({
  query: string;             // describe lo que quiere olvidar
  confirm_ids?: string[];    // si especifica, borra solo esos
})
```

Workflow:
1. Cliente llama sin `confirm_ids` con un query.
2. MCP devuelve lista de candidatos por similaridad.
3. Usuario confirma cuales borrar.
4. Cliente llama de nuevo con `confirm_ids`.
5. MCP los marca como pruned permanente (no recoverable).

Para wipe completo:
```bash
recall wipe --workspace . --confirm
```

---

## 11. Comparativa de los 3 modos

| Aspecto | Shared | Encrypted | Private |
|---|---|---|---|
| Compartir con equipo | Si, automatico | Si, con clave | No |
| Visible en code review | Si (diffs legibles) | No (diffs binarios) | N/A |
| Riesgo de leak por commit | Alto si secrets en DB | Bajo (cifrado) | Cero |
| Onboarding de nuevo dev | Inmediato | Requiere recibir clave | Empieza vacio |
| Latencia de operaciones | Baseline | +10-20% | Baseline |
| Recovery si pierdes clave | N/A | Imposible (es la promesa) | N/A |
| Rotacion de acceso | N/A | `recall rekey` | N/A |
| Setup | Cero | Generar y compartir clave | Cero |

---

## 12. Anti-patrones

| Anti-patron | Por que mal | Solucion |
|---|---|---|
| Committear `.recall/` en modo `private` | Filtra info aunque el usuario crea que no | Hook pre-commit valida modo |
| Compartir la clave por chat publico | La clave queda logueada | Documentar canal seguro (password manager) |
| Asumir que `shared` es seguro porque el repo es privado | El repo puede volverse publico, mirrors pueden filtrar | Si hay info sensible, usar `encrypted` |
| Mezclar info personal en proyecto compartido | Otro dev ve tus notas privadas | Para info personal usa modo `private` o `~/.claude/CLAUDE.md` |
| No instalar el pre-commit hook en `private` | Se puede committear por error | Auto-prompt al inicializar modo private |
| Hard-code clave en CI sin rotacion | Si CI se compromete, todo se compromete | Usar secrets manager + rotacion periodica |
