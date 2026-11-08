# Modelo de amenazas

Método: STRIDE sobre los activos y las fronteras de confianza del servidor. La columna "Prueba" indica dónde se verifica; "Sin prueba" significa que la defensa existe pero no hay test automático.

## Activos
Cuentas y tokens, integridad de la partida, saldo de Marcas de Ceniza, disponibilidad, funciones de administración y secretos de infraestructura.

## Fronteras de confianza
1. Cliente → servidor (HTTP y WebSocket): todo lo que llega es hostil hasta validarse.
2. Servidor → PostgreSQL y Redis: red privada e identidad administrada en Azure (comprobado el 7 nov 2026: PostgreSQL sin acceso público y dentro de la red virtual, Redis con ingress interno).
3. CI/CD → Azure: GitHub Actions con OIDC federado, sin secretos (`.github/workflows/deploy.yml`); prod exige aprobación manual (el environment `prod` tiene un revisor obligatorio, comprobado el 7 nov 2026).

## Amenazas y defensas

| STRIDE | Amenaza | Defensa | Prueba |
|---|---|---|---|
| Suplantación | Fuerza bruta de contraseñas | Límite por IP y por cuenta; Argon2id | `auth/rate-limit.test.ts` |
| Suplantación | Enumerar cuentas por el login | Mismo error y verificación señuelo si el correo no existe | `auth/auth.test.ts` (solo el mensaje, no el tiempo) |
| Suplantación | Robo de refresh token | Rotación; reutilizar revoca la familia; solo se guarda el hash | `auth/auth.test.ts` |
| Suplantación | JWT falsificado o `alg: none` | Algoritmo fijo, emisor y audiencia verificados | `auth/auth.test.ts` |
| Suplantación | Secuestrar el WebSocket desde otra web | Ticket de un solo uso (30 s) y orígenes restringidos | `realtime/gateway.test.ts` |
| Manipulación | Enviar daño o resultados | El esquema rechaza campos extra; el servidor calcula todo | `realtime/gateway.test.ts` |
| Manipulación | Jugar fuera de turno o sobre estado viejo | El dominio valida turno y versión | `match.test.ts`, `gateway.test.ts` |
| Manipulación | Reenviar una jugada | `actionId` idempotente; clave `(match_id, seq)` | `gateway.test.ts`, `resilience.test.ts` |
| Manipulación | Inyección SQL | Solo consultas parametrizadas; validación previa | `rooms/rooms.test.ts` (parcial) |
| Manipulación | Fijar el precio o duplicar monedas | Precio del servidor; billetera bloqueada; claves únicas | `shop/shop.test.ts`, `matches/event-store.test.ts` |
| Repudio | Un administrador niega una acción | Auditoría con autor, motivo y fecha | `admin/admin.test.ts` |
| Divulgación | Ver datos del rival | Vista por jugador sin ángulo, potencia ni `actionId` | `view.test.ts`, `gateway.test.ts`, `history.test.ts` |
| Divulgación | Ver partidas o salas ajenas | 404 idéntico al de un recurso inexistente | `history.test.ts`, `rooms.test.ts`, `gateway.test.ts` |
| Divulgación | Secretos en logs | Sin cuerpos ni cabeceras de autorización en logs | `security/hardening.test.ts` |
| Divulgación | Detalles internos en errores | Problem Details genérico en 500 | `security/hardening.test.ts` |
| Divulgación | Secreto en el repositorio | gitleaks en CI; sin valores por defecto | CI |
| Denegación | Inundar la API | Límite por usuario e IP con 429 y `Retry-After` | `rate-limit.test.ts`, `hardening.test.ts` |
| Denegación | Inundar el WebSocket | Tamaño máximo, tasa por conexión, conexiones por usuario | `gateway.test.ts`, `hardening.test.ts` |
| Denegación | Pico de logins agota CPU o memoria | Argon2id acotado con fila y 503 | `auth/password-hasher.test.ts`, `docs/load-report.md` |
| Denegación | Saturar la base con la sonda | Límite propio en `/health/ready` | `health.test.ts` |
| Denegación | Fallo que tumba el servidor | Errores aislados por mensaje y por partida: fila por partida en el motor, `try/catch` por partida en el barrido | `gateway.test.ts`, `resilience.test.ts` (aislamiento: log dañado en una partida) |
| Elevación | Jugador usa funciones de administrador | Rol leído de la base en cada petición; ninguna ruta lo concede | `admin/admin.test.ts`, `hardening.test.ts` |
| Elevación | Imagen comprometida | Usuario no root; Trivy y Dependabot en CI | CI |

## Riesgos aceptados
- **La posición del rival es pública.** Es decisión de diseño (D1): el juego casi no tiene información oculta. Un cliente modificado solo obtiene lo que el jugador ya ve.
- **Un cliente modificado puede apuntar perfecto.** Con la posición y la física conocidas, se puede calcular el tiro ideal. No se puede evitar sin ocultar datos que el diseño muestra.
- **Bloqueo de login ajeno.** Agotar el límite por cuenta bloquea a su dueño un minuto; se prefiere a permitir fuerza bruta distribuida.
- **Redis caído.** Los límites de plugin dejan de aplicarse para no tumbar el servicio; el de login sigue por réplica. Los tickets no se pueden emitir y no se abren conexiones nuevas.
- **Ticket en la URL.** Puede aparecer en logs de un proxy; es de un solo uso y dura 30 s. El servidor no registra esa URL.
- **Conexiones por usuario.** La cuenta entre réplicas no es atómica: varias conexiones exactamente simultáneas pueden superar el máximo por poco.
- **Terminar partida y auditar.** No están en la misma transacción, porque la partida pasa por el motor. Si la base falla justo entre ambas, la terminación queda sin auditar. Suspender y reactivar sí son atómicos.
- **Partidas entre cuentas propias.** Se pueden generar monedas jugando contra uno mismo; solo compran personajes y no hay ranking.
- **Caída brusca de una réplica.** No registra desconexiones; las partidas terminan por timeouts de turno.

## Verificado en Azure (7 nov 2026)
- HTTPS y WSS exclusivos: `http://` redirige con 301, hay HSTS y un `Origin` ajeno recibe 403 en `/ws`; CORS no devuelve `Access-Control-Allow-Origin` a un origen ajeno.
- Key Vault e identidad administrada: `jwt-secret` y la cadena de Application Insights son referencias a Key Vault con la identidad `id-ashenfall-prod`; la cadena de PostgreSQL no lleva contraseña.
- Redis y PostgreSQL no están expuestos a internet: Redis solo tiene ingress interno y PostgreSQL tiene el acceso público desactivado y vive en una subred delegada.
- Límite de tasa: el login devuelve 429 con `Retry-After` al repetir intentos fallidos.
