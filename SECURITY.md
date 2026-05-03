# Security Policy

## Versiones soportadas

`0.1.2` es la version **stable** activa (canal `latest`). Todas las
betas previas y las versiones `0.1.0`/`0.1.1` estan hard-deprecadas
en npm.

| Version | Soportada | Razon |
|---|---|---|
| **`0.1.2` (latest)** | **si** | **canal stable**; primer release stable de `@netzi/recall` promovido desde `0.1.2-beta.6`. Consolida 8 fixes del cycle `0.1.2-beta.*` (B-MCP-1..8 + carryover `serverInfo.version`). |
| `0.1.2-beta.6` | no | superseded por `0.1.2` stable (mismo codigo, distinto dist-tag) |
| `0.1.2-beta.5` | no | superseded; cerro B-MCP-8 |
| `0.1.2-beta.4` | no | superseded; cerro B-MCP-7 |
| `0.1.2-beta.3` | no | superseded; cerro B-MCP-2..5 |
| `0.1.2-beta.0` | no | superseded por `0.1.2-beta.3` |
| `0.1.1` | no | hard-deprecada por bugs B-MCP-2..5/7/8 (cerrados en el cycle beta) y carryover `serverInfo.version`. Migrar a `0.1.2`. |
| `0.1.0` | no | hard-deprecada por B-MCP-1 (Phase-8). Migrar a `0.1.2`. |

Roadmap de v0.5+: ver
[HANDOFF.md §6.21](./HANDOFF.md) +
[release notes](./docs/RELEASE-NOTES-v0.1.2.md).

---

## Reportar una vulnerabilidad

**No abras issues publicos para vulnerabilidades.** Si encuentras una,
reporta de forma privada por uno de estos canales:

1. **GitHub Private Vulnerability Reporting** (preferido):
   https://github.com/NetziTech/recall/security/advisories/new
2. **Email**: `henry@nexusapps.net` con asunto
   `[security] @netzi/recall: <breve resumen>`

Incluye:
- Version afectada (`recall --version` o `npm list -g @netzi/recall`)
- Repro steps minimos
- Impacto esperado (RCE, data leak, DoS, etc.)
- Si tienes un fix propuesto, mejor

## Tiempo de respuesta esperado

| Severidad | Acuse de recibo | Fix target |
|---|---|---|
| Critical (RCE, key leak, data corruption) | <48h | <7 dias |
| High | <72h | <14 dias |
| Medium | <1 semana | proximo release |
| Low | <2 semanas | backlog v0.5+ |

Trabajamos en horario LATAM/Madrid; respuestas pueden retrasarse en
fines de semana y feriados.

---

## CVEs upstream conocidos (wontfix con mitigacion)

Documentadas en
[ADR-004](./docs/12-lineamientos-arquitectura.md#154-adr-004) y
release notes:

- **GHSA-34x7-hfp2-rc4v** — `tar@6.x` path-traversal en extraccion
- **GHSA-83g3-92jg-28cx** — `tar@6.x` symlink poisoning

Ambas heredadas via `fastembed@^2.0.0` (que usa `tar@6` y rompe con
`tar@7` por incompat ESM). Vector real: download de modelos
embedding desde GCS de Qdrant (no HuggingFace, contrario a la doc
v0.1.0). Likelihood real bajo (compromise de bucket GCS o TLS MITM
con CA comprometida). Reapertura prevista en v0.5: swap a
`@huggingface/transformers` si fastembed no publica con tar@7 antes.

---

## Modelo de amenaza

`recall` corre como CLI single-user, sin red expuesta. La superficie
de ataque relevante es:

1. **Datos persistidos** (`<proyecto>/.recall/recall.db`):
   - Modo encriptado: SQLCipher AES-256, KDF argon2id
     (memoria 64 MiB, 3 iter, 4 parallelism — OWASP 2024).
   - Modo privado: archivo en `.gitignore`, permisos heredados del FS.
   - Modo compartido: en git plano (responsabilidad del equipo).
2. **Secrets en texto** que se intentan persistir como memoria:
   detectados en 5 capas (regex, entropy Shannon, path sanitizer,
   pre-commit hook, audit log) — modulo `secrets/`.
3. **Path traversal en migraciones**:
   `MigrationsRunner` filtra entries con regex
   `^(\d+)__([\w-]+)\.sql$` antes de `path.join`.
4. **Logger redaction**: pino con `DEFAULT_REDACT_PATHS` (13 keys
   + wildcards) evita leak de claves/passphrase a stdout.

Detalle: [docs/11-seguridad-modos.md](./docs/11-seguridad-modos.md).

---

## Quality gate de seguridad

Cada PR a `main` o `develop` corre el workflow
[`ci`](./.github/workflows/ci.yml) que incluye SonarQube quality gate
strict:

- Reliability rating A
- Security rating A
- Security review rating A
- 0 vulnerabilities, 0 bugs
- 0 blockers, 0 critical

Si el gate falla, el PR no merge.

Resultados publicos: https://sonar.netzi.dev/dashboard?id=recall.
