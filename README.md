# ASHENFALL

Servidor autoritativo para un duelo 1v1 por turnos de proyectiles. Proyecto académico en construcción: el servidor ya corre en local, pero aún no hay cliente; la infraestructura de Azure está definida pero sin desplegar.

## Ejecutar en local
Con Docker Desktop abierto:
```bash
docker compose up --build
```
Juega en `http://localhost:8080`, con dos navegadores o pestañas; compruébalo en `/health/ready`.

## Requisitos para desarrollar
Node 20 o superior (CI y Docker usarán Node 22).

## Comandos
```bash
npm ci
```
Las pruebas necesitan PostgreSQL y Redis:
```bash
docker compose up -d --wait postgres redis
```
```bash
npm test
```
```bash
npm run lint
```
```bash
npm run build
```

## Documentación
- [docs/azure-setup.md](docs/azure-setup.md): preparar Azure y GitHub, desplegar, apagar, borrar y rollback.
- [docs/azure-cost.md](docs/azure-cost.md): costo estimado.
- `infra/`: Bicep; `scripts/deploy.sh` y `scripts/rollback.sh`.
- [DECISIONS.md](DECISIONS.md): decisiones de diseño.
- [CHANGELOG.md](CHANGELOG.md): cambios.
- [ASHENFALL_MASTER_BRIEF.md](ASHENFALL_MASTER_BRIEF.md): diseño del juego.
