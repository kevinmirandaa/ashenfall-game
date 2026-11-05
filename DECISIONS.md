# Decisiones

## D1. Visibilidad: la posición del rival es pública dentro de la partida
Decisión del usuario (5 nov 2026), que reemplaza la regla anterior de ocultar al rival. La cámara muestra tu personaje, panea hasta el rival y luego sigue cada disparo, igual para ambos jugadores.

Consecuencia: el juego casi no tiene información oculta, algo que el enunciado recomienda pero no exige. Se mantiene la vista por jugador: el rival no recibe `actionId`, ángulo ni potencia, y un tercero no recibe nada.

## D2. Aparición sorteada por partida
Cada arena define pares de puntos de aparición simétricos. El servidor sortea arena, par, lado, viento y primer turno. Los personajes no se mueven durante la partida. Si la posición dependiera solo de la arena, el paneo inicial no aportaría nada. Esta parte la decidió Claude a partir del ejemplo del usuario y es fácil de revertir.

## D3. Event sourcing en el dominio
`decide(estado, comando)` produce eventos y `evolve(estado, evento)` los aplica. Recuperar tras un reinicio y reproducir una partida es plegar el log, sin volver a simular.

## D4. Física por pasos fijos
Euler semiimplícito a 60 Hz, con colisión por segmento para evitar que un proyectil atraviese un objetivo. Es más simple que una fórmula cerrada cuando hay viento, obstáculos y escala por arma. El resultado queda guardado en el evento.

## D5. Dos contadores: `seq` y `version`
`seq` numera todos los eventos. `version` solo cambia con eventos de juego, para que una desconexión del rival no invalide una jugada en camino.

## D6. Reglas de fin de partida
- Timeout: pasa el turno sin daño; 2 consecutivos del mismo jugador son abandono.
- Límite de rondas: gana quien tiene más vida; con igual vida hay empate.
- Gracia vencida: pierde el desconectado; si ambos están desconectados, no hay ganador.
- Terminación por administrador: sin ganador.

## D7. Repositorio público
Decisión del usuario, para disponer de CodeQL y aprobación manual a prod sin coste. `Proyecto3.pdf` y `references/` no se versionan.

## D8. Pueblo en vista lateral (side-view)
Es la perspectiva que usan el combate y el prompt de arte del brief.

## D9. Sin bloqueo distribuido por partida
SCRUM-35 proponía un bloqueo en Redis. En su lugar, cada réplica ordena sus jugadas en una fila interna y entre réplicas decide la clave `(match_id, seq)` de PostgreSQL: la perdedora relee el log y vuelve a decidir. La garantía queda en la misma transacción que guarda la jugada; un bloqueo con caducidad podría vencer a mitad de una jugada y no eliminaría la necesidad de esa clave.

## D10. Plazos sin réplica líder
El próximo plazo se guarda en `matches.next_deadline_ms` y todas las réplicas lo barren. Repetir un barrido es inofensivo. Tras una caída brusca no se registra la desconexión, y esas partidas terminan por los timeouts de turno.

## Pendientes
- Redis gestionado o en Container Apps: se decide al estimar el costo en Azure.
- Alcance de la guía de trayectoria: con posición del rival conocida, una guía completa haría trivial apuntar. Se decide en SCRUM-41.
- Valores de armas: son iniciales y no se han probado jugando.
