# Cumplimiento del enunciado

Auditoría del 7 nov 2026 (SCRUM-72) contra `Proyecto3.pdf` (6 páginas, no versionado), que manda sobre cualquier otro documento. Cada fila es un requisito evaluable del enunciado con su evidencia en el repositorio.

**Estados.** *Cumple*: hay código y una prueba o documento que lo demuestran, ejecutados en local o en CI. *Cumple parcialmente*: falta una parte, indicada en la acción. *No cumple*: falta todavía. *No verificable aquí*: el código y el Bicep existen, pero solo se demuestra con Azure desplegado (aún no está desplegada la versión final).

**Qué se ejecutó para esta auditoría (7 nov 2026, en local):** `tsc` del servidor, el bot, las pruebas y el cliente; ESLint; `npx vitest run` con PostgreSQL y Redis de `docker compose` (24 archivos, 294 pruebas en verde); build del cliente. En GitHub Actions, la última PR (SCRUM-71) tiene CI, CodeQL, Gitleaks (historial completo) e Image scan (Trivy y usuario no root) en verde. El workflow `Deploy` nunca se ha ejecutado tras un merge: siempre quedó en *skipped* porque `AUTO_DEPLOY` está apagado. No hay ningún tag.

## Resumen

| Estado | Requisitos |
|---|---:|
| Cumple | 88 |
| Cumple parcialmente | 4 |
| No cumple | 0 |
| No verificable aquí | 2 |
| **Total** | **94** |

No queda ningún requisito sin cumplir. Los pendientes son comprobaciones que no se han hecho (A8 y E14, que exigen tocar prod con partidas abiertas o más réplicas) y decisiones del usuario (A6, A17, E15).

## 1. El juego (restricciones, sin nota)

| # | Requisito | Evidencia | Estado | Acción |
|---|---|---|---|---|
| J1 | Por turnos: la partida sabe siempre a quién le toca | `turn` en el estado del dominio ([match.ts](../packages/domain/src/match.ts)); [match.test.ts](../packages/domain/src/match.test.ts) «turnos» | Cumple | — |
| J2 | Mínimo 2 jugadores humanos por partida | Duelo 1v1 por sala o cola ([rooms.test.ts](../apps/server/src/rooms/rooms.test.ts), [matchmaking.test.ts](../apps/server/src/matchmaking/matchmaking.test.ts)). El modo historia contra monstruos es un añadido; el PvP no cambia | Cumple | — |
| J3 | Original, no una recreación 1 a 1 | Reglas propias: retroceso permanente, daño por zona y potencia, terreno y obstáculos sorteados y simétricos, personajes por nivel y dinero ([DECISIONS.md](DECISIONS.md)) | Cumple | Lo juzga el profesor; ver riesgos |
| J4 | Reglas verificables: jugada válida y fin de partida sin ambigüedad | `decide()` rechaza con código tipado; fin por KO, límite de rondas, dos timeouts, gracia vencida o administrador (D6); [match.test.ts](../packages/domain/src/match.test.ts) | Cumple | — |
| J5 | Información oculta (recomendada, no obligatoria) | Posición y trayectoria públicas por decisión (D1). Sí hay vista por jugador: el rival nunca recibe `actionId`, ángulo ni potencia ([view.test.ts](../packages/domain/src/view.test.ts)) | Cumple parcialmente | Opcional; justificado en D1 y en el modelo de amenazas |

## 2. Requisitos funcionales del servidor

| # | Requisito | Evidencia | Estado | Acción |
|---|---|---|---|---|
| F1 | Registro, inicio y cierre de sesión, renovación del token, perfil | [auth/routes.ts](../apps/server/src/auth/routes.ts); [auth.test.ts](../apps/server/src/auth/auth.test.ts) | Cumple | — |
| F2 | Tokens de corta duración y refresh rotativo | Acceso de 15 min ([main.ts](../apps/server/src/main.ts)); rotación y revocación de familia en [auth.test.ts](../apps/server/src/auth/auth.test.ts) «refresh rotativo» | Cumple | — |
| F3 | Salas: crear pública o privada con código, listar, unirse, salir, «listo» | [rooms/routes.ts](../apps/server/src/rooms/routes.ts); [rooms.test.ts](../apps/server/src/rooms/rooms.test.ts) | Cumple | — |
| F4 | Inicia solo con 2 o más listos | [rooms.test.ts](../apps/server/src/rooms/rooms.test.ts) «no inicia con un solo jugador listo», «con ambos listos a la vez inicia exactamente una partida» | Cumple | — |
| F5 | Capacidad máxima respetada con uniones simultáneas | [rooms.test.ts](../apps/server/src/rooms/rooms.test.ts) «la capacidad se respeta con 10 uniones simultáneas» | Cumple | — |
| F6 | Cola rápida que agrupa jugadores en partidas nuevas | [matchmaking-service.ts](../apps/server/src/matchmaking/matchmaking-service.ts); [matchmaking.test.ts](../apps/server/src/matchmaking/matchmaking.test.ts) | Cumple | — |
| F7 | Un jugador nunca en dos partidas | Índice único `match_players_one_active`; [matchmaking.test.ts](../apps/server/src/matchmaking/matchmaking.test.ts) «con 20 jugadores simultáneos»; [event-store.test.ts](../apps/server/src/matches/event-store.test.ts) | Cumple | — |
| F8 | Tiempo máximo de espera de la cola configurable | `MATCHMAKING_MAX_WAIT_MS` ([config.ts](../apps/server/src/config.ts)); [config.test.ts](../apps/server/src/config.test.ts); expiración en [matchmaking.test.ts](../apps/server/src/matchmaking/matchmaking.test.ts) «al vencer la espera máxima» | Cumple | Cerrado en SCRUM-72: antes solo era configurable en código |
| F9 | Enviar jugada, recibir el nuevo estado y saber a quién le toca | Mensajes `shoot`, `event`, `turn_started` ([protocol.ts](../apps/server/src/realtime/protocol.ts)); [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) «partida completa» (12 rondas sin consultar) | Cumple | — |
| F10 | Solo juega quien tiene el turno; jugada inválida con error tipado | `NOT_YOUR_TURN`, `STALE_VERSION`… ([asyncapi.json](../contracts/asyncapi.json)); [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) «rechaza con error tipado» | Cumple | — |
| F11 | Temporizador por turno con acción por defecto | Timeout: pasa turno sin daño, 2 seguidos = abandono (D6); [resilience.test.ts](../apps/server/src/realtime/resilience.test.ts) «temporizador del servidor» | Cumple | — |
| F12 | Detectar caídas con heartbeat | [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) «cierra la conexión que no responde al ping» (4009) | Cumple | — |
| F13 | Reconectar y recuperar el estado actual | Snapshot al conectar; [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) «al reconectar… incluso desde otra réplica»; [resilience.test.ts](../apps/server/src/realtime/resilience.test.ts) «desconexión» | Cumple | — |
| F14 | Periodo de gracia configurable; al vencer, regla de abandono | `RECONNECT_GRACE_MS` ([config.ts](../apps/server/src/config.ts), [app.ts](../apps/server/src/app.ts)); [resilience.test.ts](../apps/server/src/realtime/resilience.test.ts) «el periodo de gracia es configurable» y «al vencer la gracia gana el rival» | Cumple | Cerrado en SCRUM-72: antes estaba fijo en 60 s |
| F15 | Declarar ganador o empate y registrar el resultado | `match_results`; [match.test.ts](../packages/domain/src/match.test.ts) «daño y fin de partida»; [history.test.ts](../apps/server/src/matches/history.test.ts) «sin ganador aparece como empate» | Cumple | — |
| F16 | Resultado inmutable | [event-store.test.ts](../apps/server/src/matches/event-store.test.ts) «el resultado es inmutable»; [match.test.ts](../packages/domain/src/match.test.ts) | Cumple | — |
| F17 | Cada partida se reproduce jugada por jugada | `GET /v1/matches/{matchId}/replay`; [history.test.ts](../apps/server/src/matches/history.test.ts) «reproducción» | Cumple | — |
| F18 | Historial paginado; cada usuario solo ve el detalle de sus partidas | [history.test.ts](../apps/server/src/matches/history.test.ts) «está paginado y solo incluye las partidas propias», «un tercero recibe 404» | Cumple | — |
| F19 | Administración: ver partidas activas y conexiones | `GET /v1/admin/matches` con `connected` y `connections` por jugador ([admin.ts](../apps/server/src/admin/admin.ts)); [admin.test.ts](../apps/server/src/admin/admin.test.ts) «muestra las conexiones vivas» | Cumple | Cerrado en SCRUM-72: antes solo había `connected` |
| F20 | Administración: terminar una partida y suspender un usuario | [admin.test.ts](../apps/server/src/admin/admin.test.ts) «partidas», «suspensión» (cierra el WebSocket con 4003) | Cumple | — |
| F21 | Solo el rol administrador; cada acción auditada | Rol leído de la base en cada petición; `admin_audit_logs`; [admin.test.ts](../apps/server/src/admin/admin.test.ts) «autorización» | Cumple | Riesgo aceptado: terminar y auditar no son atómicos ([threat-model.md](threat-model.md)) |

## 3. Reglas del servidor

| # | Requisito | Evidencia | Estado | Acción |
|---|---|---|---|---|
| S1 | Autoritativo: el cliente envía intenciones, nunca resultados | `shoot` solo lleva ángulo, potencia, arma y versión, sin campos extra ([protocol.ts](../apps/server/src/realtime/protocol.ts)); el servidor simula ([physics.ts](../packages/domain/src/physics.ts)) | Cumple | — |
| S2 | Jugadas de una partida una a la vez, con número de secuencia | Fila por partida ([match-engine.ts](../apps/server/src/matches/match-engine.ts)) y clave `(match_id, seq)` (D9); [match.test.ts](../packages/domain/src/match.test.ts) «secuencia consecutiva»; [event-store.test.ts](../apps/server/src/matches/event-store.test.ts) «dos réplicas… la misma secuencia» | Cumple | — |
| S3 | Jugada sobre versión vieja rechazada | `STALE_VERSION`; [match.test.ts](../packages/domain/src/match.test.ts), [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) | Cumple | — |
| S4 | Idempotencia por id generado en el cliente | `actionId`; [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) «enviada 10 veces», [resilience.test.ts](../apps/server/src/realtime/resilience.test.ts) «a dos réplicas a la vez» | Cumple | — |
| S5 | Vista por jugador: ningún mensaje, endpoint ni log filtra datos de otro | [view.test.ts](../packages/domain/src/view.test.ts), [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts), [history.test.ts](../apps/server/src/matches/history.test.ts), [telemetry.test.ts](../apps/server/src/telemetry/telemetry.test.ts), [hardening.test.ts](../apps/server/src/security/hardening.test.ts) «logs» | Cumple | — |
| S6 | Durabilidad: reinicio o versión nueva sin perder jugadas | Estado reconstruido desde PostgreSQL (D3); [resilience.test.ts](../apps/server/src/realtime/resilience.test.ts) «reinicio», [event-store.test.ts](../apps/server/src/matches/event-store.test.ts) | Cumple | En Azure, ver A7 |
| S7 | Aislamiento: una excepción en una partida no afecta a las demás ni tumba el proceso | Fila por partida, `try/catch` por partida en el barrido ([sweeper.ts](../apps/server/src/matches/sweeper.ts)) y por mensaje en el gateway; [resilience.test.ts](../apps/server/src/realtime/resilience.test.ts) «aislamiento» | Cumple | Prueba añadida en SCRUM-72 (antes, parcial) |
| S8 | Limpieza: partidas abandonadas o inactivas expiran y liberan recursos | Plazos en PostgreSQL barridos por todas las réplicas (D10); salas viejas y cola caducada; [resilience.test.ts](../apps/server/src/realtime/resilience.test.ts) «limpieza», «al vencer la gracia» | Cumple | — |
| S9 | Temporizadores y azar en el servidor; azar criptográfico | `cryptoRandom` con `node:crypto.randomInt` ([start.ts](../apps/server/src/matches/start.ts)); ESLint prohíbe `Date.now` y `Math.random` en el dominio ([eslint.config.mjs](../eslint.config.mjs)) | Cumple | — |
| S10 | Muchas partidas simultáneas sin interferir, con varias réplicas | [resilience.test.ts](../apps/server/src/realtime/resilience.test.ts) «varias réplicas»; 800 partidas a la vez sin errores en [load-report.md](load-report.md) | Cumple | — |

## 4. Requisitos técnicos

| # | Requisito | Evidencia | Estado | Acción |
|---|---|---|---|---|
| T1 | TypeScript en Node 20+ con `strict` y sin `any` | [tsconfig.base.json](../tsconfig.base.json), `no-explicit-any: error` en [eslint.config.mjs](../eslint.config.mjs), [.nvmrc](../.nvmrc) (22) | Cumple | — |
| T2 | Dominio puro sin red, BD ni framework | [packages/domain](../packages/domain/src) sin dependencias; reglas de ESLint del dominio | Cumple | — |
| T3 | Tiempo real por WebSocket, sin polling para saber si cambió el turno | `ws` en [gateway.ts](../apps/server/src/realtime/gateway.ts); la prueba de partida completa avanza solo con lo que empuja el servidor | Cumple | — |
| T4 | `wss://` en producción | Ingress con `allowInsecure: false` ([main.bicep](../infra/main.bicep)); CSP solo `wss` con `ENFORCE_HTTPS` ([hardening.test.ts](../apps/server/src/security/hardening.test.ts)). Probado en prod el 7 nov 2026: el bot jugó 2 partidas por `wss://` (12 de 12 jugadas confirmadas, 0 errores) y un `Origin` ajeno recibe 403 en `/ws` | Cumple | — |
| T5 | Mensajes versionados; AsyncAPI 3.0 con esquema, ejemplos y errores por mensaje | Campo `v` ([protocol.ts](../apps/server/src/realtime/protocol.ts)); [asyncapi.json](../contracts/asyncapi.json); [contracts.test.ts](../apps/server/src/contracts/contracts.test.ts) «los ejemplos cumplen su propio esquema» | Cumple | — |
| T6 | REST de usuarios, salas, historial y administración en OpenAPI 3.1, publicado en `/docs` | [openapi.json](../contracts/openapi.json); [contracts.test.ts](../apps/server/src/contracts/contracts.test.ts) «se sirve en /docs», «no acepta una ruta sin contrato» | Cumple | — |
| T7 | Errores RFC 9457 Problem Details | [problem.ts](../apps/server/src/problem.ts); `application/problem+json` en [auth.test.ts](../apps/server/src/auth/auth.test.ts) y [rate-limit.test.ts](../apps/server/src/auth/rate-limit.test.ts) | Cumple | — |
| T8 | Cada mensaje validado (tipos, rangos, tamaño) antes del dominio; inválido rechazado sin cerrar la partida | TypeBox compilado y 4096 bytes ([protocol.ts](../apps/server/src/realtime/protocol.ts)); [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) «validación de mensajes» | Cumple | — |
| T9 | Heartbeat, cierre ordenado y códigos de cierre documentados | `CloseCode` (1001, 1009, 4003, 4008, 4009, 4029) en [protocol.ts](../apps/server/src/realtime/protocol.ts) y en `info` + `x-close-codes` de [asyncapi.json](../contracts/asyncapi.json); cierre 1001 al apagar ([gateway.ts](../apps/server/src/realtime/gateway.ts)) | Cumple | — |

## 5. Seguridad

| # | Requisito | Evidencia | Estado | Acción |
|---|---|---|---|---|
| SE1 | JWT firmados por el servidor; contraseñas en Argon2id | [auth-service.ts](../apps/server/src/auth/auth-service.ts); [password-hasher.test.ts](../apps/server/src/auth/password-hasher.test.ts); `alg: none` y firma ajena rechazados ([auth.test.ts](../apps/server/src/auth/auth.test.ts)) | Cumple | — |
| SE2 | WebSocket autenticado en el handshake con ticket de un solo uso y corta duración; si no, se cierra | [tickets.ts](../apps/server/src/realtime/tickets.ts) (30 s); [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) «handshake» (401 y 403, uso único con dos conexiones simultáneas) | Cumple | — |
| SE3 | Autorización por partida en cada endpoint y mensaje; solo el administrador administra | [hardening.test.ts](../apps/server/src/security/hardening.test.ts) «autorización en todo el contrato»; [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) «un tercero no puede jugar ni ver»; [admin.test.ts](../apps/server/src/admin/admin.test.ts) | Cumple | — |
| SE4 | Tasa por usuario y por conexión, 429 con `Retry-After` | [rate-limit.test.ts](../apps/server/src/auth/rate-limit.test.ts), [hardening.test.ts](../apps/server/src/security/hardening.test.ts) «límite por usuario», [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) «limita la tasa por conexión» | Cumple | — |
| SE5 | Tamaño máximo de mensaje y máximo de conexiones por usuario | 4096 bytes (cierre 1009) y 16 KiB en HTTP; 3 conexiones contadas entre réplicas ([gateway.test.ts](../apps/server/src/realtime/gateway.test.ts), [hardening.test.ts](../apps/server/src/security/hardening.test.ts) «conexiones por usuario entre réplicas») | Cumple | — |
| SE6 | CORS y orígenes de WebSocket restringidos; encabezados de seguridad | [hardening.test.ts](../apps/server/src/security/hardening.test.ts) «encabezados y CORS»; origen rechazado en [gateway.test.ts](../apps/server/src/realtime/gateway.test.ts) | Cumple | — |
| SE7 | Solo HTTPS y WSS | `allowInsecure: false` en [main.bicep](../infra/main.bicep); `ENFORCE_HTTPS`. Probado en prod: `http://` responde 301 a HTTPS y el ingress tiene `allowInsecure: false`; HSTS activo | Cumple | — |
| SE8 | Ningún secreto en el repositorio ni en configuración en texto plano | Sin valores por defecto ([config.ts](../apps/server/src/config.ts)); Gitleaks en verde sobre todo el historial; búsqueda manual de patrones en `git log -p --all` en esta auditoría: solo contraseñas de prueba | Cumple | — |
| SE9 | Secretos en Key Vault leídos con identidad administrada | `keyVaultUrl` + identidad en [main.bicep](../infra/main.bicep) (`jwt-secret`, cadena de Application Insights). Comprobado en prod: `jwt-secret` y la cadena de Application Insights son referencias a Key Vault con la identidad `id-ashenfall-prod`; la cadena de PostgreSQL no lleva contraseña | Cumple | — |
| SE10 | Escaneo de dependencias, código y secretos en CI | [dependabot.yml](../.github/dependabot.yml), [codeql.yml](../.github/workflows/codeql.yml), [gitleaks.yml](../.github/workflows/gitleaks.yml); en verde en la última PR | Cumple | — |
| SE11 | Imagen no root y sin vulnerabilidades críticas conocidas | `USER node` en [Dockerfile](../Dockerfile); [image-scan.yml](../.github/workflows/image-scan.yml) (Trivy CRITICAL y `id -u`), en verde | Cumple | — |
| SE12 | Modelo de amenazas (rúbrica) | [threat-model.md](threat-model.md) | Cumple | Actualizado en SCRUM-72 (frontera CI/CD, aislamiento) |

## 6. Rendimiento y optimización

| # | Requisito | Evidencia | Estado | Acción |
|---|---|---|---|---|
| R1 | Prueba de carga reproducible | [apps/bot/src/load.ts](../apps/bot/src/load.ts), [docker-compose.load.yml](../docker-compose.load.yml), comandos en [load-report.md](load-report.md), datos en [load/](load/) | Cumple | — |
| R2 | p95 < 200 ms hasta que todos reciben el estado, ninguna jugada perdida ni duplicada, error < 1 % | Local, 1 CPU: p95 ≤ 15 ms hasta 800 partidas, 0 errores, 0 perdidas o duplicadas ([load-report.md](load-report.md)) | Cumple | En Azure (prod, `canadacentral`, bot desde Costa Rica, 2 partidas, 12 jugadas): 0 perdidas, 0 duplicadas, 0 errores; p95 de extremo a extremo 216 ms, que incluye el viaje por internet. La métrica del servidor `ashenfall.shot.latency` en Application Insights: 91 jugadas, media 15,6 ms y máximo 61 ms. Para medir sin internet de por medio habría que ejecutar el bot dentro de Azure |
| R3 | CPU y memoria por partida activa y punto de quiebre por réplica | ~0,03 puntos de CPU y 0,02 MB por partida; quiebre en ~1 800 jugadas/s ([load-report.md](load-report.md)) | Cumple | El tope en partidas a 1 jugada/s (~1 700) es extrapolado, no medido |
| R4 | Mensajes compactos | Eventos con lo mínimo y trayectoria en enteros, ~302 bytes de media; snapshot solo al conectar ([load-report.md](load-report.md)) | Cumple | — |
| R5 | Al menos una optimización con cifras antes y después | Argon2 acotado (p95 202 → 109 ms en pico de logins) y jugada con 5 idas y vueltas en vez de 7 ([load-report.md](load-report.md), [optimizacion.md](optimizacion.md)) | Cumple | El JSON del «antes» de Argon2 se sobrescribió; las cifras se copiaron de la ejecución (dicho en el reporte) |

## 7. Arquitectura y despliegue en Azure

| # | Requisito | Evidencia | Estado | Acción |
|---|---|---|---|---|
| A1 | Topología: Container Apps, Redis para estado caliente y difusión, PostgreSQL para jugadas, Key Vault | [main.bicep](../infra/main.bicep); bus en Redis ([event-bus.ts](../apps/server/src/realtime/event-bus.ts)); sustitución de Azure Cache for Redis justificada en D12 | Cumple | — |
| A2 | Todos los recursos en Bicep o Terraform | [infra/](../infra) | Cumple | — |
| A3 | Un ambiente nuevo se levanta con una sola ejecución del pipeline | [deploy.sh](../scripts/deploy.sh) crea grupo, infraestructura, imagen, secreto y app en una ejecución; los requisitos previos (identidad de GitHub, roles, proveedores) son manuales ([azure-setup.md](azure-setup.md)). Las ejecuciones de Deploy del 7 nov crearon dev y prod desde grupos de recursos vacíos con el pipeline | Cumple | El primer intento de prod falló por el límite de un entorno por región (ver azure-setup.md §1) y se repitió el job |
| A4 | CI ejecuta build, linter, pruebas, validación de contratos y escaneo de seguridad | [ci.yml](../.github/workflows/ci.yml) (contratos dentro de `npm test`), CodeQL, Gitleaks, Trivy | Cumple | — |
| A5 | El pipeline publica la imagen en el registro | `docker push` a ACR en [deploy.sh](../scripts/deploy.sh), dentro del workflow `Deploy` | Cumple | Se publica en el job de despliegue, no en CI |
| A6 | Despliega a dev automáticamente | [deploy.yml](../.github/workflows/deploy.yml) tras CI en `main`, pero solo si `AUTO_DEPLOY=true` (apagado por crédito) | Cumple parcialmente | Decisión del usuario: poner `AUTO_DEPLOY=true` durante la revisión |
| A7 | Prod con aprobación manual | `environment: prod` en [deploy.yml](../.github/workflows/deploy.yml); los revisores se configuran en GitHub ([azure-setup.md](azure-setup.md) paso 6). El environment `prod` tiene como revisor obligatorio a la cuenta del propietario (comprobado con la API de GitHub); el despliegue del 7 nov esperó su aprobación | Cumple | — |
| A8 | Publicaciones sin cortar partidas: revisiones con división de tráfico y drenado | `activeRevisionsMode: Multiple`, revisión nueva al 0 %, smoke test y traslado ([deploy.sh](../scripts/deploy.sh)); `terminationGracePeriodSeconds: 120`; cierre 1001 y reconexión; la partida sobrevive al reinicio ([resilience.test.ts](../apps/server/src/realtime/resilience.test.ts)) | No verificable aquí | Probar un despliegue a prod con una partida en curso |
| A9 | Rollback documentado de menos de 5 minutos (rúbrica: «rollback probado») | [rollback.sh](../scripts/rollback.sh), [azure-setup.md](azure-setup.md) §11 | Cumple | Ejecutado en prod el 7 nov 2026: 22 s de la revisión nueva a la anterior y `/health/ready` en 200; se volvió a la nueva después (SCRUM-76) |
| A10 | Identidad administrada para todo acceso entre servicios; sin cadenas de conexión ni claves en la configuración | Identidad de usuario para ACR, Key Vault y PostgreSQL (Entra, `passwordAuth: Disabled`); cadena de Application Insights como referencia a Key Vault ([main.bicep](../infra/main.bicep), [pool.test.ts](../apps/server/src/db/pool.test.ts)). Redis sin contraseña, frontera de red (D12) | Cumple | Comprobar en Azure junto a SE9 |
| A11 | OpenTelemetry hacia Application Insights | [telemetry/azure.ts](../apps/server/src/telemetry/azure.ts), [telemetry.ts](../apps/server/src/telemetry/telemetry.ts). Comprobado en Application Insights el 7 nov: `customMetrics` con `ashenfall.connections`, `ashenfall.matches.active`, `ashenfall.shot.latency` y `ashenfall.shots`, y spans `match.shoot` con `ashenfall.match_id` y `ashenfall.player_id` | Cumple | — |
| A12 | Logs estructurados con ID de partida y de jugador, sin datos sensibles | [match-logs.ts](../apps/server/src/telemetry/match-logs.ts); [telemetry.test.ts](../apps/server/src/telemetry/telemetry.test.ts), [hardening.test.ts](../apps/server/src/security/hardening.test.ts) «logs» | Cumple | — |
| A13 | Métricas propias: partidas activas, conexiones, jugadas por segundo, latencia por jugada | [telemetry.test.ts](../apps/server/src/telemetry/telemetry.test.ts) «cuenta la jugada, mide la latencia y lee conexiones y partidas activas»; [observability.md](observability.md) | Cumple | — |
| A14 | Sondas `/health/live` y `/health/ready` | [health.test.ts](../apps/server/src/health.test.ts); sondas en [main.bicep](../infra/main.bicep) | Cumple | — |
| A15 | Al menos 2 alertas | Tres en [main.bicep](../infra/main.bicep): reinicios, CPU de PostgreSQL y latencia ([observability.md](observability.md)) | Cumple | Las tres existen y están activas en Azure (comprobado el 7 nov); que disparen no se ha visto; `ALERT_EMAIL` no se pasa en `deploy.yml` (solo portal) |
| A16 | Estimación de costo mensual dentro de Azure for Students | [azure-cost.md](azure-cost.md) | Cumple | Comprobar en la Pricing Calculator el cargo del entorno, como dice el documento |
| A17 | Recursos de dev apagados o a cero cuando no se usan | Servidor de dev con `minReplicas: 0`; PostgreSQL se detiene a mano; Redis de dev sigue encendido ([azure-setup.md](azure-setup.md) §9) | Cumple parcialmente | Aceptable con la guía; Redis podría pararse o borrarse con el grupo de dev |

## 8. Entregables y rúbrica

| # | Requisito | Evidencia | Estado | Acción |
|---|---|---|---|---|
| E1 | Repositorio en GitHub con lectura para el profesor | Público (D7) | Cumple | — |
| E2 | Contiene servidor, IaC, pipelines, contratos, pruebas, scripts de carga, bot y cliente de prueba | `apps/server`, `infra`, `.github/workflows`, `contracts`, `*.test.ts`, `apps/bot`, `apps/client` | Cumple | — |
| E3 | README: correr en local en menos de 10 minutos | [README.md](../README.md) con `docker compose up --build` (imagen en ~1 min, medido el 7 nov) | Cumple | No se repitió desde cero en esta auditoría |
| E4 | README: cómo correr las pruebas | [README.md](../README.md) «Desarrollo y pruebas» | Cumple | — |
| E5 | README: URL pública en Azure disponible durante la revisión | URL de prod en [README.md](../README.md); `/health/ready` 200, registro y login probados contra prod el 7 nov | Cumple | — |
| E6 | Versión etiquetada `v1.0.0` en la fecha de entrega (12 nov) | Sin tags. Tag `v1.0.0` publicado el 7 nov 2026 | Cumple | Tras el último cambio, mover el tag al commit final |
| E7 | Documentación clara y completa | [docs/README.md](README.md) | Cumple | — |
| E8 | Dominio aislado del transporte y la persistencia; código limpio y consistente | T2; ESLint estricto en verde | Cumple | — |
| E9 | Turnos, temporizadores, reconexión y abandono correctos; ordenado e idempotente; varias réplicas; sobrevive a reinicios | F9–F14, S2–S6, S10 | Cumple | — |
| E10 | AsyncAPI y OpenAPI completos y sincronizados con el código | [contracts.test.ts](../apps/server/src/contracts/contracts.test.ts) compara `contracts/` con lo generado y valida respuestas reales | Cumple | — |
| E11 | Pruebas unitarias, de integración, concurrencia, seguridad y resiliencia en verde en CI | 294 pruebas en local; CI en verde en la última PR | Cumple | — |
| E12 | Logs y trazas correlacionados por partida | `traceId` en los logs con span activo; spans con `ashenfall.match_id` ([telemetry.test.ts](../apps/server/src/telemetry/telemetry.test.ts)) | Cumple | — |
| E13 | Concurrencia en compras y recompensas (pedido en CLAUDE.md, cubre «jugadas duplicadas» y la integridad del saldo) | [shop.test.ts](../apps/server/src/shop/shop.test.ts) «compras simultáneas», [event-store.test.ts](../apps/server/src/matches/event-store.test.ts) «finales simultáneos… pagan una sola vez» | Cumple | — |
| E14 | Prueba con varias réplicas en Azure (rúbrica: «funciona con varias réplicas») | Probado en local con varias instancias contra el mismo PostgreSQL y Redis; prod admite de 1 a 3 réplicas | No verificable aquí | Opcional: escalar prod a 2 réplicas y jugar una partida |
| E15 | Despliegue reproducible con cifras en Azure (latencia real) | Solo cifras locales. El 7 nov se corrió el bot contra prod con 2 partidas (12 jugadas, 0 perdidas, 0 duplicadas, 0 errores) | Cumple parcialmente | Solo un escalón pequeño y desde internet; una carga mayor dentro de Azure gastaría crédito |

El conteo del resumen sale de estas tablas: J 5, F 21, S 10, T 9, SE 12, R 5, A 17, E 15 (94 filas en total).

## Pendientes

**Dependen de pruebas en Azure o del usuario:**
1. Desplegar prod con una partida abierta y comprobar que no se corta (A8).
2. Escalar prod a 2 réplicas y jugar una partida (E14); en local ya se probó con varias instancias.
3. Decidir si `AUTO_DEPLOY=true` durante la revisión (A6). Con Azure for Students dev y prod no caben en la misma región, así que activarlo exige poner dev en otra región (cuesta crédito).
4. Opcional: pasar `ALERT_EMAIL` en `deploy.yml` para recibir las alertas por correo (A15), y repetir una carga mayor dentro de Azure (E15).

**Hechos el 7 nov 2026:** tag `v1.0.0` y URL pública (E5, E6), HTTPS y WSS exclusivos, Key Vault con identidad, telemetría, alertas y revisor de prod (T4, SE7, SE9, A7, A11, A15), rollback medido en 22 s (A9).

**Cerrados en SCRUM-72:** gracia y espera de la cola configurables por entorno (F8, F14), conexiones vivas en la vista de administración (F19), prueba de aislamiento entre partidas (S7) y modelo de amenazas al día (SE12).
