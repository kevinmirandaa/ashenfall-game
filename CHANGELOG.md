# Changelog

## Sin publicar
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
