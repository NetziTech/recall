# SonarQube — setup y operacion

## 1. Servidor local con Docker

```bash
docker run -d --name sonarqube \
  -p 9000:9000 \
  -v sonarqube_data:/opt/sonarqube/data \
  -v sonarqube_logs:/opt/sonarqube/logs \
  -v sonarqube_extensions:/opt/sonarqube/extensions \
  sonarqube:lts-community
```

Esperar ~30s. Abrir <http://localhost:9000> con `admin/admin`. Cambiar
password al primer login.

## 2. Crear el proyecto y quality gate

1. **My Account → Security → Generate Token.** Guarda el token, lo
   necesitaras para el scanner.
2. **Quality Gates → Create:** nombre `MCP Memoria Strict` con las
   thresholds documentadas en `sonar-project.properties`.
3. **Projects → Create Project → Manually:**
   - Project key: `mcp-memoria-inteligente`
   - Display name: `MCP Memoria Inteligente`
4. En el proyecto creado, **Project Settings → Quality Gate** → asignar
   `MCP Memoria Strict`.

## 3. Variables de entorno

```bash
export SONAR_HOST_URL=http://localhost:9000      # o sonarcloud.io
export SONAR_TOKEN=<token-generado-en-paso-1>
```

Para CI, guardarlos como secrets del repo.

## 4. Correr el scanner local

```bash
cd code
npm run test:coverage           # genera coverage/lcov.info
npx sonar-scanner               # lee sonar-project.properties y sube
```

Resultado en <http://localhost:9000/dashboard?id=mcp-memoria-inteligente>.

## 5. Quality gate FAILED

Si SonarQube reporta FAILED, el agente `qa-sonarqube-auditor` rechaza la
fase. Ver issues en el dashboard:
- **Reliability:** bugs reales detectados.
- **Security:** vulnerabilidades.
- **Maintainability:** code smells (blocker / critical primero).
- **Coverage:** archivos por debajo del threshold.
- **Duplications:** bloques duplicados.

Resolver y volver a correr el scanner.

## 6. CI integration (GitHub Actions)

`.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # SonarQube necesita full history
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd code && npm ci
      - run: cd code && npm run typecheck
      - run: cd code && npm run lint
      - run: cd code && npm run validate-modules
      - run: cd code && npm run test:coverage
      - uses: SonarSource/sonarqube-scan-action@v3
        with:
          projectBaseDir: code
        env:
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

## 7. SonarCloud (alternativa cloud, free para repos publicos)

1. Conecta el repo de GitHub en sonarcloud.io.
2. Cambia `sonar.host.url=https://sonarcloud.io` en CI env.
3. Quality gate similar.

## 8. Quality gate definido

El agente `qa-sonarqube-auditor` valida el siguiente quality gate.
Crearlo en el server con estos criterios EXACTOS:

| Metrica | Operador | Threshold |
|---|---|---|
| Coverage on new code | ≥ | 95.0 |
| Coverage on overall code | ≥ | 95.0 |
| Duplicated lines (%) on new code | ≤ | 3.0 |
| Duplicated lines (%) overall | ≤ | 3.0 |
| Maintainability rating on new code | = | A |
| Maintainability rating overall | = | A |
| Reliability rating on new code | = | A |
| Reliability rating overall | = | A |
| Security rating on new code | = | A |
| Security rating overall | = | A |
| Security review rating on new code | = | A |
| Security review rating overall | = | A |
| Bugs on new code | = | 0 |
| Bugs overall | = | 0 |
| Vulnerabilities on new code | = | 0 |
| Vulnerabilities overall | = | 0 |
| Blocker issues on new code | = | 0 |
| Critical issues on new code | = | 0 |
| Technical debt ratio on new code | ≤ | 5.0% |

## 9. Troubleshooting

| Problema | Solucion |
|---|---|
| `Coverage report not found` | Correr `npm run test:coverage` antes del scanner. Verificar `coverage/lcov.info` existe. |
| `Project not found` | Crear el proyecto manualmente en SonarQube primero. |
| `Quality gate timeout` | Aumentar `sonar.qualitygate.timeout=600` (10 min). |
| Scanner muy lento | Excluir node_modules y dist en `sonar.exclusions`. |
