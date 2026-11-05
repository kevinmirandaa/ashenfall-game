# ASHENFALL

Servidor autoritativo para un duelo 1v1 por turnos de proyectiles. Proyecto académico en construcción: el servidor ya corre en local, pero aún no hay cliente ni despliegue en Azure.

## Ejecutar en local
Con Docker Desktop abierto:
```bash
docker compose up --build
```
El servidor queda en `http://localhost:8080`; compruébalo en `/health/ready`.

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
- [DECISIONS.md](DECISIONS.md): decisiones de diseño.
- [CHANGELOG.md](CHANGELOG.md): cambios.
- [ASHENFALL_MASTER_BRIEF.md](ASHENFALL_MASTER_BRIEF.md): diseño del juego.
