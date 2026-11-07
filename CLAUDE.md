# ASHENFALL — Contexto para Claude (leer primero)

Proyecto académico. Entrega: **12 nov 2026** (tag `v1.0.0`; cada día tarde = -10%). Hoy en el plan: 5 nov.
Fuentes completas (leer solo si hace falta un detalle): `Proyecto3.pdf` (enunciado, manda siempre), `docs/ASHENFALL_MASTER_BRIEF.md` (diseño, arte, arquitectura; secciones 12–16 y 19 son las técnicas), `references/*.png` (moodboards, no sprites).
Idioma con el usuario: español.

## Qué se evalúa
Solo el **servidor** (juego/arte/cliente sin nota, pero el juego debe cumplir restricciones). Pesos: Arquitectura 20, Sesiones/concurrencia 20, Seguridad 20, Rendimiento 15, Azure/IaC/CI-CD 10, Contratos/pruebas 10, Docs/observabilidad 5. Un secreto en el repo limita Seguridad al 50%.

## Juego
Duelo 1v1 por turnos de proyectiles, fantasía oscura, pixel art 2D, web. Los personajes solo se mueven al ser impactados: retroceden según el daño y no vuelven (SCRUM-58). Diez personajes: se empieza con Edrik y los otros nueve se compran en el Arsenal con nivel y dinero. Cada uno usa siempre su arma (no hay cambio de armas) y la tienda solo vende personajes. Sin viento. Ver SCRUM-66 en docs/DECISIONS.md, que reemplaza lo anterior sobre armas, pociones y cosméticos. Siete arenas (aldea en ruinas, cementerio, desierto, pinar con niebla, puente helado, fortaleza carmesí, ruinas brumosas). Viento fijo por partida. 100 HP, turno 30 s, máx 12 rondas. Victoria = +100 monedas (Marcas de Ceniza), derrota/empate = 0. La tienda vende solo personajes (decisión del usuario; el brief original decía cosméticos). Modo historia contra 10 monstruos; el bot lo mueve el servidor (ver SCRUM-65 en docs/DECISIONS.md). Pueblo estático con hotspots (Arsenal, Alquimista, Gremio, Perfil, Historial) y barra inferior arrastrable; sin Taberna. Disparo estilo tirachinas con el ratón (arrastrar hacia atrás y soltar).

### Regla de visibilidad (decidida por el usuario)
- Arena aleatoria; cada jugador aparece en una coordenada (x, y) de esa arena y no se mueve en toda la partida.
- Al inicio la cámara muestra tu personaje y luego panea hasta el rival, para estimar la distancia. Después queda en quien va a disparar.
- Cada disparo: la cámara sigue la trayectoria y termina donde acabó el tiro o en el rival si impactó; luego espera el disparo del otro. Igual para ambos jugadores.
- Por tanto, la posición del rival y la trayectoria son públicas dentro de la partida. Esto reemplaza la regla anterior de "el rival no se muestra".
- Servidor: sigue habiendo vista por jugador y test de no-filtración (ángulo/potencia/actionId del rival, datos privados, tokens), en mensajes, REST y logs.
- Prioridad cliente: **PC** (mouse/teclado, 16:9) primero; móvil después.

## Stack
TypeScript strict (sin `any`) + Node 20+ (en Docker/CI fijar Node 22 LTS; el Mac tiene v26). Dominio puro sin red/BD/framework. REST OpenAPI 3.1 en `/docs`, errores RFC 9457. WSS con AsyncAPI 3.0, ticket de un solo uso, heartbeat, códigos de cierre documentados, validación de esquema por mensaje. PostgreSQL + Redis. Cliente Phaser 3 + Vite. Docker (usuario no root) + docker compose para correr local en <10 min. Bicep + GitHub Actions, OpenTelemetry/App Insights, `/health/live` `/health/ready`, 2+ alertas, Key Vault + Managed Identity. Tests: dominio, física, API, WS, concurrencia, idempotencia, reconexión, reinicio, authz, rate limit, compras concurrentes, recompensa duplicada, carga con bot, punto de quiebre, 1 optimización con cifras antes/después.

## Flujo de trabajo (el usuario exige evidencia de orden)
- Repo: https://github.com/kevinmirandaa/ashenfall-game.git, **público** por decisión del usuario (CodeQL y aprobación manual a prod sin coste).
- Jira: sitio kevinmirandaa04.atlassian.net, proyecto clave **SCRUM** (SCRUM-1 a 4 son ejemplos, no tocarlos). Un ticket por tarea, rama por ticket, commits con clave (ej. `SCRUM-12: ...`), PR por ticket, mover estados en Jira. Todo lo hace Claude; el usuario solo autentica.
- `gh` instalado (requiere `gh auth login` del usuario); `az` NO instalado. Azure lo conecta el usuario manualmente desde el portal; Claude entrega Bicep, pipeline y guía paso a paso. Docker Desktop disponible en el Mac.
- Mantener `docs/DECISIONS.md`, `CHANGELOG.md`, README reproducible. No afirmar pruebas/despliegues/cifras sin ejecutarlos. Antes de cada fase decir objetivo y archivos; después, resultados reales.
- Confirmar con el usuario antes de acciones externas (push, crear repo/tickets masivos) la primera vez.

## Prioridad y recortes
1) vertical slice 2 jugadores que termina partida; 2) dominio + persistencia; 3) concurrencia/idempotencia/reconexión; 4) seguridad + Azure; 5) pruebas y docs; 6) pueblo y arte mínimo (sprites/fondos generados por código); 7) cosméticos al final. Si falta tiempo, recortar cosméticos/pociones/biomas extra, nunca requisitos del servidor.

## Hitos
5–6 nov repo+Jira+dominio/tests · 7–8 API+WS+persistencia · 9–10 cliente mínimo+Azure+CI/CD · 11 carga+docs · 12 tag v1.0.0 y revisión.

## Modelos
Opus: dominio, concurrencia, seguridad, cliente y arte. Sonnet (medio/bajo): Jira, GitHub, Bicep/CI, documentación.

## Decisiones abiertas (resolver y documentar en docs/DECISIONS.md)
Timeout (recomendado: pasa turno sin daño; 2 consecutivos = abandono), empate en límite de rondas (sí), perspectiva del pueblo (elegir una: side-view), simulación servidor por pasos fijos vs fórmula determinista, sustituir Azure Cache for Redis por Redis en Container Apps si el costo en Azure for Students lo exige.
