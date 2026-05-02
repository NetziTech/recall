# `@netzi/recall`

> Servidor MCP (Model Context Protocol) que da a Claude Code (y cualquier
> cliente MCP) **memoria persistente, selectiva y auto-curada por proyecto**,
> viviendo dentro del propio proyecto (`<repo>/.recall/`), no en HOME.

[![npm version](https://img.shields.io/npm/v/%40netzi%2Frecall/beta?label=npm%40beta)](https://www.npmjs.com/package/@netzi/recall)
[![license](https://img.shields.io/npm/l/%40netzi%2Frecall.svg)](./code/LICENSE)
[![ci](https://github.com/NetziTech/recall/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/NetziTech/recall/actions/workflows/ci.yml)
[![sonarqube](https://img.shields.io/badge/sonarqube-quality_gate_passed-brightgreen)](https://sonar.netzi.dev/dashboard?id=recall)

> **Estado del canal:** beta. `v0.1.2-beta.3` cierra **los 4 bugs**
> descubiertos en el dogfood de Phase-9 (B-MCP-2/3/4/5 — semantic
> recall, mem.health real state, decision content persistence,
> mem.recall min_score). La version `0.1.1` (canal `latest`) sigue
> deprecada hasta que `0.1.2` stable salga. Ver
> [release notes](./docs/RELEASE-NOTES-v0.1.2-beta.3.md) +
> [HANDOFF.md §6.16](./HANDOFF.md).

---

## Idea en 30 segundos

Cada proyecto guarda su memoria en `<proyecto>/.recall/`. La memoria viaja
con el codigo cuando lo clonas, lo mueves, lo compartes. Tres modos:

| Modo | Que ocurre |
|---|---|
| **Compartido** (default) | Memoria en git plano — el equipo la ve |
| **Encriptado** | Memoria en git cifrada con SQLCipher — el equipo necesita clave |
| **Privado** | Memoria en `.gitignore` — solo en tu maquina |

El cliente MCP llama `mem.context`, `mem.recall`, `mem.remember`, `mem.task`,
`mem.health` para persistir y recuperar memoria estructurada con hybrid
search (BM25 via FTS5 + cosine via sqlite-vec). El curador hace decay,
consolidacion y self-healing en background.

Diferenciador clave vs Mem0, OpenMemory, LangMem y otros: la memoria **vive
con el codigo**, tiene **3 modos de privacidad nativos**, y el dominio esta
tipado en el lenguaje del software (decisions, learnings, entities, tasks,
turns) en vez de "facts" planos.

---

## Quick start

```bash
# Canal beta (v0.1.2-beta.3 — los 4 bugs de Phase-9 cerrados; pendiente
# de validacion via dogfood antes de promover a stable)
npm install -g @netzi/recall@beta

cd /tu/proyecto
recall init                       # crea <proyecto>/.recall/
recall health                     # verifica install

# Conectar a Claude Code
claude mcp add recall recall-server
```

Detalle completo en [docs/07-instalacion.md](./docs/07-instalacion.md).

---

## Estructura del repositorio

```
.
├── docs/                # Documentacion completa (especificacion + lineamientos)
├── code/                # Implementacion del servidor MCP (TypeScript)
│   ├── src/             # ~58.8k LOC, 8 modulos + shared + composition + bootstrap
│   ├── tests/           # 2501 tests, coverage 96.4%, 205 archivos
│   ├── migrations/      # 8 migraciones SQLite
│   └── package.json     # @netzi/recall
├── .claude/agents/      # 13 agentes especialistas (orquestador + 6 implementadores + 6 validadores)
├── .github/workflows/   # CI: typecheck + lint + validate:modules + build + test:coverage + sonar
├── HANDOFF.md           # Estado del proyecto, decisiones, bugs abiertos, roadmap
├── CONTRIBUTING.md      # GitFlow rules, release flow, hotfix flow, ADR list
└── README.md            # Este archivo
```

---

## Por donde empezar

**Si vas a usarlo:**

1. [docs/07-instalacion.md](./docs/07-instalacion.md) — setup en clientes MCP
2. [docs/08-casos-uso.md](./docs/08-casos-uso.md) — 13 casos de uso end-to-end
3. [docs/02-protocolo-mcp.md](./docs/02-protocolo-mcp.md) — contrato de tools

**Si vas a contribuir:**

1. [CONTRIBUTING.md](./CONTRIBUTING.md) — GitFlow + reglas de PR
2. [docs/12-lineamientos-arquitectura.md](./docs/12-lineamientos-arquitectura.md) — 6 reglas no negociables (Clean + Hexagonal + DDD + SOLID + modularidad estricta + cero `any`)
3. [docs/13-workflow-agentes.md](./docs/13-workflow-agentes.md) — 13 agentes, ciclo de validacion, SonarQube
4. [HANDOFF.md](./HANDOFF.md) — estado completo del proyecto

**Si quieres entender el producto:**

1. [docs/README.md](./docs/README.md) — resumen ejecutivo + indice
2. [docs/01-arquitectura.md](./docs/01-arquitectura.md) — vision tecnica
3. [docs/11-seguridad-modos.md](./docs/11-seguridad-modos.md) — los 3 modos

---

## Reglas no-negociables del codigo

Todo el codigo cumple 6 lineamientos absolutos
([detalle](./docs/12-lineamientos-arquitectura.md)):

1. **Clean Architecture** — dependencias apuntan al dominio
2. **DDD** — entidades, VO, agregados, ubiquitous language
3. **Hexagonal** — puertos en domain/application, adapters en infrastructure
4. **SOLID** — los 5 principios validados por agente
5. **Modularidad estricta** — modulos no se importan entre si; solo `shared/`
6. **Cero `any`** — type-safety total con `tsc --strict`

Validados en CI por SonarQube:
[gate "MCP Memoria Strict"](https://sonar.netzi.dev/dashboard?id=recall),
cobertura ≥95%, 0 bugs / 0 vulnerabilidades / 0 blockers / 0 critical,
ratings A.

---

## Stack

- **TypeScript** strict, Node 20+
- **better-sqlite3-multiple-ciphers** + **sqlite-vec** + **fastembed**
- **@noble/hashes** (argon2id), **pino**, **uuid v7**, **zod**
- **vitest** + **eslint** v9 strict + **tsup**

Detalle: [docs/06-stack-tecnico.md](./docs/06-stack-tecnico.md).

---

## Issues / bugs / preguntas

- [Issues abiertos](https://github.com/NetziTech/recall/issues) — **0**
  al cierre de Phase-11 (los 4 bugs B-MCP-2..5 cerrados en
  `v0.1.2-beta.3` via PRs #17/#18/#19/#20)
- Reportar vulnerabilidades de seguridad: ver
  [SECURITY.md](./SECURITY.md)
- Discusiones generales:
  [GitHub Discussions](https://github.com/NetziTech/recall/discussions)

---

## Licencia

MIT. Ver [code/LICENSE](./code/LICENSE).

Copyright (c) 2026 Netzi Tech.
