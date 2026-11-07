# ASHENFALL

Servidor autoritativo para un duelo 1v1 por turnos de proyectiles, de fantasía oscura, más un cliente web de prueba. Proyecto académico: se evalúa el servidor (sesiones, concurrencia, seguridad, rendimiento, Azure y contratos), no el juego.

- El cliente solo envía intenciones (ángulo y potencia); el servidor simula el tiro, decide el daño y es la única fuente de verdad.
- Cada partida es un log de eventos en PostgreSQL con número de secuencia: se reproduce jugada por jugada y sobrevive a reinicios.
- Jugadas ordenadas e idempotentes, varias réplicas coordinadas por PostgreSQL y Redis, y una vista por jugador que nunca filtra el ángulo, la potencia ni el `actionId` del rival.

**URL pública en Azure:** pendiente. La infraestructura está en `infra/` y el pipeline en `.github/workflows/deploy.yml`; la guía para desplegar es [docs/azure-setup.md](docs/azure-setup.md).

## Correr en local con Docker (menos de 10 minutos)
Solo necesitas Docker Desktop abierto; no hace falta Node ni configurar secretos.
```bash
git clone https://github.com/kevinmirandaa/ashenfall-game.git
cd ashenfall-game
docker compose up --build
```
Levanta PostgreSQL, Redis y el servidor; las migraciones se aplican al arrancar. En un Mac con Docker Desktop, la imagen del servidor se construye sin caché en alrededor de un minuto (medido el 7 nov 2026; depende de la red).

- Juego: http://localhost:8080. Para jugar contra otra persona abre dos navegadores o dos pestañas y registra una cuenta en cada una (los tokens viven en memoria por pestaña). El modo historia se juega solo, contra los monstruos que mueve el servidor.
- API REST (OpenAPI 3.1): http://localhost:8080/docs
- Sondas: http://localhost:8080/health/live y http://localhost:8080/health/ready

En local la clave JWT se genera al arrancar (`ASHENFALL_DEV_SECRETS=1` en `docker-compose.yml`), así que reiniciar el servidor cierra las sesiones. Los puertos solo se publican en `127.0.0.1`.

Para dar el rol de administrador a una cuenta ya registrada (ninguna ruta de la API lo concede):
```bash
docker compose exec server node apps/server/dist/db/grant-admin-cli.js tu-correo@ejemplo.com
```

## Desarrollo y pruebas
Requiere Node 22 (`.nvmrc`; `package.json` admite 20 o superior).
```bash
npm ci
docker compose up -d --wait postgres redis
```
Las pruebas de integración usan ese PostgreSQL y ese Redis (`DATABASE_URL` y `REDIS_URL` por defecto: ver `.env.example`).

| Comando | Qué hace |
|---|---|
| `npm test` | Todas las pruebas con Vitest: dominio, física, API, WebSocket, concurrencia, idempotencia, reconexión, reinicio, autorización, límites de tasa, compras y recompensas concurrentes, contratos. |
| `npm run lint` | ESLint (`typescript-eslint` strict, sin `any`, y el dominio sin red, BD, reloj ni azar globales). |
| `npm run typecheck` | `tsc` del servidor, el bot y las pruebas. |
| `npm run build` | Compila dominio, servidor y bot, y el cliente con Vite. |
| `npm run test:coverage` | Pruebas con cobertura (se escribe en `coverage/`, no versionado). |
| `UPDATE_CONTRACTS=1 npx vitest run` | Regenera `contracts/openapi.json` y `contracts/asyncapi.json` tras cambiar rutas o mensajes. |
| `npm run dev -w @ashenfall/client` | Cliente con recarga en caliente en http://localhost:5173, contra el servidor de `docker compose`. |

Resultado al 7 nov 2026 en local: 23 archivos y 287 pruebas en verde; `tsc` y ESLint sin errores. CI ejecuta lo mismo en cada PR ([ci.yml](.github/workflows/ci.yml)).

La prueba de carga con el bot (`apps/bot`) y cómo reproducirla están en [docs/load-report.md](docs/load-report.md).

## Estructura
```
packages/domain/   Motor de reglas puro: partida, física, armas, arenas, vista por jugador y bot. Sin red, BD ni framework.
apps/server/       Fastify: REST, WebSocket, PostgreSQL (migraciones en migrations/), Redis, telemetría.
apps/client/       Cliente de prueba con Phaser 3 y Vite, servido por el propio servidor.
apps/bot/          Bot de carga: juega partidas reales por HTTP y WebSocket y mide la latencia.
contracts/         OpenAPI 3.1 y AsyncAPI 3.0 generados desde el código.
infra/             Bicep del ambiente completo (Container Apps, PostgreSQL, Redis, Key Vault, ACR, alertas).
scripts/           Despliegue y rollback en Azure; generación del arte desde references/.
docs/              Toda la documentación: ver docs/README.md.
.github/           CI, despliegue dev/prod, CodeQL, gitleaks, escaneo de la imagen y Dependabot.
```

## Stack
TypeScript estricto (sin `any`) sobre Node 22, Fastify 5, WebSocket (`ws`) con ticket de un solo uso, PostgreSQL 16, Redis 7, Argon2id y JWT, OpenTelemetry hacia Application Insights. Imagen Docker que corre como usuario no root. Azure Container Apps con identidad administrada y Key Vault, desplegado con Bicep y GitHub Actions.

## Documentación
El índice está en [docs/README.md](docs/README.md): decisiones de arquitectura ([docs/DECISIONS.md](docs/DECISIONS.md)), modelo de amenazas, reporte de carga, observabilidad, guía y costo de Azure. Los cambios por ticket están en [CHANGELOG.md](CHANGELOG.md).
