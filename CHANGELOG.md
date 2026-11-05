# Changelog

## Sin publicar
- SCRUM-44, SCRUM-45: Bicep del ambiente completo (red, ACR, PostgreSQL Entra, Key Vault, Redis y servidor en Container Apps), pipeline de despliegue dev/prod con revisiones y drenado, rollback y guías de configuración y costo. Sin desplegar aún.
- SCRUM-44 (parte de código): PostgreSQL con identidad administrada y token de Entra, sin contraseña.
- SCRUM-49, SCRUM-50: bot de carga, punto de quiebre medido y Argon2 acotado para que un pico de logins no afecte a las partidas.
- SCRUM-38, SCRUM-39: CORS, encabezados, límite por usuario, conexiones entre réplicas, escaneo de imagen y modelo de amenazas.
- SCRUM-29, SCRUM-33: OpenAPI 3.1 en /docs y AsyncAPI 3.0 generados desde el código y validados contra respuestas reales.
- SCRUM-28: administración con auditoría; suspender cierra las conexiones abiertas.
- SCRUM-27: billetera, catálogo cosmético, compras idempotentes e inventario.
- SCRUM-26: historial paginado y reproducción jugada por jugada, solo para participantes.
- SCRUM-43: punto de entrada, sondas de salud, imagen Docker no root y docker compose completo.
- SCRUM-32, 35, 36, 37: plazos en servidor sin réplica líder, presencia y difusión por Redis, recuperación tras reinicio, limpieza y recompensa única.
- SCRUM-30, SCRUM-31: gateway WSS con ticket de un solo uso, heartbeat y validación; jugadas ordenadas, idempotentes y confirmadas antes de difundirse.
- SCRUM-25: cola de emparejamiento con espera máxima configurable.
- SCRUM-24: salas públicas y privadas, código de invitación, listo e inicio de partida atómico.
- SCRUM-38 (parte HTTP): límites de tasa por IP y por cuenta con 429 y Retry-After; corrige las alertas de CodeQL que entraron con SCRUM-23.
- SCRUM-23: registro, login, refresh rotativo, logout y perfil, con Argon2id, JWT y Problem Details.
- SCRUM-34: esquema PostgreSQL, migraciones, log de eventos y docker compose local.
- SCRUM-15: monorepo TypeScript strict con ESLint y Vitest.
- SCRUM-19, SCRUM-20: física de proyectiles, armas, arenas y puntos de aparición.
- SCRUM-18, SCRUM-21: máquina de estados, timeout, abandono y resultado.
- SCRUM-22: vista por jugador y test de no-filtración.
- SCRUM-16: CI en GitHub Actions (build, lint y tests en PR y push a main).
- SCRUM-17: Dependabot, CodeQL y gitleaks en CI.
