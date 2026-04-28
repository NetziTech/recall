# MCP Memoria Inteligente

> Servidor MCP (Model Context Protocol) que da a Claude Code memoria
> persistente, selectiva y auto-curada **por proyecto**, viviendo dentro del
> propio proyecto.

---

## Estructura del repositorio

```
.
├── docs/             # Documentacion completa (especificacion + lineamientos)
├── code/             # Implementacion del servidor MCP (TypeScript)
├── .claude/agents/   # 13 agentes especialistas para construir y validar
└── README.md         # Este archivo
```

---

## Por donde empezar

### Si quieres entender el producto

Lee la documentacion en orden:

1. [docs/README.md](./docs/README.md) — resumen ejecutivo + indice completo
2. [docs/01-arquitectura.md](./docs/01-arquitectura.md) — vision tecnica
3. [docs/11-seguridad-modos.md](./docs/11-seguridad-modos.md) — los 3 modos
   (compartido / encriptado / privado)

### Si quieres usarlo (cuando exista el binario)

1. [docs/07-instalacion.md](./docs/07-instalacion.md)
2. [docs/08-casos-uso.md](./docs/08-casos-uso.md)

### Si quieres implementarlo desde cero

**Antes de cualquier linea de codigo, leer:**
1. [docs/12-lineamientos-arquitectura.md](./docs/12-lineamientos-arquitectura.md) — Clean + Hexagonal + DDD + SOLID + modularidad estricta + cero `any`
2. [docs/13-workflow-agentes.md](./docs/13-workflow-agentes.md) — 13 agentes especialistas, ciclo de validacion, SonarQube

**Luego:**

3. [docs/09-roadmap.md](./docs/09-roadmap.md) — plan MVP en 1 semana
4. [docs/06-stack-tecnico.md](./docs/06-stack-tecnico.md) — stack y libs
5. [docs/02-protocolo-mcp.md](./docs/02-protocolo-mcp.md) — contrato de
   tools que el servidor expone
6. [docs/03-modelo-datos.md](./docs/03-modelo-datos.md) — schemas SQLite

---

## Estado del proyecto

- **Documentacion (docs/):** completa. Spec + lineamientos + workflow listos.
- **Agentes (.claude/agents/):** 13 agentes definidos, listos para
  implementar.
- **Codigo (code/):** sin implementar aun. Plan en
  [docs/09-roadmap.md](./docs/09-roadmap.md), construccion gobernada por
  [docs/13-workflow-agentes.md](./docs/13-workflow-agentes.md).

## Reglas no-negociables

Todo el codigo debe cumplir 6 lineamientos absolutos (detalle en
[docs/12-lineamientos-arquitectura.md](./docs/12-lineamientos-arquitectura.md)):

1. **Clean Architecture** — dependencias apuntan al dominio
2. **DDD** — entidades, VO, agregados, ubiquitous language
3. **Hexagonal** — puertos en domain/application, adapters en infrastructure
4. **SOLID** — los 5 principios validados por agente
5. **Modularidad estricta** — modulos no se importan entre si; solo `shared/`
6. **Cero `any`** — type-safety total con `tsc --strict`

Validados por 6 agentes auditores en ciclo. SonarQube quality gate con
**cobertura ≥95%**, code smells 0, security rating A.

---

## Idea en 30 segundos

Cada proyecto guarda su memoria en `<proyecto>/.recall/`. La memoria
viaja con el codigo cuando lo clonas. Tres modos:

| Modo | Que ocurre |
|---|---|
| **Compartido** (default) | Memoria en git plano — el equipo la ve |
| **Encriptado** | Memoria en git cifrada con SQLCipher — el equipo necesita clave |
| **Privado** | Memoria en `.gitignore` — solo en tu maquina |

Claude Code (u otro cliente MCP) llama a tools como `mem.context`,
`mem.recall`, `mem.remember` para persistir y recuperar memoria estructurada
con hybrid search (BM25 + vectorial). El curador hace decay,
consolidacion y self-healing en background.

Detalle completo en [docs/](./docs/).
