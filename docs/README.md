# Documentación de ASHENFALL

Toda la documentación del proyecto vive en esta carpeta. En la raíz del repositorio solo quedan, por convención, [README.md](../README.md) (cómo correrlo), [CHANGELOG.md](../CHANGELOG.md) (cambios por ticket) y `CLAUDE.md` (contexto para el asistente).

Si dos documentos se contradicen, manda este orden: el enunciado del curso (`Proyecto3.pdf`, no versionado), luego [DECISIONS.md](DECISIONS.md) y por último el brief de diseño.

## Arquitectura y decisiones
- [DECISIONS.md](DECISIONS.md): decisiones de arquitectura y de juego (D1 a D13) y cambios de diseño por ticket. SCRUM-66 reemplaza lo anterior sobre armas, pociones, viento y cosméticos.
- [ASHENFALL_MASTER_BRIEF.md](ASHENFALL_MASTER_BRIEF.md): brief original de diseño, arte y arquitectura. Es histórico: describe edificios, pociones, cosméticos y viento que ya no existen; para el estado actual vale DECISIONS.md.

## Contratos
- `contracts/openapi.json` (OpenAPI 3.1, también publicado en `/docs` del servidor) y `contracts/asyncapi.json` (AsyncAPI 3.0, WebSocket). Se generan desde el código y las pruebas fallan si no coinciden; para regenerarlos: `UPDATE_CONTRACTS=1 npx vitest run`.

## Seguridad
- [threat-model.md](threat-model.md): activos, fronteras de confianza, amenazas con su defensa y su prueba, riesgos aceptados.

## Rendimiento
- [load-report.md](load-report.md): prueba de carga reproducible, punto de quiebre y optimización medida (antes y después).
- [load/](load/): resultados crudos de esas ejecuciones (`before.json`, `break.json`, `storm.json`).

## Observabilidad
- [observability.md](observability.md): métricas propias, trazas, logs correlacionados por partida, sondas y alertas.

## Azure, IaC y CI/CD
- [azure-setup.md](azure-setup.md): preparar Azure y GitHub desde el portal, desplegar, apagar, borrar y hacer rollback.
- [azure-cost.md](azure-cost.md): costo mensual estimado y cómo mantenerlo dentro del crédito de Azure for Students.
- Código: `infra/` (Bicep), `.github/workflows/` (CI, despliegue, CodeQL, gitleaks y escaneo de imagen), `scripts/deploy.sh` y `scripts/rollback.sh`.

## Arte
- `scripts/build-art.py`, `build-town.py`, `build-obstacles.py` y `build-ui.py` regeneran `apps/client/public/art` a partir de las imágenes de `references/` (no versionadas). Requieren Pillow.
