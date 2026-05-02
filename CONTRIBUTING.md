# Contributing to `@netzi/recall`

Gracias por interesarte en el proyecto. Este repo sigue **GitFlow** estricto y
todos los cambios pasan por revision automatica antes de llegar a `main`.

---

## Branching model

| Branch | Proposito | Quien empuja |
|---|---|---|
| `main` | codigo publicado en npm. Cada commit corresponde a un release tageado. | nadie via push directo — solo merges desde `develop` o `hotfix/*` via PR |
| `develop` | integracion continua del proximo release. Default branch. | maintainers via PR desde `feature/*`; push directo permitido a maintainers |
| `feature/<slug>` | trabajo en curso. Se ramifica de `develop`, se mergea a `develop`. | quien la abrio |
| `release/<version>` | preparacion de release (bump version, release notes, freeze). De `develop` a `main`. | maintainers |
| `hotfix/<slug>` | fix urgente sobre `main`. Se mergea a `main` Y `develop`. | maintainers |

**Reglas duras del repositorio (codificadas en branch protection):**

- `main` no acepta push directo de NADIE (incluyendo admins).
- `main` solo recibe via PR con CI verde.
- `main` no permite force push ni delete.
- `develop` no permite force push ni delete.
- Todo PR (a `main` o `develop`) ejecuta el workflow `ci` y debe pasar:
  - `typecheck`, `lint`, `lint:tests`, `validate:modules`, `build`, `test:coverage`
  - SonarQube quality gate strict (https://sonar.netzi.dev/dashboard?id=recall)

---

## Cambios estandar (feature flow)

```bash
# 1. Sincroniza
git checkout develop
git pull origin develop

# 2. Rama de trabajo
git checkout -b feature/mi-cambio

# 3. Trabaja con el ciclo de 5 checks pre-commit (todos EXIT=0):
cd code
npm run typecheck
npm run lint
npm run validate:modules
npm run build
npm test

# 4. Commit + push (con tu propia firma de Co-Authored-By si usas Claude Code)
git push -u origin feature/mi-cambio

# 5. Abre PR contra develop
gh pr create --base develop --title "feat: ..." --body "..."

# 6. Espera CI verde (workflow `ci`).
# 7. Merge (squash recomendado).
```

## Release flow

```bash
git checkout develop && git pull
git checkout -b release/0.1.2

# Bump version + release notes
# - code/package.json -> "version": "0.1.2"
# - code/src/bootstrap/composition-root.ts -> default serverInfo.version
# - docs/RELEASE-NOTES-v0.1.2.md
# - HANDOFF.md §0
cd code && npm run typecheck && npm run lint && npm run validate:modules && npm run build && npm test

git commit -am "chore(release): v0.1.2"
git push -u origin release/0.1.2
gh pr create --base main --title "release: v0.1.2" --body "..."

# CI corre, gate pasa, merge a main.
# Tag y publish lo hace el maintainer post-merge:
git checkout main && git pull
git tag -a v0.1.2 -m "v0.1.2"
git push origin v0.1.2
gh release create v0.1.2 --notes-file docs/RELEASE-NOTES-v0.1.2.md
cd code && npm publish --auth-type=web

# Merge back a develop
git checkout develop && git merge --no-ff main && git push origin develop
```

## Hotfix flow

```bash
git checkout main && git pull
git checkout -b hotfix/critical-bug

# Fix + tests
cd code && npm test

git commit -am "fix: ..."
git push -u origin hotfix/critical-bug

# PRs paralelos: contra main Y contra develop (o cherry-pick a develop tras merge)
gh pr create --base main --title "fix: ..." --body "..."
```

---

## Lineamientos de codigo

Cero `any`, cero `as any`, cero `// @ts-ignore`. Clean Architecture + Hexagonal
+ DDD + SOLID + modularidad estricta. Detalle no negociable en
[`docs/12-lineamientos-arquitectura.md`](./docs/12-lineamientos-arquitectura.md).

ADRs vigentes:

- ADR-001: cross-imports `retrieval`/`curator` -> `memory` autorizados (`docs/12 §1.5.1`)
- ADR-002: PriorityBoost multiplicativo (`docs/12 §1.5.2`)
- ADR-003: ContextLayerKind ACL domain-vs-wire (`docs/12 §1.5.3`)
- ADR-004: tar/fastembed wontfix con mitigacion (`docs/12 §1.5.4`)

---

## Issues y bugs

- Reportes en https://github.com/NetziTech/recall/issues
- **0 issues abiertos** al cierre de Phase-11 (los 4 bugs B-MCP-2..5
  detectados en el dogfood de Phase-9 quedaron cerrados en
  `v0.1.2-beta.3` via PRs #17/#18/#19/#20). Ver
  [`HANDOFF.md`](./HANDOFF.md) §6.16 +
  [release notes](./docs/RELEASE-NOTES-v0.1.2-beta.3.md).

---

## Convencion de commits

Estilo Conventional Commits:

```
feat(memory): add task aggregate
fix(mcp): facades resolve workspace_id from bootstrap
docs(handoff): document Phase-9 dogfood
chore(release): cut v0.1.2-beta.0
test(retrieval): cover bm25 fallback path
```

Idioma: documentacion en espanol, codigo y commits en ingles
(`CLAUDE.md` raiz).
