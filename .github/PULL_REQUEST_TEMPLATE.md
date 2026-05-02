<!--
Lee CONTRIBUTING.md antes de abrir tu primer PR.
GitFlow: feature -> develop, release -> main, hotfix -> main + develop.
-->

## Que cambia

<!-- 1-3 lineas. Que feature/fix/refactor incluye este PR. -->

## Por que

<!-- Motivacion. Si cierra un issue: "Fixes #N". Si es chore/release, link a HANDOFF/release notes. -->

## Tipo de cambio

<!-- Marca todos los que apliquen. -->

- [ ] feat — nueva funcionalidad
- [ ] fix — bug fix
- [ ] docs — solo documentacion
- [ ] refactor — cambio de codigo sin cambiar comportamiento
- [ ] test — agrega o mejora tests
- [ ] chore — cambios de tooling/build/release/CI
- [ ] perf — mejora de performance
- [ ] security — fix de seguridad

## Checklist (auto-validado por CI; marca lo que ya verificaste localmente)

- [ ] `npm run typecheck` EXIT=0
- [ ] `npm run lint` y `npm run lint:tests` EXIT=0
- [ ] `npm run validate:modules` EXIT=0 (cero violaciones ADR-001)
- [ ] `npm run build` EXIT=0
- [ ] `npm run test:coverage` EXIT=0 (cobertura ≥95% global)
- [ ] Cero `any`, cero `as any`, cero `// @ts-ignore`
- [ ] Si tocaste codigo de produccion: tests nuevos cubren el cambio
- [ ] Si tocaste el wire/protocolo MCP: docs/02 actualizado
- [ ] Si introduces ADR: documentado en `docs/12 §1.5.x`
- [ ] HANDOFF.md actualizado si la fase del proyecto cambia

## E2E que validan VALORES (regla durable post-Phase-9)

<!-- Si tu PR cambia un tool MCP o un facade: cada nuevo E2E debe (a) crear
estado conocido, (b) invocar tool, (c) asertar valores reales — no solo
shape. Esta regla codifica el aprendizaje de B-MCP-1, B-MCP-2 y B-MCP-3. -->

- [ ] N/A — el cambio no toca tools MCP ni facades
- [ ] Los E2E nuevos asertan valores reales (no solo shape)

## Notas para el reviewer

<!-- Cosas que valga la pena mirar con cuidado, decisiones tomadas, alternativas descartadas. -->
