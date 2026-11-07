# Jugar en local

Esta guía es para quien quiera correr ASHENFALL en su propio equipo. Para jugar sin instalar nada, usa el enlace de la nube que está en el [README](../README.md).

## Con Docker (menos de 10 minutos)
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
Las pruebas de integración usan ese PostgreSQL y ese Redis (`DATABASE_URL` y `REDIS_URL` por defecto: ver `.env.example`). La espera máxima de la cola rápida y el periodo de gracia para reconectar se configuran con `MATCHMAKING_MAX_WAIT_MS` y `RECONNECT_GRACE_MS` (60 s por defecto).

| Comando | Qué hace |
|---|---|
| `npm test` | Todas las pruebas con Vitest: dominio, física, API, WebSocket, concurrencia, idempotencia, reconexión, reinicio, autorización, límites de tasa, compras y recompensas concurrentes, contratos. |
| `npm run lint` | ESLint (`typescript-eslint` strict, sin `any`, y el dominio sin red, BD, reloj ni azar globales). |
| `npm run typecheck` | `tsc` del servidor, el bot y las pruebas. |
| `npm run build` | Compila dominio, servidor y bot, y el cliente con Vite. |
| `npm run test:coverage` | Pruebas con cobertura (se escribe en `coverage/`, no versionado). |
| `UPDATE_CONTRACTS=1 npx vitest run` | Regenera `contracts/openapi.json` y `contracts/asyncapi.json` tras cambiar rutas o mensajes. |
| `npm run dev -w @ashenfall/client` | Cliente con recarga en caliente en http://localhost:5173, contra el servidor de `docker compose`. |

Resultado al 7 nov 2026 en local: 24 archivos y 294 pruebas en verde; `tsc` y ESLint sin errores. CI ejecuta lo mismo en cada PR ([ci.yml](../.github/workflows/ci.yml)).

La prueba de carga con el bot (`apps/bot`) y cómo reproducirla están en [docs/load-report.md](load-report.md).
