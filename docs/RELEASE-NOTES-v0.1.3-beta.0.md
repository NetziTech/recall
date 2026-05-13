# `@netzi/recall@0.1.3-beta.0`

**Release date:** 2026-05-13
**Channel:** `beta` (npm dist-tag).
**Stable predecessor:** `0.1.2` (canal `latest`, sigue activo).
**Tag:** [`v0.1.3-beta.0`](https://github.com/NetziTech/recall/releases/tag/v0.1.3-beta.0).

---

## Por qué este release

El cycle Phase-22 → Phase-27 acumuló 84 commits sobre `develop`
(iteración 2 ADR-005 multi-key envelope flow completa, todos los
items MEDIUM cerrados, plus el swap del backend del embedder). El
último HIGH bloqueante (`swap-embedder-tar7`) cerró en PR
[#97](https://github.com/NetziTech/recall/pull/97) y desbloqueó el
release. Política durable Phase-25 cumplida: §8 OPEN HIGH = 0,
MEDIUM = 0.

`0.1.3-beta.0` es **beta** porque introduce un **breaking change
silencioso para usuarios `0.1.x`** (vectores embedded antes del swap
quedan numéricamente obsoletos; ver §3). Antes de promover a stable
`0.1.3` queremos al menos un cycle real de dogfood interno + smoke
fresh contra clientes MCP reales.

---

## 1. Cambios destacados

### 1.1 Swap del backend del embedder — `fastembed` → `@huggingface/transformers`

**El cambio.** `FastembedEmbedder` removido del adapter graph; el
único backend ahora es `TransformersEmbedder` sobre
`@huggingface/transformers@^4.2.0`. Misma dimensión (384), mismo
modelo conceptual (BGE-small-en-v1.5), L2-normalisation preservada.

**Por qué.** `fastembed@2.x` dependía transitivamente de `tar@^6`,
con 6 advisories high-severity (path traversal / symlink poisoning).
Upstream `fastembed` no tenía timeline para bumpear a `tar@7`.
`@huggingface/transformers` es el mismo equipo de HuggingFace,
actively maintained, y reporta 0 advisories.

**Efecto en `npm audit`.**
```
0.1.2 :  2 high vulnerabilities (tar)
0.1.3 :  0 vulnerabilities
```

**Performance (POC parity 2026-05-13 — ver
`scripts/embedder-parity-smoke.ts`).**

| Backend | dim | cold-start | warm batch (x2) | L2-norm |
|---|---|---|---|---|
| `fastembed` `BGESmallENV15` (v0.1.2) | 384 | 266 ms (cache) | 229 ms | 1.0000 |
| `transformers` `Xenova/bge-small-en-v1.5` (v0.1.3) | 384 | 8.8 s (download ~50 MB) | **3.5 ms** | 1.0000 |

El cold-start de transformers es mayor sólo en cold cache (descarga
del modelo); cae en el `AsyncEmbeddingWorker` y nunca bloquea el hot
path de `mem.recall` (lazy adapter + FTS5 fallback). Warm batch es
≈65× más rápido — `mem.recall p95 < 100 ms` y
`mem.context p95 < 200 ms` se mantienen.

### 1.2 ADR-005 multi-key envelope flow completo

Los 3 facades del flujo multi-key acabaron en `0.1.3-beta.0`:
- `recall add-key` ([#80](https://github.com/NetziTech/recall/pull/80))
  añade una nueva passphrase sin destruir la activa.
- `recall rekey` ([#81](https://github.com/NetziTech/recall/pull/81))
  rota la passphrase activa preservando data.
- `recall export-key` ([#82](https://github.com/NetziTech/recall/pull/82))
  emite una recovery key (PrintableMasterKey, Bech32 BIP-173).

Cada facade emite eventos de auditoría (`encryption.audit_log`,
migration 009, sólo append-only) y reporta `last_export_at` en
`recall health` ([#92](https://github.com/NetziTech/recall/pull/92)).

### 1.3 Hardening defensivo (Phase-23 → Phase-27)

- **`secureZero`** ahora vive en `shared/infrastructure/crypto/` y
  se invoca en cada lifecycle de master-key
  ([#73](https://github.com/NetziTech/recall/pull/73)).
- **`Vec0SimilarityFinder`** lookup `2N → N+1` via
  `WHERE id IN (?, ?, …)` — cierra `W-3.4-PERF-H3`
  ([#74](https://github.com/NetziTech/recall/pull/74)).
- **`markPrunedBatch`**: 1 transaction vs N fsyncs — cierra
  `W-3.4-PERF-H2`
  ([#69](https://github.com/NetziTech/recall/pull/69)).
- **Path-leak fix** en 12 `Error` factories (workspace / secrets /
  curator), patrón `details: { path }` — cierra `W-3.5-SEC-L2`
  ([#66](https://github.com/NetziTech/recall/pull/66)).
- **Pino redact** de `printableMasterKey` + ESLint isolation rule
  para `.toHex()` y `master_key_fp` fuera de
  `sqlite-encryption-audit-repository.ts`
  ([#85](https://github.com/NetziTech/recall/pull/85),
   [#86](https://github.com/NetziTech/recall/pull/86)).
- **`UnlockFailed` audit** para AddKey / Rekey / ExportKey ante
  wrong-passphrase ([#89](https://github.com/NetziTech/recall/pull/89)).
- **`db.prepare()` cache** en hot path retrieval + curator — cierra
  `W-3.3-PERF-M1/M2` y `W-3.4-PERF-M1/M2`
  ([#90](https://github.com/NetziTech/recall/pull/90)).
- **`withUnlockedKey` batched** en AddEnvelope (3→1), Export (2→1) y
  Rekey (3→2), reduciendo sitios de master-key disclosure
  ([#93](https://github.com/NetziTech/recall/pull/93)).

### 1.4 Stack bumps

- `typescript`: 5.9.3 → 6.0.3.
- `@types/node`: ^24 → ^25.7.0.
- `vitest` group: 3.x → 4.1.6 (+ `@vitest/coverage-istanbul@4.1.6`).
- Node runtime CI: **24.15.0 LTS Krypton**.
- `@huggingface/transformers`: NEW ^4.2.0.
- `fastembed`: REMOVED.

---

## 2. ADR + spec docs

- **ADR-005** — multi-key envelope flow — **ACCEPTED**
  (`docs/12-lineamientos-arquitectura.md §1.5.5`).
- **ADR-006** — OS keychain <500 ms cold start — **PROPOSED**
  (defer: SLO <1500 ms aceptable; OWASP 2024 Argon2id floors no
  negociables).
- `docs/11-seguridad-modos.md §3` añade:
  - "Formato de la clave de recuperación" — spec Bech32 BIP-173 con
    test vectors V1/V2/V3.
  - "Modelo de amenazas multi-key" — qué protege / no protege el
    flujo, con diagrama 2-paths.

---

## 3. Breaking change para usuarios `0.1.x` (importante)

Los vectores `embedding_metadata` persistidos por `fastembed`
(v0.1.0 → v0.1.2) son **numéricamente diferentes** de los que
produce `@huggingface/transformers` para el mismo texto — el ONNX
export y el tokenizer pre-processing son distintos. La dimensión se
preserva (384), así que el `vec0` table no requiere recreate, pero:

- **Recall quality degrada** sobre el corpus pre-existente hasta que
  se re-embed.
- El re-embed ocurre **orgánicamente** vía
  `AsyncEmbeddingWorker` cuando el `embedder_version` bump propaga
  (la siguiente vez que el worker drena `embedding_queue`).
- **Force-refresh** opcional: `recall reset-queue` re-encola todas
  las filas (incluyendo las que fast-fallaron en cycles previos).

`config.json` con `embedder.provider: "fastembed"` sigue siendo
parseable como back-compat lectura — `EmbedderSpec` mantiene
`"fastembed"` como provider legal. La instalación fresh escribe
`embedder.provider: "transformers"` + `model: "Xenova/bge-small-en-v1.5"`.

---

## 4. Footprint de instalación

`@huggingface/transformers` trae deps que `recall` no usa en Node
(`onnxruntime-web` ~130 MB, `sharp` ~600 KB), agregando
≈+147 MB al `node_modules/`. La install footprint pasa de ~50 MB
(fastembed) a ~226 MB. Tracked en `HANDOFF.md` §8 como
`transformers-install-footprint` (low priority; investigar si la lib
permite excluir el `onnxruntime-web` target en futuras versiones).

---

## 5. Validadores arquitectónicos

Cada PR del cycle Phase-22 → Phase-27 ejecutó la regla durable
Phase-21 (pre-merge validators sobre cualquier cambio de
`code/src/`). Para `0.1.3-beta.0` el aggregate de validadores reporta
**APROBADO**:

- `clean-architecture-validator` — 8 modulos + shared + composition;
  dependencias correctas; ADR-001 cross-imports intactos.
- `solid-validator` — cero `any` / `ts-ignore` / unsafe `as`; strict
  type-safety total.
- `ddd-validator` — VOs inmutables; agregados emiten eventos en past
  tense; ubiquitous language.
- `security-auditor` — OWASP Top 10 + criptografía + secret leakage.
- `performance-auditor` — `mem.recall p95 < 100 ms`,
  `mem.context p95 < 200 ms`, `mem.remember p95 < 30 ms`,
  cold-start encrypted < 1500 ms.
- `qa-sonarqube-auditor` — quality gate `MCP Memoria Strict`:
  coverage 95.8% global / 96.6% new, 0 bugs / 0 vulns / 0 blockers,
  rating A en reliability + security + maintainability.

---

## 6. Cómo probar

```bash
# Fresh install desde npm canal beta
npx --yes @netzi/recall@beta init /path/to/workspace

# O instalación global
npm install -g @netzi/recall@beta
recall init /path/to/workspace

# Inspección
recall health           # debe reportar embedder: transformers:Xenova/bge-small-en-v1.5
recall audit            # estado de las 5 capas de detección de secrets
```

Configuración MCP (`~/.claude/claude_desktop_config.json` o
equivalente):

```jsonc
{
  "mcpServers": {
    "recall": {
      "command": "recall-server",
      "args": [],
      "env": {}
    }
  }
}
```

---

## 7. Próximos pasos antes de `0.1.3` stable

1. **Smoke fresh** end-to-end (workspace 100% nuevo, cualquier OS
   target) ejecutando los 10 checks del `0.1.2` stable promote
   (HANDOFF §6.21):
   `init`, `health`, `tools/list`, `mem.health` pre + post, 3
   writes, `mem.recall hits >= 1`, `mem.context 7 layers`,
   `mem.task UUID v7`.
2. **Dogfood interno** por al menos 48 h con tracking de issues
   surfaced contra `0.1.3-beta.0`.
3. Cerrar **al menos 1 de los 2 LOW restantes** (FP-A5-2 Buffer
   end-to-end o FP-A5-4 envelope-pending) si surgen en el cycle.
4. Si surface 0 bugs nuevos → promote `0.1.3` a `latest`,
   deprecate `0.1.2`.

---

## 8. Notas históricas

- **84 commits** sobre `main` cuando se cortó el release.
- **2822 tests** passing (231 files).
- **Coverage SonarQube agregado:** 95.8% overall + 96.6% new code.
- **Branch protection:** `main` PR-only, `develop` default branch,
  squash-only merges, enforce_admins activo.
- **GitHub release page:** https://github.com/NetziTech/recall/releases/tag/v0.1.3-beta.0
- **`HANDOFF.md` §6.32 → §6.33** documenta el POC del swap y el
  cycle Phase-28.
