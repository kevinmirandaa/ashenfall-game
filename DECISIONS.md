# Decisiones

## D1. Visibilidad: la posición del rival es pública dentro de la partida
Decisión del usuario (5 nov 2026), que reemplaza la regla anterior de ocultar al rival. La cámara muestra tu personaje, panea hasta el rival y luego sigue cada disparo, igual para ambos jugadores.

Consecuencia: el juego casi no tiene información oculta, algo que el enunciado recomienda pero no exige. Se mantiene la vista por jugador: el rival no recibe `actionId`, ángulo ni potencia, y un tercero no recibe nada.

## D2. Aparición sorteada por partida
Cada arena define pares de puntos de aparición simétricos. El servidor sortea arena, par, lado, viento y primer turno. Los personajes empiezan quietos y solo se mueven por retroceso al ser impactados (ver SCRUM-58). Si la posición dependiera solo de la arena, el paneo inicial no aportaría nada. Esta parte la decidió Claude a partir del ejemplo del usuario y es fácil de revertir.

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

## D11. Argon2id acotado
19 MiB, t=2, p=1 (mínimo de OWASP), una contraseña a la vez y fila de 32. Lo que no cabe recibe 503. Protege las partidas en curso a costa de rechazar logins en un pico. Ver [docs/load-report.md](docs/load-report.md).

## D12. Azure: Redis en Container Apps sin contraseña y otras sustituciones
- Redis corre como Container App (`redis:7-alpine`, ingress TCP interno, 0,25 CPU) en vez de Azure Cache for Redis, por costo en Azure for Students. No tiene contraseña: la frontera es la red (solo es alcanzable dentro del entorno de Container Apps, sin ingress externo). Redis guarda solo estado caliente (presencia, difusión entre réplicas, límites de tasa); la verdad está en PostgreSQL, así que perderlo no pierde partidas ni monedas. Sin persistencia (`--save "" --appendonly no`).
- PostgreSQL solo con Entra (sin contraseña) y sin acceso público; el administrador es la identidad administrada de la app. Los logs del entorno van por Azure Monitor para no pasar la clave del workspace.
- `jwt-secret` no puede generarse en Bicep sin exponerse: lo crea el pipeline con `openssl rand` solo si no existe y el contenedor lo lee de Key Vault por identidad. Key Vault tiene acceso público de red (con RBAC) porque los runners de GitHub no están en la VNet.
- Despliegue en dos pasadas (infraestructura base, imagen, app) en vez de una imagen de arranque.
- Revisiones: en prod la nueva nace al 0 %, se prueba por su URL de revisión y luego recibe el tráfico. Se desactivan las revisiones más antiguas; la inmediatamente anterior queda activa como destino de rollback y se desactiva en el siguiente despliegue.

## D13. Cliente ligero
Phaser con renderizador Canvas y arte por código, servido por el propio servidor: sin otro servicio que pagar y sin CORS. La guía muestra solo el 30 % inicial del arco, porque la posición del rival es visible y una guía completa haría trivial apuntar. Con la pestaña oculta se omiten las animaciones para que la partida no se detenga.

## Pendientes
- Valores de armas: son iniciales y no se han probado jugando.

## Arma única, daño por zona y apuntado con ratón (SCRUM-55)
Decisión del usuario (6 nov 2026), que reemplaza la selección libre de armas. Edrik usa arco, Sylwen lanza y Borgrim hacha; se retira la daga. El servidor guarda el personaje, lo fija al empezar la partida y rechaza cualquier otra arma. Todas las armas tienen 26 de daño base, para mantener la regla de personajes sin diferencias de stats; solo cambia su vuelo. El daño se multiplica por zona (cabeza x1.5, torso x1, piernas x0.7) y por potencia (Débil x0.7, Media x1, Fuerte x1.3), con un máximo de 50 por tiro.

Un ratón normal no informa de la fuerza de la pulsación al navegador: la posición da el ángulo, mantener pulsado carga la potencia y soltar dispara. Los obstáculos nuevos son rectángulos de colisión; cambia su dibujo, no su forma lógica.

## Retroceso permanente, tirachinas y menú (SCRUM-56, 57, 58)
Decisión del usuario (6 nov 2026). Un impacto con daño hace retroceder al personaje, alejándose del tirador, `3` unidades por punto de daño con tope de `240`. Nunca vuelve: la posición es estado de la partida (`PlayerState.position`), viaja en `shot_resolved.targetPosition` y se publica a ambos jugadores, porque la posición del rival ya era pública. Así un jugador que calculó dónde caía su tiro tiene que recalcularlo. Reglas: se mueve en pasos fijos de 2 unidades, se detiene en el borde de la arena (margen de 40) y ante un obstáculo de más de 24 de alto, sube desniveles menores y cae al suelo si pierde el apoyo de una repisa. Un disparo sin daño no mueve a nadie. `PHYSICS_VERSION` pasa a 3; los eventos antiguos sin `targetPosition` se reproducen sin movimiento.

Disparo tirachinas, solo ratón: pulsar fija el ancla, arrastrar hacia atrás tensa (la distancia da la potencia, hasta 240 px de pantalla, y la dirección el ángulo: tirar hacia abajo y atrás lanza hacia arriba y delante) y soltar dispara. Menos de 28 px o Esc cancelan. La barra inferior del pueblo es una pieza independiente que se arrastra y recuerda su sitio durante la sesión; se retira la Taberna y «Jugar» abre el emparejamiento. Para el fondo del pueblo se borró el rótulo de la Taberna y se rellenó el suelo con adoquines de la propia imagen.

## Zonas de impacto, guía, menú y audio (SCRUM-59, 60, 61)
La hitbox lógica medía 96 de alto mientras el dibujo mide unos 140, así que un impacto en el pecho caía en el cuarto superior y contaba como cabeza. Ahora mide 140 (igual para todos los personajes), la cabeza es el 13 % superior, las piernas el 40 % inferior y el resto es torso; `PHYSICS_VERSION` pasa a 4 y el punto de salida del proyectil sube a 92. La guía de puntería añade un transportador junto al arma (línea de 0°, arco y flecha) y puntos que se desvanecen con contorno oscuro para leerse sobre nieve y sobre bosque.

El pueblo pierde el Gremio, el botón «+» de las monedas y el de cerrar sesión (queda en Ajustes). La barra inferior se rehace como componente de interfaz arrastrable con Personajes y Jugar. El audio se genera con Web Audio, sin archivos ni derechos: música de pueblo (laúd, flauta y bordón en modo dórico) y de combate (tambores y bajo), y efectos por arma, impacto según zona, obstáculo, suelo, interfaz, compra, victoria y derrota. Solo suena tras el primer gesto del usuario y el volumen se guarda en el navegador. Las esperas de la cola de animaciones usan el reloj del navegador para que una ventana tapada no deje la partida en pausa.

## Pendiente por decisión del usuario (6 nov 2026)
Armas compradas con peso y efectos de estado (SCRUM-62), personajes comprables (SCRUM-63), pociones de un solo uso (SCRUM-64) y modo contra bot e historia con monstruos (SCRUM-65). Cambian la regla de tienda solo cosmética y añaden PvE, que el brief original dejaba fuera de alcance; el PvP entre humanos y los requisitos del servidor no cambian. Se trabajan después de los requisitos de Azure y de rendimiento si el plazo lo permite.

## Armas por familia, personajes comprables y arenas nuevas (SCRUM-62, 63)
Decisión del usuario (7 nov 2026) que reemplaza la regla de tienda solo cosmética y la selección de armas del SCRUM-55. Hay ocho familias de arma (daga, arco, ballesta, hacha, espada, bastón, frasco y maza) y cada personaje pertenece a una; solo puede mejorar su arma dentro de ella. Cada familia tiene tres niveles: el común (gratis), uno mejor (600) y uno especial (de 1500 a 2000) que deja veneno o fuego, de 2 a 5 de daño por segundo durante 3 segundos. El servidor suma el efecto al daño del impacto en el mismo evento (`effect`, ya descontado de `targetHpAfter`), así que no hay temporizadores ni estado intermedio; el cliente lo muestra segundo a segundo. El peso (ligera, media o pesada) cambia la velocidad y la gravedad del proyectil: lo pesado cae más y pide más potencia y ángulo, lo ligero vuela más tenso.

El daño base baja a 12, 15 y 17 según el nivel, con tope de 30 por tiro, para que las partidas duren más. Las zonas siguen afectando al daño (cabeza 1.4, torso 1, piernas 0.75) pero la interfaz solo muestra el número. Diez personajes salen de la hoja de referencia y sustituyen a los anteriores: se empieza con Edrik y los demás se compran (de 500 a 1200). El servidor exige haber comprado un personaje para elegirlo y, al empezar la partida, fija el arma equipada de la familia del personaje; las de otra familia se ignoran y un disparo con un arma distinta se rechaza. El catálogo vive en la migración 007 y una prueba comprueba que sus precios coinciden con el dominio.

Siete arenas, recortadas de la hoja de referencia, sustituyen a las tres anteriores. Todas colocan sus obstáculos entre x = 560 y x = 1440, de modo que detrás de cada jugador no hay nada que frene el retroceso; cada obstáculo tiene una forma según el bioma (lápida, cactus, hielo, muro en ruinas, caja, roca, tocón, árbol seco, columna). La base de datos local se reinició para aplicar el cambio; no había nada desplegado.
