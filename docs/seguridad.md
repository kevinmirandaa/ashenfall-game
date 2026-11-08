# Seguridad del servidor

Cómo se protege el servidor de ASHENFALL, con los valores reales de configuración. Las amenazas, su defensa y su prueba, una por una, están en [threat-model.md](threat-model.md); la arquitectura, en [arquitectura.md](arquitectura.md); cómo cumple cada requisito del enunciado, en [cumplimiento-enunciado.md](cumplimiento-enunciado.md). Para reportar un problema, ver [SECURITY.md](../SECURITY.md).

## 1. Autenticación
- **Tokens:** JWT firmados con HS256, emitidos por el propio servidor (el enunciado lo permite), con emisor y audiencia verificados y el algoritmo fijado (un token con `alg: none` se rechaza). El token de acceso dura **15 minutos**.
- **Refresh token rotativo:** dura 30 días y solo se guarda su hash. Cada renovación entrega uno nuevo y reutilizar uno ya usado revoca toda la familia.
- **Contraseñas:** Argon2id con 19 MiB de memoria, 2 iteraciones y paralelismo 1 (configuración mínima recomendada por OWASP). El hasher admite una contraseña a la vez y una fila de 32; si se llena, el servidor responde 503 en vez de agotar CPU y memoria a las partidas en curso. El login hace una verificación señuelo si el correo no existe, para no revelar qué cuentas existen.
- **Secreto de firma:** mínimo 32 caracteres, leído de Key Vault; el servidor se niega a arrancar sin él y no tiene ningún valor por defecto.
- **WebSocket:** se autentica en el handshake con un **ticket de un solo uso** de 30 segundos (`POST /v1/ws-ticket`, guardado en Redis y consumido al conectar). Sin un ticket válido, la conexión se cierra.

## 2. Autorización
- Solo los participantes actúan en su partida: las salas, partidas y replays ajenos responden 404, idéntico al de un recurso inexistente, para que no se pueda sondear.
- Solo juega quien tiene el turno: el dominio valida turno y versión en cada mensaje `shoot`.
- Solo el administrador usa `/v1/admin`: el rol se lee de la base de datos en cada petición y ninguna ruta de la API lo concede (se asigna con una herramienta de línea de comandos); cada acción de administración queda auditada con autor, motivo y fecha.
- Un usuario suspendido pierde sus conexiones en todas las réplicas (código de cierre 4003).

## 3. Validación de mensajes
Cada mensaje entrante se valida contra su esquema (tipos, rangos y tamaño máximo de 4 KiB, aplicado también por la propia librería `ws`) antes de llegar al dominio, y los campos extra se rechazan. Un mensaje inválido recibe `INVALID_MESSAGE` y no cierra la conexión ni la partida. En REST, el cuerpo máximo es de 16 KiB y cada ruta valida su cuerpo con el esquema del contrato.

## 4. Límites

| Límite | Valor | Configuración |
|---|---|---|
| Tasa global de HTTP | 600 peticiones por minuto, por usuario (token válido) o por IP | `RATE_LIMIT_GLOBAL_PER_MINUTE` |
| Tasa de rutas de autenticación | 20 por minuto por IP | `RATE_LIMIT_AUTH_PER_MINUTE` |
| Intentos de login por cuenta | 10 por minuto, en cualquier IP | `RATE_LIMIT_LOGIN_PER_MINUTE` |
| Respuesta al exceder | HTTP 429 con `Retry-After` | Problem Details `RATE_LIMITED` |
| Mensajes por conexión WebSocket | 20 por segundo; al triplicarlo se cierra con 4029 | Pasarela |
| Tamaño máximo de mensaje | 4 KiB en WebSocket y 16 KiB en el cuerpo HTTP | `maxPayload` y `bodyLimit` |
| Conexiones por usuario | 3, contadas entre todas las réplicas con Redis | Pasarela y presencia |
| Sonda `/health/ready` | 120 por minuto | Para no saturar la base con las sondas |

Los contadores viven en Redis, así que el límite vale entre réplicas; si Redis cae, el límite de login sigue por réplica.

## 5. Transporte
- **Solo HTTPS y WSS:** el ingress de Container Apps tiene `allowInsecure` en `false` y redirige `http://` con 301; el servidor corre con `ENFORCE_HTTPS=1` (la CSP solo permite `wss:`) y con `TRUST_PROXY=1` para ver la IP real tras el ingress.
- **Cabeceras de seguridad** con `@fastify/helmet`: Strict-Transport-Security (un año, `includeSubDomains`), Content-Security-Policy (`default-src`, `script-src` y `connect-src` solo del mismo origen, `object-src 'none'`, `frame-ancestors 'self'`, `upgrade-insecure-requests`), `X-Content-Type-Options: nosniff` y las demás de helmet.
- **CORS restringido:** `ALLOWED_ORIGINS` está vacío en producción (el cliente se sirve del mismo origen), así que ningún origen ajeno recibe `Access-Control-Allow-Origin`; métodos GET, POST y DELETE y cabeceras `authorization` y `content-type`.
- **Origen del WebSocket restringido:** un handshake con un `Origin` ajeno recibe 403.

## 6. Secretos e identidad administrada
- El secreto de los JWT (`jwt-secret`) y la cadena de Application Insights están en **Key Vault**; el Container App los lee como referencias de secreto con la identidad administrada `id-ashenfall-prod`, que tiene solo los roles *Key Vault Secrets User* (sobre el Key Vault) y *AcrPull* (sobre el registro).
- PostgreSQL se accede con un token de **Microsoft Entra** de esa misma identidad: la autenticación por contraseña está desactivada y la cadena de conexión no lleva clave. Redis no tiene contraseña porque solo tiene ingress interno y vive dentro del entorno.
- Ninguna clave ni cadena de conexión está en la configuración en texto plano (se comprobó con `az containerapp show`: solo las referencias a Key Vault) ni en el repositorio: gitleaks revisa el historial completo en cada cambio.
- El pipeline entra a Azure con **OIDC federado**, sin secretos: una identidad administrada `ashenfall-github` con credenciales federadas para los *environments* `dev` y `prod` de GitHub.

## 7. Red
El servidor es la única pieza con ingress externo. Redis solo es accesible desde dentro del entorno por su nombre interno. PostgreSQL tiene el acceso público desactivado: solo se llega desde la red virtual, mediante una subred delegada y una zona DNS privada.

## 8. Cadena de suministro

| Control | Configuración |
|---|---|
| Dependabot | Alertas de vulnerabilidades activadas (0 abiertas tras SCRUM-87) y revisión semanal de dependencias npm y acciones de GitHub; los saltos de versión mayor se revisan a mano. |
| CodeQL (análisis de código) | En cada pull request, en cada push a `main` y cada lunes. |
| gitleaks (secretos) | En cada pull request y push; revisa todo el historial con `--exit-code 1`. |
| Trivy (imagen del contenedor) | En cada pull request, push y cada lunes; falla si hay vulnerabilidades CRITICAL. |
| Imagen del contenedor | Multietapa sobre `node:22-alpine`; corre como el usuario no root `node`; se eliminan npm y corepack de la imagen final; `HEALTHCHECK` a `/health/live`. |

## 9. No filtración de información oculta
El juego casi no tiene información oculta: la posición del rival y la trayectoria son públicas dentro de la partida por decisión de diseño (la cámara las muestra a ambos), y el enunciado marca la información oculta como recomendada, no obligatoria. Aun así hay una **vista por jugador**: el rival nunca recibe el ángulo, la potencia ni el `actionId` de una jugada, ni por WebSocket, ni por REST (el replay), ni en los logs, y hay pruebas que lo verifican en cada canal (`view.test.ts`, `gateway.test.ts`, `history.test.ts`).

## 10. Riesgos aceptados
- Un cliente modificado puede calcular el tiro perfecto, porque la posición y la física son públicas por diseño.
- Agotar el límite de login por cuenta bloquea a su dueño un minuto; se prefiere a permitir fuerza bruta distribuida.
- Con Redis caído, los límites por plugin dejan de aplicarse para no tumbar el servicio y no se pueden emitir tickets nuevos.
- El ticket viaja en la URL del handshake: es de un solo uso y dura 30 s, y el servidor no registra esa URL.
- Una réplica que cae de golpe no registra desconexiones; sus partidas terminan por los plazos de turno.

## 11. Verificado en Azure (7 de noviembre de 2026)
- `http://` responde 301; hay HSTS y CSP; un `Origin` ajeno en `/ws` recibe 403 y no recibe cabecera CORS.
- El login devuelve 429 con `Retry-After` tras repetir intentos fallidos.
- Los secretos del Container App son referencias a Key Vault con identidad administrada; la cadena de PostgreSQL no lleva contraseña.
- PostgreSQL tiene el acceso público desactivado y vive en una subred delegada; Redis solo tiene ingress interno.
- El *environment* `prod` de GitHub tiene un revisor obligatorio y el despliegue del 7 de noviembre esperó su aprobación.
