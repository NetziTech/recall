# 10 — Comparativa con alternativas

> Por que construir esto en lugar de usar X. Analisis honesto, sin barrer
> contras del producto propio.

---

## 1. Resumen de la matriz

| Solucion | Memoria por proyecto en repo | Recuperacion semantica | Compartir con equipo | Cifrado opt-in | Decay | Local-first | Maturity |
|---|---|---|---|---|---|---|---|
| HANDOFF.md / CLAUDE.md manual | ✓ (texto plano) | ✗ | ✓ (manual) | ✗ | ✗ | ✓ | Production |
| OpenMemory MCP (Mem0) | ✗ (centralizado) | ✓ | ✗ | ✗ | Limitado | ✓* | Beta |
| Mem0 Cloud | ✗ | ✓ | ✓ | Server-side | ✓ | ✗ | Production |
| Letta / MemGPT | ✗ | ✓ | ✗ | ✗ | ✓ | ✓* | Beta |
| Anthropic memory tool (cookbook) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | Demo |
| Cursor / Claude Code memory built-in | ✓ (estatico) | ✗ | ✓ | ✗ | ✗ | ✓ | Production |
| **MCP Memoria Inteligente (este)** | **✓ (estructurada + indexada)** | ✓ (hybrid) | ✓ (3 modos) | ✓ (SQLCipher) | ✓ | ✓ | Spec |

*Local-first si se autohostea.

---

## 2. La gran diferencia: memoria-en-proyecto

Casi todas las alternativas centralizan la memoria fuera del proyecto:
- Mem0 / OpenMemory: en backend (cloud o autohosteado).
- Letta: en su DB.
- Cookbook: en JSON local del usuario.
- HANDOFF.md / CLAUDE.md: en el proyecto pero como texto plano sin
  recuperacion selectiva.

**Este MCP es el unico que combina:**
- Memoria estructurada e indexada (no texto plano).
- Vive dentro del proyecto (no centralizada).
- Compartible via git (3 modos de privacidad).
- Recuperacion selectiva por turno.
- Auto-curacion (decay, consolidacion).

Esa combinacion es nueva en el mercado.

---

## 3. vs HANDOFF.md / CLAUDE.md manual (status quo)

### Lo bueno del status quo

- Cero infraestructura.
- Versionado en Git con el codigo.
- Legible por humanos.
- Funciona ya.

### Lo malo

- **Crece sin control.** A los 6 meses, HANDOFF.md tiene 800 lineas.
  Claude lee todo, gasta 4-6K tokens cada turno solo en setup.
- **Manual.** El dev tiene que recordar actualizarlo. Casi nunca pasa.
- **Sin recuperacion selectiva.** Todo o nada.
- **Sin semantica.** "¿que decision tomamos sobre X?" requiere grep.
- **Sin decay.** Lecciones obsoletas siguen pesando.
- **Sin estructura.** Decisions, learnings, tasks mezclados en prosa.

### Cuando seguir con HANDOFF.md

- Proyecto chico (< 1 mes de duracion).
- Solo developer, sin compartir contexto.
- Aversion a deps externos.

### Cuando migrar al MCP

- Proyecto activo > 3 meses.
- Sesiones frecuentes con Claude.
- Equipo de 2+ devs.
- HANDOFF.md ya pasa de 200 lineas.

Migracion: `mcp-memoria import-handoff`.

---

## 4. vs OpenMemory MCP (Mem0)

[OpenMemory MCP](https://github.com/mem0ai/openmemory) es un proyecto
open-source de Mem0 que expone su memoria como MCP server.

### Diferencias clave

| Aspecto | OpenMemory MCP | MCP Memoria Inteligente |
|---|---|---|
| Filosofia | Memoria del agente (lo que el LLM aprende del usuario) | Memoria del proyecto (lo que vale para el codigo) |
| Estructura | Plana: "facts" con tags | Tipada: decisions, learnings, tasks, entities, relations |
| Capas de contexto | No | Si (7 capas con presupuestos) |
| Decay | Implicito | Explicito y configurable por kind |
| Self-healing | No | Si (path stale, decision conflicts, etc.) |
| Memoria por proyecto | Si pero en server, no en repo | En repo (`<proyecto>/.mcp-memoria/`) |
| Cifrado | No nativo | SQLCipher en modo `encrypted` |
| Compartir con equipo | Si pero requiere server compartido | Via git (modos shared/encrypted) |
| Stack | Python + Qdrant + opcional Mem0 cloud | TS + sqlite-vec, sin cloud |
| Setup | Docker compose para Qdrant | Single binary via npx |

### Filosofia

OpenMemory esta optimizado para chatbots conversacionales: "el usuario
me dijo que su perro se llama Pepe". Es plano y semantico, en server.

Este MCP esta optimizado para **proyectos de software**: hay decisiones
arquitectonicas (con rationale + alternatives), entidades del codigo
(con relaciones), tareas, fases. La estructura tipada ayuda al recall, y
la memoria viaja con el codigo.

### Cuando elegir OpenMemory

- Quieres MCP de memoria generica (chatbot personal, no solo codigo).
- Aceptas Docker + Qdrant.
- Quieres usar la nube de Mem0 como upgrade path.

### Cuando elegir este

- Trabajas codigo principalmente.
- Quieres single-binary setup.
- Necesitas que la memoria viaje con el proyecto.
- Te importa decay con politica clara.
- Quieres compartir memoria con el equipo via git.

---

## 5. vs Mem0 Cloud

Mem0 SaaS ofrece "memoria como servicio".

### Trade-offs

| Aspecto | Mem0 Cloud | Este MCP |
|---|---|---|
| Setup | API key | npm install |
| Costo | Pay-per-use | Gratis |
| Privacy | Tu data en sus servers | 100% local + cifrado opt-in |
| Latencia | ~150ms (red) | ~50ms (local) |
| Customizacion | Limitada | Total |
| Multi-maquina sync | Built-in | Via git (modo shared/encrypted) |
| Maturity | Mas avanzado | Spec |

### Cuando Mem0 Cloud

- Equipos grandes con sync multi-maquina critico (sin git).
- Aceptas que codigo cliente pasa por sus servers.
- Quieres cero mantenimiento.

### Cuando este

- Privacy del codigo es no-negociable.
- No quieres dependencia cloud.
- Tu equipo ya usa git para colaborar.

---

## 6. vs Letta / MemGPT

[Letta](https://www.letta.com/) (antes MemGPT) es framework para agentes
con memoria estilo "OS" (paginacion entre core memory y archival memory).

### Diferencias

| Aspecto | Letta | Este MCP |
|---|---|---|
| Categoria | Framework de agentes | Servidor MCP de memoria |
| Acoplamiento | Acoplado al runtime de agente | Standalone, cualquier cliente MCP |
| Concepto | Core memory (en context) + archival (off-context) | Capas tipadas + retrieval selectivo |
| Self-modification | Agente auto-edita memoria | Cliente registra explicitamente |
| Use case | Agentes long-running standalone | Augment Claude Code y similares |
| Memoria por proyecto | No nativo | Nativo en repo |

### Cuando Letta

- Construyes un agente full custom (no usas Claude Code).
- Necesitas auto-edicion de memoria por el agente.
- Estas dispuesto a pagar la complejidad del framework.

### Cuando este

- Usas un cliente MCP existente (Claude Code, Cursor, etc.).
- Quieres "complementar" tu cliente actual, no reemplazar el runtime.
- La memoria debe vivir en el proyecto.

Son productos para usos distintos. No competidores directos.

---

## 7. vs Anthropic memory tool (cookbook)

Anthropic publico un cookbook con un memory tool que muestra como darle a
Claude memoria estructurada.

### Diferencias

| Aspecto | Cookbook | Este MCP |
|---|---|---|
| Forma | Tutorial / ejemplo | Producto distribuible |
| Storage | JSON file simple | SQLite + FTS5 + vectors |
| Recuperacion | Lectura completa | Selectiva con re-ranking hybrid |
| Categorias | Generales | Tipadas (decisions, learnings, ...) |
| Decay | No | Si |
| Cifrado | No | SQLCipher opt-in |
| Por proyecto | Manual | Nativo |

El cookbook es excelente como **proof of concept**. Para uso continuo en
proyectos grandes, falta lo que este MCP ofrece.

---

## 8. vs CLAUDE.md / .cursorrules built-in

Cursor tiene "rules" en `.cursorrules`. Claude Code tiene `CLAUDE.md`.
Ambos son archivos estaticos.

### Diferencias

| Aspecto | CLAUDE.md/.cursorrules | Este MCP |
|---|---|---|
| Forma | Archivo estatico texto plano | Memoria dinamica indexada |
| Updates | Manuales | Por tool call durante la sesion |
| Recuperacion | Todo o nada (todo el archivo se inyecta) | Selectiva por capas |
| Tipado | Texto libre | Estructurado (decisions, learnings, etc.) |
| Decay | No | Si |
| Cifrado | No | SQLCipher opt-in |
| Acumulacion automatica | No | Si |

`CLAUDE.md` y este MCP son **complementarios**, no excluyentes:
- `CLAUDE.md` define la "constitucion" no negociable y reglas inmutables del
  USUARIO (preferencias globales del dev).
- El MCP captura las decisiones operativas del PROYECTO, lecciones, y
  memoria viva.

Recomendacion: usar ambos.
- `~/.claude/CLAUDE.md` para reglas eternas del usuario (conventional
  commits, espanol siempre, etc.).
- `<proyecto>/CLAUDE.md` para reglas eternas del proyecto que casi nunca
  cambian.
- MCP para todo lo dinamico del proyecto.

---

## 9. vs LangMem (LangChain)

LangMem es la solucion de memoria de LangChain.

### Diferencias

| Aspecto | LangMem | Este MCP |
|---|---|---|
| Acoplamiento | Acoplado a LangChain | Standalone MCP |
| Stack | Python | TypeScript |
| Storage | Backend pluggable (Postgres, Pinecone, ...) | sqlite-vec local en repo |
| Categorias | Semantic, episodic, procedural | Tipadas por kind del proyecto |
| Setup | Compleja (LangChain + DB + embeddings) | Single command |
| Memoria viaja con repo | No | Si |

LangMem es para gente ya en el ecosistema LangChain. Este MCP es para quien
quiere memoria como servicio independiente.

---

## 10. vs Custom: hand-rolled MCP

Algunos devs construyen sus propios MCP servers de memoria con scripts.
Tipicamente:
- 200 lineas de Python con SQLite.
- Sin embeddings.
- Sin curador.

### Ventajas hand-roll

- Conoces exactamente que hace.
- Total control.
- Cero deps.

### Desventajas

- Sin embeddings → recall pobre.
- Sin curador → DB crece.
- Sin distribucion → solo tu lo usas.
- Sin tests/maintenance → bugs crecen.
- Sin cifrado serio → no compartible con seguridad.

### Recomendacion

Si tu use case es muy especifico Y vas a invertir tiempo, hand-roll. Si
quieres algo que funcione manana, usar este.

---

## 11. Decision rapida

```
¿Trabajas mucho con Claude en proyectos > 3 meses?
├─ NO → Sigue con HANDOFF.md
└─ SI →
    ¿Trabajas en equipo y quieres compartir memoria?
    ├─ SI →
    │   ¿La info del proyecto es sensible?
    │   ├─ SI → Este MCP modo `encrypted` (compartir cifrado via git)
    │   └─ NO → Este MCP modo `shared` (compartir plano via git)
    └─ NO →
        ¿Quieres tu memoria personal del proyecto?
        ├─ SI → Este MCP modo `private` (en .gitignore)
        └─ NO → Este MCP modo `shared` igual; nunca esta de mas
```

---

## 12. Honestidad: cuando NO usar este MCP

Casos donde este MCP no es la mejor solucion:

- **Proyecto efimero (< 1 mes).** Overhead no compensa.
- **Solo una sesion de Claude por semana.** Memoria no acumula valor.
- **Equipo grande > 10 devs con maquinas distribuidas globalmente.**
  Compartir via git puede generar conflictos; un servicio centralizado
  (Mem0 cloud) puede escalar mejor.
- **Codigo en lenguaje exotico.** Embeddings funcionan peor; revisar modelo
  apropiado o usar Voyage.
- **Maquina muy limitada (Raspberry).** fastembed pesa; podria no caber.
- **Necesitas memoria conversacional pura del usuario** (chatbot tipo
  asistente personal). Mem0 / OpenMemory es mejor para eso.

---

## 13. Honestidad: limitaciones conocidas

Lista pre-acordada de cosas que el MCP NO va a hacer bien (al menos en v1):

- **Memorias cualitativas/emocionales.** Esto es para codigo, no para
  conversaciones personales.
- **Sumarizar transcripts largos automaticamente.** El cliente debe enviar
  resumenes (o el MCP genera un summary basico al rollup de sesion).
- **Resolver contradicciones automaticamente.** Solo las detecta y avisa.
- **Sync en tiempo real entre maquinas sin git.** Si quieres modo `private`
  sincronizado, necesitas Dropbox/Syncthing manual.
- **Comprehension multi-turn de conversaciones.** Cada turno se procesa
  independiente.
- **Auto-aplicar lecciones al codigo.** Solo recuerda; no actua.
- **Recovery si pierdes la clave en modo `encrypted`.** Es la promesa del
  cifrado. Mitigado con multi-key (v0.5+) y recovery codes (v1.0+).

---

## 14. Migracion entre soluciones

### De HANDOFF.md → este MCP

Comando incluido: `mcp-memoria import-handoff`. Parsea heuristicamente.

### De Mem0 → este MCP

Mem0 expone export JSON. Script de migracion (no incluido por default,
trivial de escribir):

```typescript
const mem0Data = await fetch("https://api.mem0.ai/v1/memories/export", ...);
for (const fact of mem0Data) {
  await mcpClient.call("mem.remember", {
    kind: "learning",
    content: fact.text,
    tags: fact.tags,
    scope: "project",
  });
}
```

### De este MCP → Mem0 / otro

`mcp-memoria export --workspace .` devuelve JSON estructurado. Script de
import al destino.

**Promesa:** la memoria es portable. El usuario nunca queda atado.

---

## 15. Resumen ejecutivo de la diferencia

Este MCP es el unico que ofrece:

1. **Memoria-en-proyecto:** vive en `<proyecto>/.mcp-memoria/`, viaja con
   el codigo.
2. **3 modos de privacidad:** compartido / encriptado (SQLCipher) /
   privado.
3. **Hybrid search nativo:** BM25 (FTS5) + cosine (sqlite-vec).
4. **Single binary:** sin Docker, sin Qdrant, sin Postgres.
5. **Tipado del dominio de software:** decisions, learnings, entities con
   relaciones.
6. **Decay configurable por kind:** crit no decae, decisions casi no, turns
   rapido.
7. **Compatible con cualquier cliente MCP:** Claude Code, Cursor, Cline.
8. **Open-source compatible:** modo shared permite que repos publicos
   tengan memoria visible.
9. **Equipo-friendly:** memoria del equipo via git, no via servidor
   compartido.
10. **Privacy-first:** local, opt-in cifrado, opt-out cloud, deteccion de
    secrets en 5 capas.
