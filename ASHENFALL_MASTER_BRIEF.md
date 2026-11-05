# ASHENFALL — MASTER GAME DESIGN & DEVELOPMENT BRIEF
## The Last Mercenary Guild

**Documento maestro para Claude Opus**  
**Versión:** 1.0.0 — consolidación de decisiones  
**Fecha de referencia:** 5 de noviembre de 2026  
**Entrega académica indicada:** 12 de noviembre de 2026  
**Plataforma:** navegador web (PC y móvil)  
**Género:** duelo competitivo 2D de proyectiles, fantasía medieval oscura  
**Arte:** pixel art 2D  
**Idioma de este documento:** español

> **Instrucción principal para Claude Opus:** utiliza este documento como fuente de verdad del producto. No cambies decisiones de diseño sin explicar el motivo y pedir confirmación. Prioriza un vertical slice funcional y los requisitos del servidor académico. No construyas funcionalidades fuera del MVP hasta que el núcleo esté probado. Si un requisito académico contradice una decisión de este documento, informa el conflicto y prioriza el requisito académico para la entrega, sin alterar silenciosamente el concepto del juego.

---

# 0. Cómo utilizar este documento

Este archivo reúne:
1. La visión del videojuego y su identidad.
2. El lore original y el tono narrativo.
3. Las reglas completas del combate.
4. El pueblo estático y sus tiendas.
5. Personajes, armas, objetos, biomas y economía.
6. La experiencia de usuario y las pantallas.
7. La dirección artística y las referencias visuales.
8. La lista de assets y prompts para generarlos.
9. La arquitectura del servidor y del cliente.
10. Los requisitos académicos extraídos del brief `Proyecto3.pdf`.
11. El alcance, los criterios de aceptación y el plan de implementación.

## Jerarquía de decisiones

Si existen contradicciones entre ideas antiguas y nuevas, aplicar este orden:

1. Requisitos obligatorios del documento académico `Proyecto3.pdf`.
2. Decisiones más recientes del usuario recogidas en este documento.
3. Recomendaciones técnicas de este documento.
4. Suposiciones temporales, que deben poder configurarse.

## Decisiones definitivas del concepto

- El pueblo es una **escena estática interactiva**. El personaje no camina por él.
- En combate, ambos personajes permanecen **completamente estáticos en posiciones fijas**.
- El combate es **1 contra 1, por turnos, con proyectiles físicos**.
- La inspiración de interacción es Bowmasters: apuntar, ajustar potencia, ver una guía de trayectoria y disparar.
- La guía de trayectoria es una **predicción visual local**; el servidor calcula el resultado real.
- No hay movimiento libre, saltos, esquivas, plataformas móviles ni desplazamiento de personajes.
- No existe retroceso que cambie la posición del personaje. El impacto puede tener animación visual, pero no altera la posición lógica.
- Los jugadores ganan monedas al **ganar** partidas. Las derrotas no entregan monedas en el diseño base.
- Las monedas se acumulan en una bolsa y se gastan en el pueblo en elementos cosméticos.
- No hay niveles de personaje, estadísticas comprables, armas pay-to-win, monedas premium ni economía compleja.
- Las diferencias de armas son parte del diseño de combate y deben estar disponibles en condiciones competitivas justas; la tienda vende apariencias, no poder.
- El tono es fantasía medieval oscura, inspirado en la atmósfera de The Witcher, pero el mundo, personajes, nombres, criaturas, historia, diálogos, diseños y assets deben ser originales.

---

# 1. Visión del producto

## 1.1 Logline

En un mundo medieval consumido por antiguas cenizas, mercenarios de regiones olvidadas se reúnen en el asentamiento de Ashenfall para enfrentarse en duelos de proyectiles. Los jugadores preparan su apariencia, eligen su arma, entran a una arena con condiciones ambientales distintas, calculan sus disparos y regresan al pueblo con monedas si consiguen la victoria.

## 1.2 Qué experiencia queremos

ASHENFALL debe sentirse como un pequeño videojuego indie terminado, no como una demo técnica o un conjunto de pantallas académicas.

La experiencia tiene dos ritmos:
- **Pueblo:** tranquilo, acogedor, misterioso y mercantil. Es el lugar para prepararse y personalizarse.
- **Arena:** tenso, competitivo y directo. El jugador piensa, apunta y dispara.

El jugador debe comprender el objetivo en menos de un minuto: apuntar bien, calcular la potencia, disparar, derrotar al rival y ganar monedas para personalizar su mercenario.

## 1.3 Pilares

1. **Fácil de aprender:** controles de apuntado y potencia intuitivos.
2. **Difícil de dominar:** viento, gravedad, distancia, armas y obstáculos crean decisiones.
3. **Identidad visual fuerte:** pixel art oscuro, siluetas memorables y escenarios atmosféricos.
4. **Competencia justa:** la cosmética no altera las estadísticas.
5. **Partidas claras:** turnos, temporizadores, daño y resultado verificables por el servidor.
6. **Ligereza:** escenas 2D pequeñas, spritesheets optimizados y efectos moderados.
7. **Producto coherente:** el pueblo, las arenas, las tiendas y el lore pertenecen al mismo mundo.

## 1.4 Público y plataforma

- Jugadores casuales que disfrutan duelos cortos.
- Personas aficionadas al pixel art y la fantasía medieval.
- PC y móvil mediante navegador.
- No se desarrolla aplicación nativa en el MVP.
- Orientación horizontal recomendada para el combate; el diseño móvil debe comunicar claramente cómo girar el dispositivo o adaptar el layout.

---

# 2. Lore y universo

## 2.1 La Caída de las Cenizas

Hace siglos, el mundo sufrió un acontecimiento llamado **La Caída de las Cenizas**. Una fuerza desconocida quebró el equilibrio entre el mundo de los vivos y las regiones que permanecían ocultas bajo la tierra.

Desde entonces, criaturas antiguas comenzaron a aparecer en bosques, pantanos, montañas y pueblos abandonados. Los reinos se fragmentaron. Las rutas comerciales dejaron de ser seguras. La magia se volvió impredecible y la alquimia pasó de ser una curiosidad a una necesidad.

Los asentamientos que sobrevivieron dependen de cazadores, mercenarios, herreros, curanderos y comerciantes.

En una encrucijada entre caminos antiguos se encuentra **Ashenfall**, un pequeño pueblo mercantil construido alrededor de una fortaleza derruida. Sus murallas protegen una plaza, una taberna, una forja y un mercado. La antigua Hermandad de las Cenizas mantiene una tregua entre viajeros y organiza duelos reglamentados para resolver disputas, entrenar combatientes y ofrecer espectáculo.

Los jugadores son mercenarios que llegan al pueblo para competir, ganar monedas y forjar una reputación visual mediante sus atuendos.

## 2.2 Texto breve de bienvenida

> “Cuando cayeron las cenizas, los caminos dejaron de pertenecer a los reyes. Ahora pertenecen a quienes se atreven a recorrerlos. En Ashenfall, toda promesa tiene un precio, toda victoria deja una marca y ningún mercenario permanece desconocido para siempre.”

## 2.3 Tono

- Fantasía medieval oscura.
- Misterio y folclore.
- Peligro sugerido, no gore explícito.
- Humor seco ocasional en NPCs.
- Objetos con historia.
- Ruinas, supersticiones, alquimia, contratos y monstruos.

## 2.4 Inspiración en The Witcher: límites creativos

La inspiración buscada es atmosférica y temática:
- mundo medieval áspero;
- aldeas y comerciantes;
- supersticiones y folclore;
- bosques hostiles, pantanos, ruinas y nieve;
- cazadores, brujas, alquimistas y monstruos;
- objetos que parecen tener historia;
- paleta sobria y melancólica.

**No copiar**:
- Geralt, Ciri, Yennefer, Jaskier ni otros personajes;
- nombres, símbolos, emblemas, mapas, diálogos o historias de The Witcher;
- diseños distintivos de monstruos o armaduras reconocibles;
- interfaz, logotipos, música, ilustraciones o assets protegidos;
- términos o lore propios de esa franquicia.

ASHENFALL debe poseer mitología, nombres, siluetas y lenguaje visual originales.

## 2.5 Especies y criaturas del universo

Estas especies pueden aparecer como personajes, retratos, comerciantes, siluetas, leyendas o futuras expansiones. No se necesita IA enemiga en el MVP.

- Humanos: habitantes de los asentamientos.
- Elfos de raíz: comunidades antiguas vinculadas a bosques.
- Enanos de veta: artesanos de fortalezas subterráneas.
- Brujas de hollín: alquimistas y estudiosas de presagios.
- Hechiceros errantes: personas capaces de manipular residuos de la Caída.
- Licántropos: humanos marcados por una maldición lunar.
- Duendes de grieta: pequeños saqueadores de ruinas.
- Golems de escoria: guardianes de piedra y metal.
- Arañas de campanario: criaturas que habitan torres y criptas.
- Espectros de ceniza: ecos de viajeros desaparecidos.

No todos deben aparecer en el primer lanzamiento. El universo puede insinuarlos mediante decoración, libros, carteles y diálogos.

---

# 3. Bucle principal de juego

1. El jugador abre ASHENFALL e inicia sesión.
2. Aparece en el pueblo estático.
3. Consulta su bolsa de monedas y su personaje.
4. Entra al Arsenal para elegir un personaje y una apariencia.
5. Visita la Forja o el Caldero para comprar cosméticos.
6. Entra a la Taberna para buscar partida o crear una sala privada.
7. El servidor empareja a dos jugadores.
8. El servidor elige un bioma y condiciones ambientales.
9. Se carga la arena.
10. Los jugadores se alternan para apuntar y disparar.
11. El servidor valida y resuelve cada disparo.
12. Al finalizar, el ganador recibe monedas.
13. Ambos jugadores regresan al pueblo y pueden volver a jugar.

El bucle debe funcionar sin que el jugador tenga que recargar la página.

---

# 4. Pueblo: Ashenfall

## 4.1 Diseño

El pueblo es una ilustración 2D estática, preferiblemente con ligera profundidad mediante capas/parallax opcional y animaciones ambientales discretas. No hay personaje caminando por el mapa.

Los edificios son hotspots clicables/tocables. Al seleccionar uno, se abre un panel o modal sin cambiar a un mundo interior separado.

El pueblo debe ser pequeño y reconocible: plaza de piedra, edificios de madera y piedra, faroles cálidos, muralla vieja, bosque al fondo, humo de chimeneas y carteles.

## 4.2 Edificios y funciones

### La Taberna — partidas
- Buscar partida rápida.
- Crear sala privada.
- Introducir código de invitación.
- Ver estado de búsqueda.
- Cancelar búsqueda.
- Ver lista de salas públicas si se implementa.

### La Forja — cosméticos de armas y armaduras
- Skins de arco, lanza, hacha y daga.
- Cascos, hombreras, guantes y armaduras visuales.
- Previsualización antes de comprar.
- Comprar con monedas.
- Equipar y desequipar.

### El Caldero — pociones y efectos cosméticos
- Skins de frascos.
- Color/partículas de efectos cosméticos.
- No vende ventajas de combate.
- Las pociones funcionales de combate, si se incluyen, son iguales para todos y no se compran con monedas.

### El Arsenal — personajes
- Elegir personaje.
- Ver retrato, sprite y descripción.
- Comprar skins de personajes.
- Equipar apariencia.

### La Hermandad — perfil e historial
- Victorias.
- Derrotas.
- Partidas jugadas.
- Porcentaje de victorias.
- Historial paginado.
- No añadir un sistema de ranking complejo al MVP.

## 4.3 HUD del pueblo

- Nombre del jugador.
- Bolsa de monedas.
- Personaje seleccionado.
- Acceso a perfil.
- Ajustes.
- Hotspots de edificios.
- Indicador de conexión.

## 4.4 Interacción

- Cada edificio debe tener estado hover/focus/pressed.
- En móvil debe responder al toque.
- Mostrar nombre y función al pasar el cursor o seleccionar.
- Mantener navegación por teclado accesible cuando sea viable.
- No usar áreas clicables diminutas.

---

# 5. Combate: duelo estático de proyectiles

## 5.1 Concepto fundamental

La referencia de interacción es Bowmasters: dos personajes enfrentados, cada uno permanece en una posición fija y se alternan para lanzar proyectiles.

**Los personajes nunca se desplazan.** No caminar, correr, saltar, esquivar, cambiar de carril, trepar, retroceder ni usar plataformas móviles. El impacto no cambia la posición lógica del personaje. Se permite una animación breve de reacción o sacudida sin alterar su coordenada.

La originalidad de ASHENFALL debe venir de su combinación de reglas propias: armas de fantasía con perfiles distintos, condiciones de bioma, viento, obstáculos estáticos, consumibles limitados y una economía cosmética integrada al pueblo. No copiar exactamente el conjunto de armas, personajes, reglas, UI o presentación de Bowmasters.

## 5.2 Vista de arena

- Cámara lateral 2D.
- Jugador A a la izquierda.
- Jugador B a la derecha.
- Personajes en posiciones fijas.
- Fondo del bioma.
- Obstáculos estáticos definidos por el mapa.
- HUD de vida.
- Indicador de turno.
- Temporizador.
- Viento.
- Arma actual.
- Guía de trayectoria.
- Control de potencia.
- Botón de disparo.

La arena ocupa el espacio visual principal. El HUD debe ser legible sin cubrir a los personajes.

## 5.3 Flujo de un turno

1. El servidor indica el jugador activo.
2. El cliente habilita controles de apuntado.
3. El jugador modifica ángulo y potencia.
4. Una guía curva muestra una trayectoria estimada.
5. El jugador confirma el disparo.
6. El cliente envía una intención al servidor.
7. El servidor valida turno, estado, límites, arma y secuencia.
8. El servidor simula el proyectil y determina colisiones.
9. El servidor actualiza vida, consumibles y estado.
10. El servidor emite un evento autoritativo con el resultado.
11. Ambos clientes reproducen la animación del proyectil y el impacto.
12. El servidor pasa el turno al otro jugador, salvo que la partida haya terminado.

## 5.4 Controles

### PC
- Mouse: dirección de apuntado.
- Control deslizante/teclas: potencia.
- Clic en “Disparar”: confirmar.
- Tecla Escape: abrir pausa/ajustes locales; no pausar el reloj del servidor.

### Móvil
- Arrastrar para ajustar ángulo/dirección.
- Slider para potencia.
- Botón grande para disparar.
- Diseño táctil sin hover como requisito.

## 5.5 Guía de trayectoria

La guía debe:
- Ser una línea punteada o puntos discretos.
- Mostrar aproximadamente la trayectoria del proyectil.
- Cambiar inmediatamente al variar ángulo, potencia o viento.
- Detenerse al detectar una colisión prevista si se desea.
- Ser visualmente legible sobre fondos oscuros.
- No revelar información que el jugador no debería conocer.
- Ser una predicción, no una promesa exacta del resultado.

El cliente puede calcular la guía para dar respuesta inmediata. El servidor calcula el resultado real. Ambos deben compartir constantes/versiones de física para minimizar diferencias visuales, pero el servidor es la autoridad.

## 5.6 Parámetros iniciales de partida

Valores iniciales de balance, configurables:
- Jugadores: exactamente 2 humanos.
- Vida inicial: 100 HP por jugador.
- Duración de turno: 30 segundos.
- Periodo de gracia por desconexión: 60 segundos, configurable.
- Máximo de rondas: 12 rondas completas.
- Ángulo permitido: rango configurable; sugerencia inicial 0°–90° en coordenadas relativas del jugador.
- Potencia: 10%–100%.
- Posiciones: fijas por arena.
- Daño: enteros, limitado y calculado por el servidor.

Definición de ronda: una ronda completa ocurre cuando ambos jugadores han tenido oportunidad de actuar. La partida puede terminar antes si un jugador llega a 0 HP.

## 5.7 Final de partida

La partida termina cuando:
- un jugador llega a 0 HP;
- se alcanza el límite de rondas y se compara vida restante;
- ambos tienen la misma vida al límite: empate;
- un jugador abandona o excede el periodo de reconexión y se aplica la regla de abandono.

Resultado inmutable: winnerId, loserId o empate, motivo, fecha, puntuación final, secuencia final de eventos.

## 5.8 Acción por defecto por timeout

Si se agota el turno:
- el servidor registra timeout;
- ejecuta una acción por defecto determinista y documentada, o aplica una penalización de turno;
- recomendación para el MVP: el turno se considera fallido y pasa al oponente, sin daño automático;
- después de dos timeouts consecutivos del mismo jugador, puede aplicarse abandono automático configurable.

No implementar acciones automáticas de disparo que sorprendan al jugador. La regla debe quedar documentada y ser igual para todos.

## 5.9 Física

Modelo simplificado de proyectil 2D:
- posición inicial derivada del punto de lanzamiento fijo;
- velocidad inicial derivada de potencia y arma;
- ángulo elegido;
- gravedad;
- viento horizontal;
- radio de colisión;
- obstáculos estáticos;
- hitbox del adversario.

La simulación se ejecuta en el servidor en pasos temporales fijos o mediante cálculo determinista equivalente. El resultado incluye:
- trayectoria/eventos necesarios para animar;
- colisión;
- objetivo impactado;
- daño;
- estado actualizado;
- duración lógica de vuelo.

No hace falta ejecutar un motor gráfico en el servidor. Solo matemáticas y reglas.

## 5.10 Daño

Fórmula de referencia configurable:

`damage = round(baseDamage * powerFactor * hitZoneMultiplier * biomeModifier)`

Donde:
- `baseDamage`: valor definido por el arma.
- `powerFactor`: función acotada de potencia.
- `hitZoneMultiplier`: opcional; si no se implementan zonas, usar 1.
- `biomeModifier`: normalmente 1; solo aplicar si el bioma define una regla clara y equilibrada.

Evitar multiplicadores excesivos. El servidor limita daño máximo por acción.

## 5.11 Armas iniciales

Las armas son una elección táctica, no una mejora comprada con monedas. Para evitar pay-to-win, todas las armas jugables se desbloquean por defecto en el MVP o se ofrecen bajo reglas de acceso equivalentes para todos.

| Arma | Identidad | Perfil físico | Balance inicial sugerido |
|---|---|---|---|
| Arco | Equilibrado | Arco parabólico medio | daño medio, control sencillo |
| Lanza arrojadiza | Penetrante | más velocidad, trayectoria menos curva | daño medio-alto, viento menos influyente |
| Hacha | Pesada | velocidad menor, arco pronunciado | daño alto, más difícil de apuntar |
| Daga | Ligera | rápida, trayectoria tensa | daño bajo-medio, ventana de precisión |

Los valores exactos se deben calibrar con pruebas de juego. No afirmar que una categoría es superior en todas las situaciones.

## 5.12 Obstáculos

Para mantener el alcance controlado:
- solo obstáculos estáticos;
- colisiones deterministas;
- no hay objetos destructibles en el MVP;
- no hay trampas que cambien durante el turno;
- cada mapa tiene una geometría fija y versionada.

## 5.13 Pociones / consumibles

Mantener el MVP simple. Recomendación: no incluir consumibles funcionales en el primer vertical slice. Si se implementan, deben ser idénticos para ambos jugadores y ocupar el turno.

Posibles diseños futuros:
- Sangre Vital: cura una cantidad limitada.
- Piel de Piedra: reduce un impacto.
- Furia Salvaje: modifica el siguiente ataque.

No vender poder con monedas. Las tiendas solo venden cosméticos. Los consumibles funcionales, si forman parte del juego, deben entregarse en igualdad de condiciones al inicio de la partida.

---

# 6. Personajes

## 6.1 Reglas de personajes

- Cada personaje tiene una silueta reconocible.
- El sprite permanece en posición fija durante combate.
- No tiene estadísticas únicas que generen pay-to-win.
- El personaje seleccionado no altera vida, hitbox, velocidad, daño o física.
- Las animaciones son visuales: idle, apuntar, disparar, recibir impacto, victoria y derrota.
- La apariencia equipada no puede cambiar las colisiones.
- La hitbox lógica debe ser la misma para todos, aunque el arte tenga proporciones diferentes.

## 6.2 Personajes iniciales

### EDRIK — El Errante
- Especie: humano.
- Rol visual: mercenario equilibrado.
- Silueta: capucha clara, armadura de cuero oscura, capa gastada.
- Paleta: gris hueso, cuero marrón, carbón.
- Arma representativa: arco.
- Personalidad: reservado, práctico, veterano.
- Frase: “No necesito suerte. Solo una oportunidad.”

### SYLWEN — La Última del Robledal
- Especie: elfa de raíz.
- Silueta: orejas sutilmente puntiagudas, cabello plateado, ropajes de bosque.
- Paleta: verde apagado, plata, cuero oscuro.
- Arma representativa: lanza o arco según loadout.
- Personalidad: observadora, paciente.
- Frase: “El viento siempre deja una pista.”

### BORGRIM — El Forjador
- Especie: enano de veta.
- Silueta: cuerpo compacto, barba trenzada, hombreras y cinturón de herramientas.
- Paleta: bronce, carbón, rojo óxido.
- Arma representativa: hacha.
- Personalidad: directo, orgulloso, artesano.
- Frase: “El acero no discute. Responde.”

Personajes futuros:
- VAELA — bruja de hollín.
- MORVETH — hechicero errante.
- RURIK — cazador de maldiciones.
No incluirlos como requisito del MVP.

---

# 7. Biomas y arenas

Los biomas se eligen en el servidor al iniciar la partida. Los dos jugadores reciben exactamente la misma configuración ambiental.

Cada bioma incluye:
- fondo pixel art;
- capas de profundidad;
- paleta propia;
- decoración;
- geometría de obstáculos;
- parámetros ambientales;
- sonido ambiental opcional;
- pequeños efectos visuales.

No generar mapas proceduralmente en el MVP. Crear 3 arenas diseñadas y probadas.

## 7.1 Bosque de los Susurros — bioma inicial recomendado

**Identidad:** bosque antiguo, húmedo y oscuro, con árboles torcidos, raíces, ruinas cubiertas de musgo y neblina baja.

Paleta:
- verde pino;
- verde musgo;
- gris azulado;
- marrón tierra;
- luz ámbar tenue.

Atmósfera:
- niebla en capas;
- pequeñas motas;
- ramas moviéndose muy ligeramente como decoración;
- siluetas de árboles al fondo.

Modificador de juego:
- viento horizontal suave y variable, pero fijo durante una partida;
- visibilidad visual reducida de fondo, sin ocultar injustamente el proyectil ni la guía.

## 7.2 Tierras del Invierno

**Identidad:** bosque de coníferas nevado, riscos, ruinas heladas y cielo gris frío.

Paleta:
- azul pizarra;
- gris hielo;
- blanco sucio;
- verde pino oscuro;
- luz azulada.

Atmósfera:
- nieve en partículas escasas;
- niebla fría;
- montañas al fondo.

Modificador:
- viento algo más intenso que en el bosque;
- partículas decorativas no deben afectar hitboxes;
- evitar penalizaciones de precisión invisibles.

## 7.3 Desierto de Ceniza

**Identidad:** valle árido de roca oscura, arena, restos de una antigua fortaleza y cielo polvoriento.

Paleta:
- ocre;
- arena pálida;
- marrón rojizo;
- carbón;
- naranja apagado.

Atmósfera:
- polvo en el horizonte;
- ruinas;
- huesos/vestigios decorativos no gráficos.

Modificador:
- viento lateral variable;
- obstáculos de roca estáticos y simétricamente justos.

## 7.4 Biomas futuros (fuera del MVP)

- Pantanos de Nhal: aguas oscuras, raíces, luces de insectos.
- Ruinas de Vardem: murallas quebradas, torres y estandartes.
- Costa de los Ahogados: acantilados, niebla marina y restos de barcos.

---

# 8. Economía y cosméticos

## 8.1 Principio

Economía muy sencilla. Una sola moneda: **Marcas de Ceniza** (también llamada monedas de la bolsa en la UI).

- Victoria: gana monedas.
- Derrota: 0 monedas en el diseño base.
- Empate: por definir; recomendación 0 monedas o recompensa simbólica muy pequeña. Para la regla más simple, 0.
- Las monedas se suman a la bolsa del usuario.
- Se guardan en PostgreSQL.
- Solo el servidor entrega y descuenta monedas.
- Las compras se ejecutan de forma transaccional.
- No hay dinero real ni moneda premium.

## 8.2 Recompensa propuesta

- Victoria: +100 monedas.
- Derrota: +0.
- Empate: +0.

Es un valor inicial de balance, configurable. No está fijado por el brief académico.

## 8.3 Catálogo cosmético inicial

| Elemento | Precio orientativo |
|---|---:|
| Skin de arma | 150 |
| Capa | 200 |
| Casco | 250 |
| Skin de personaje | 350 |
| Efecto visual de proyectil | 200 |
| Marco de retrato | 100 |
| Emblema | 100 |

Precios orientativos, no requisitos. Mantener una progresión razonable: unas pocas victorias deben permitir comprar un artículo pequeño.

## 8.4 No pay-to-win

Las monedas no pueden:
- subir daño;
- aumentar vida;
- cambiar la precisión;
- mejorar la física;
- ampliar el tiempo;
- desbloquear una ventaja de colisión;
- comprar consumibles superiores.

## 8.5 Bolsa

HUD persistente: icono de bolsa/monedas y total actual.
Al ganar:
- mostrar animación breve de monedas entrando en la bolsa;
- actualizar saldo tras confirmación del servidor;
- no actualizar optimistamente como definitivo hasta recibir confirmación.

---

# 9. Pantallas y UX

## 9.1 Pantallas MVP

1. Splash / carga.
2. Registro e inicio de sesión.
3. Pueblo de Ashenfall.
4. Perfil.
5. Arsenal / selección de personaje.
6. Forja / tienda cosmética.
7. Caldero / tienda cosmética.
8. Taberna / matchmaking.
9. Crear sala privada.
10. Unirse mediante código.
11. Sala de espera.
12. Arena.
13. Resultado de partida.
14. Historial.
15. Ajustes.

## 9.2 Flujo

Login → Pueblo → Taberna → matchmaking/sala → arena → resultado → pueblo.

Las tiendas son paneles superpuestos o pantallas ligeras, no niveles jugables independientes.

## 9.3 Arena HUD

- vida propia;
- vida rival;
- nombres y retratos;
- turno activo;
- temporizador;
- indicador de viento (dirección y fuerza);
- bioma;
- arma seleccionada;
- ángulo;
- potencia;
- guía de trayectoria;
- botón disparar;
- mensajes de impacto y daño.

## 9.4 Estados de UX

Definir:
- cargando;
- conectando;
- buscando rival;
- sala llena;
- rival desconectado;
- reconectando;
- turno propio;
- turno rival;
- disparo en curso;
- resolviendo;
- victoria;
- derrota;
- empate;
- error recuperable;
- error fatal.

---

# 10. Dirección artística

## 10.1 Estilo visual

Pixel art 2D de fantasía medieval oscura. Debe sentirse artesanal y legible, con personajes pequeños pero expresivos y escenarios de varias capas.

Evitar:
- pixel art excesivamente ruidoso;
- demasiados detalles que reduzcan legibilidad;
- colores neón dominantes;
- UI futurista;
- sprites con tamaños/proporciones inconsistentes;
- mezclar pixel art con ilustraciones vectoriales suaves en el mismo plano.

## 10.2 Paleta sugerida

- Carbón: `#17191B`
- Gris pizarra: `#343A3D`
- Verde bosque: `#263B32`
- Verde musgo: `#52614A`
- Marrón cuero: `#654B38`
- Bronce envejecido: `#9B7445`
- Pergamino: `#D3C4A2`
- Hueso: `#E5DDC8`
- Rojo óxido: `#87443D`
- Azul hielo: `#879EAA`

Usar ámbar cálido como acento de luz en el pueblo y azules/verdes fríos en arenas.

## 10.3 Pixel grid y consistencia

Recomendación inicial:
- sprites de personajes entre 48×64 y 64×80 píxeles de arte base;
- iconos entre 16×16 y 32×32;
- objetos entre 24×24 y 48×48;
- escenarios diseñados a una resolución interna proporcional, escalados por múltiplos enteros cuando sea posible;
- cámara y escalado con pixel rounding para evitar blur.

Estos tamaños son recomendaciones técnicas; ajustar según pruebas visuales. Mantener una escala consistente entre personajes, proyectiles, objetos y escenario.

## 10.4 Animaciones mínimas

Personajes:
- idle: 2–4 frames, movimiento sutil;
- aim: pose estática o 2 frames;
- shoot: 3–5 frames;
- hit: 2–3 frames de reacción, sin desplazamiento lógico;
- victory: 3–5 frames;
- defeat: 3–5 frames.

Proyectiles:
- vuelo;
- impacto;
- desaparición.

Efectos:
- destello pequeño;
- polvo;
- chispas;
- partículas de ambiente.

---

# 11. Asset Bible — lista de assets a producir

**Importante:** la imagen `references/ashenfall_visual_reference_board.png` incluida con este documento es un moodboard conceptual generado para orientar el estilo. No es un spritesheet listo para producción, no debe cortarse automáticamente para usar sus miniaturas como sprites y puede contener detalles imperfectos o texto decorativo. Claude debe usarla como referencia de tono, composición y paleta, y producir assets separados y consistentes.

## 11.1 Entregables gráficos

### A. Pueblo
- `village_ashenfall_background.png`: vista general lateral/ligeramente isométrica o top-down estilizada (elegir una perspectiva y mantenerla).
- `village_lantern_glow.png`
- `village_chimney_smoke.png`
- `village_fog_overlay.png`
- `building_tavern.png`
- `building_blacksmith.png`
- `building_alchemist.png`
- `building_guild.png`
- `building_armory.png`
- hotspots transparentes o definidos en código.

Recomendación: fondo de pueblo en 16:9 y edificios integrados. Los hotspots se definen por coordenadas, no hace falta renderizar botones encima de cada edificio.

### B. Arenas
Para cada bioma:
- `arena_whispering_forest_background.png`
- `arena_whispering_forest_midground.png`
- `arena_whispering_forest_foreground.png`
- `arena_whispering_forest_collision_map.json` o geometría en código.
- equivalente para `frostlands` y `ashen_desert`.

El fondo debe ser panorámico, con espacio negativo para que los dos personajes y la trayectoria se lean claramente. Evitar árboles/ruinas que se confundan con los proyectiles.

### C. Personajes
Por cada personaje:
- retrato;
- sprite base transparente;
- spritesheet idle;
- aim;
- shoot;
- hit;
- victory;
- defeat.

Nombres:
- `character_edrik_portrait.png`
- `character_edrik_spritesheet.png`
- `character_sylwen_portrait.png`
- `character_sylwen_spritesheet.png`
- `character_borgrim_portrait.png`
- `character_borgrim_spritesheet.png`

Los personajes deben mirar hacia el rival. Se puede espejar el mismo sprite si la silueta y arma se mantienen correctamente; revisar que no se inviertan detalles asimétricos importantes.

### D. Armas
Sprites transparentes:
- `weapon_bow.png`
- `weapon_spear.png`
- `weapon_axe.png`
- `weapon_dagger.png`

Skins cosméticas futuras:
- `weapon_skin_ashen_bone.png`
- `weapon_skin_old_bronze.png`
- `weapon_skin_frost_etched.png`

### E. Proyectiles
- `projectile_arrow.png`
- `projectile_spear.png`
- `projectile_axe.png`
- `projectile_dagger.png`

Efectos:
- `vfx_projectile_trail.png`
- `vfx_impact_wood.png`
- `vfx_impact_armor.png`
- `vfx_impact_ground.png`
- `vfx_muzzle_flash.png`

### F. Consumibles / tienda
Si se implementan:
- `item_potion_vital_blood.png`
- `item_potion_stone_skin.png`
- `item_potion_wild_fury.png`

La versión inicial puede limitarse a iconos de tienda cosmética y no activar pociones funcionales.

### G. UI e iconos
Crear iconos individuales con fondo transparente:
- `icon_coin.png`
- `icon_purse.png`
- `icon_tavern.png`
- `icon_blacksmith.png`
- `icon_alchemist.png`
- `icon_guild.png`
- `icon_armory.png`
- `icon_profile.png`
- `icon_settings.png`
- `icon_health.png`
- `icon_wind.png`
- `icon_turn.png`
- `icon_timer.png`
- `icon_victory.png`
- `icon_defeat.png`
- `icon_draw.png`
- `icon_lock.png`
- `icon_equipped.png`
- `icon_buy.png`
- `icon_back.png`

### H. UI panels
- panel de pergamino oscuro;
- botones normal/hover/pressed/disabled;
- barra de vida;
- slider de potencia;
- indicador de viento;
- modal de confirmación;
- tarjeta de artículo;
- tooltip;
- panel de resultados.

Mantener bordes pixelados, ornamentos discretos y contraste alto.

## 11.2 Prompts base de arte

Usar el siguiente bloque al generar assets:

> Original 2D pixel art for ASHENFALL, a dark medieval fantasy indie game. Cohesive limited palette of charcoal, muted forest green, aged brown leather, weathered bronze, parchment bone and subtle warm amber. Crisp pixel clusters, deliberate pixel grid, readable silhouette, no anti-aliased vector edges, no 3D render, no photorealism, no UI text, no watermark. Match the scale and proportions of the established ASHENFALL art bible. Transparent background for sprites and icons. Original design, not resembling any copyrighted game character or franchise asset.

### Prompt — pueblo

> Create a wide 16:9 2D pixel-art environment background for the fictional medieval settlement of Ashenfall. A compact fortified merchant village at dusk, central stone plaza, timber-and-stone tavern, blacksmith forge with warm orange light, alchemist shop with subtle green glass glow, guild hall, armory, old palisade, distant dark forest and ruined watchtower. Cozy but melancholy, lanterns, chimney smoke, restrained amber windows, muted dark greens and browns. Side-facing game hub composition with clearly distinguishable clickable buildings and enough negative space for UI. No characters in foreground, no text, no logos.

### Prompt — Bosque de los Susurros

> Wide 16:9 side-view 2D pixel-art combat arena background: ancient haunted forest, twisted tree trunks, mossy stones, low fog bands, distant silhouettes, muted pine greens and blue-gray shadows. Keep the central combat lane uncluttered and readable for two stationary character sprites and a projectile arc. Add only a few static rock/root obstacles near the ground. Dark fantasy atmosphere, no text, no characters.

### Prompt — Tierras del Invierno

> Wide 16:9 side-view 2D pixel-art combat arena: frozen conifer forest, snow-covered rock ledges, distant pale mountains, cold blue-gray sky, restrained drifting snow particles. Leave the projectile path and both stationary player positions visually clear. Static obstacles only, no characters, no text, consistent pixel scale with ASHENFALL.

### Prompt — Desierto de Ceniza

> Wide 16:9 side-view 2D pixel-art combat arena: ash desert canyon, weathered sandstone, dark volcanic rock, remains of an ancient fortress, dusty amber sky and distant heat haze. Keep central combat lane clear, use a few static rock obstacles, maintain readable contrast for projectiles and character silhouettes. No characters, no text.

### Prompt — Edrik

> Full-body 2D pixel-art character sprite, transparent background, original human mercenary named Edrik. Pale worn hood, layered dark leather armor, weathered short cloak, practical boots, simple bow and quiver, compact readable silhouette, neutral idle pose facing right. Dark medieval fantasy, restrained charcoal, bone-white and brown palette. Sprite proportions suitable for a 2D side-view duel. No background, no text, no shadow beyond a small ground contact shadow.

### Prompt — Sylwen

> Full-body 2D pixel-art character sprite, transparent background, original elven ranger named Sylwen. Subtle pointed ears, silver hair, muted forest-green clothing, leather bracers, practical travel gear, elegant but grounded silhouette, holding a throwing spear or bow, neutral idle pose facing right. No ornate high-fantasy excess. Consistent scale with Edrik and Borgrim. No background, no text.

### Prompt — Borgrim

> Full-body 2D pixel-art character sprite, transparent background, original dwarf mercenary named Borgrim. Compact sturdy build, braided beard, worn bronze and dark iron armor, leather belt, heavy gloves, small battle axe, neutral idle pose facing right. Warm rust and bronze accents, readable silhouette. Same sprite scale as Edrik and Sylwen. No background, no text.

### Prompt — armas

> A clean 2x2 asset sheet of four separate original pixel-art throwable medieval weapons for ASHENFALL: simple bow, throwing spear, compact battle axe, balanced dagger. Each object isolated with generous transparent spacing, consistent pixel scale, side view, dark fantasy craftsmanship, no labels, no background, no text. Ensure each object can be cropped into a separate transparent sprite.

### Prompt — pociones

> Four separate small pixel-art alchemy bottles for an original dark medieval fantasy game: red vital blood, muted green antidote, blue-gray stone skin, purple wild fury. Each bottle distinct in silhouette, glass highlights, tiny cork and subtle liquid glow. Transparent background, 32x32-style pixel icon, no text, no border.

### Prompt — iconos UI

> A consistent icon pack for ASHENFALL, original dark medieval pixel-art UI icons: coin, purse, tavern, blacksmith hammer, alchemy flask, guild crest, armory helmet, profile bust, settings cog, heart, wind swirl, hourglass, victory laurel, defeat broken shield, lock, buy coin. Each icon isolated, transparent background, consistent 24x24 or 32x32 pixel grid, restrained bronze and parchment highlights, no text.

### Prompt — paneles UI

> Pixel-art user-interface kit for ASHENFALL: dark charcoal panels, aged wood and weathered bronze frames, parchment accents, simple square-corner fantasy ornament, readable button states normal/hover/pressed/disabled, health bar, power slider, item card, modal frame. No text, no logos, consistent pixel grid and palette.

## 11.3 Reglas para producir spritesheets

- No generar todos los personajes en un único spritesheet final.
- Generar cada personaje por separado para controlar consistencia.
- Cada frame debe tener exactamente el mismo tamaño.
- Mantener pivote y punto de apoyo del pie consistentes.
- Mantener hitbox lógica independiente del contorno visual.
- Fondo transparente real.
- No incluir texto, nombres ni marcas en el arte.
- Evitar que la IA invente frames con cambios de armadura o rostro.
- Validar a escala 1x antes de ampliar.
- Exportar PNG optimizado.

---

# 12. Arquitectura técnica del videojuego

## 12.1 Prioridad

El proyecto académico evalúa principalmente el servidor, no la calidad artística ni la diversión del juego. El cliente debe ser suficientemente funcional para demostrar partidas reales, pero el esfuerzo debe concentrarse en el servidor, la concurrencia, la seguridad, la durabilidad, el rendimiento, Azure y la documentación.

## 12.2 Stack propuesto

- Cliente: TypeScript + Phaser 3 + Vite.
- Servidor: Node.js 20+ + TypeScript con `strict: true`, sin `any`.
- API: REST.
- Tiempo real: WebSocket seguro (WSS).
- Persistencia: PostgreSQL.
- Estado caliente y coordinación entre réplicas: Redis.
- Contenedores: Docker.
- Hosting backend: Azure Container Apps.
- Registro: Azure Container Registry.
- Secretos: Azure Key Vault.
- Observabilidad: OpenTelemetry + Application Insights.
- CI/CD: GitHub Actions o Azure DevOps.
- IaC: Bicep o Terraform.
- Contratos: OpenAPI 3.1 y AsyncAPI 3.0.

Las versiones concretas deben confirmarse al crear el repositorio y quedar fijadas en lockfiles.

## 12.3 Separación de responsabilidades

### Cliente
- Renderizar escenas.
- Dibujar sprites, fondos y UI.
- Capturar controles.
- Mostrar guía predictiva.
- Reproducir animaciones a partir de eventos.
- Enviar intenciones al servidor.
- Mostrar estado confirmado.

### Servidor
- Autenticación/autorización.
- Salas y matchmaking.
- Estado de partida.
- Turnos y temporizadores.
- Validación de acciones.
- Física autoritativa.
- Daño y vida.
- Determinar ganador/empate.
- Entregar monedas.
- Compras e inventario.
- Historial.
- Administración.
- Reconexión y recuperación.

### Dominio puro
El motor de reglas debe vivir en un módulo sin dependencias de HTTP, WebSocket, PostgreSQL, Redis o framework. Debe recibir estado + intención y producir un nuevo estado + eventos.

## 12.4 Módulos de dominio

- Authentication
- Users
- Rooms
- Matchmaking
- GameSessions
- TurnManagement
- Combat
- ProjectilePhysics
- Biomes
- Characters
- Cosmetics
- Wallet
- Shop
- MatchHistory
- Administration
- Audit

## 12.5 Estado de partida

Campos conceptuales:
- matchId
- status
- playerIds
- currentTurnPlayerId
- roundNumber
- stateVersion
- eventSequence
- player health
- selected character cosmetic
- selected weapon
- fixed player positions
- biomeId
- biome configuration
- wind vector
- obstacles/map version
- turn deadline
- reconnect/grace state
- result

Estados:
- WAITING
- READY
- IN_PROGRESS
- RESOLVING
- FINISHED
- ABANDONED
- EXPIRED

## 12.6 Autoridad del servidor

El cliente envía intención, nunca resultados. Ejemplo de intención:
- matchId
- actionId (UUID)
- expectedStateVersion
- weaponId
- angle
- power
- optional clientTimestamp (solo diagnóstico, nunca autoridad)

El cliente **no** envía:
- daño;
- vida nueva;
- colisión;
- posición final;
- ganador;
- monedas;
- resultado de compra.

El servidor valida:
- autenticación;
- pertenencia a partida;
- turno;
- estado;
- secuencia/versión;
- arma permitida;
- rango de ángulo;
- rango de potencia;
- rate limit;
- actionId no duplicado.

## 12.7 Orden e idempotencia

- Cada partida procesa una acción a la vez.
- Cada evento confirmado tiene sequence creciente.
- Acciones sobre versiones antiguas se rechazan.
- Cada acción lleva UUID.
- Reintentar la misma acción devuelve el resultado previamente confirmado.
- No aplicar una acción dos veces.
- Las compras también deben ser idempotentes/transaccionales.

## 12.8 REST

REST para:
- registro/login/refresh/logout;
- perfil;
- inventario;
- catálogo;
- compra/equipamiento;
- crear/listar/unirse/salir de salas;
- historial;
- administración;
- health endpoints.

Documentar con OpenAPI 3.1 en `/docs`.
Errores según RFC 9457 Problem Details.

## 12.9 WebSocket

WSS para:
- presencia;
- sala actualizada;
- jugador listo;
- partida iniciada;
- estado inicial;
- turno actualizado;
- ataque aceptado/rechazado;
- proyectil resuelto;
- daño aplicado;
- partida finalizada;
- desconexión/reconexión;
- heartbeat.

Documentar con AsyncAPI 3.0:
- esquema de cada mensaje;
- ejemplos;
- errores;
- autenticación;
- códigos de cierre;
- versión de protocolo.

No usar polling para conocer cambios de turno.

## 12.10 Reconexión y durabilidad

- Heartbeat ping/pong.
- Detectar caída.
- Periodo de gracia configurable.
- El jugador vuelve a autenticarse.
- El servidor verifica que pertenece a la partida.
- El servidor envía snapshot autorizado y sequence actual.
- El jugador continúa desde estado confirmado.
- Partidas sobreviven reinicios de una réplica.
- Persistir jugadas confirmadas antes de confirmar al cliente.
- Registro de eventos o estrategia equivalente que permita reconstruir el estado.
- Limpieza de partidas expiradas.

## 12.11 Persistencia conceptual

Tablas/entidades sugeridas:
- users
- user_sessions / refresh_tokens
- player_profiles
- wallets
- cosmetic_catalog
- player_cosmetics
- equipped_cosmetics
- rooms
- room_members
- matches
- match_players
- match_events
- match_results
- purchase_transactions
- admin_audit_logs
- suspended_users

No almacenar estado efímero innecesario en PostgreSQL en cada frame. Persistir acciones y cambios significativos, no animaciones.

## 12.12 Economía transaccional

Al finalizar una victoria:
1. verificar que match aún no haya otorgado recompensa;
2. registrar resultado;
3. crear transacción de wallet con referencia única a matchId;
4. incrementar saldo en la misma transacción;
5. emitir evento de recompensa;
6. garantizar que reintentos no dupliquen monedas.

Compra:
1. validar catálogo y precio en servidor;
2. comprobar saldo;
3. comprobar que el cosmético no está ya adquirido;
4. descontar monedas y otorgar propiedad en una transacción;
5. devolver saldo y artículo confirmados.

---

# 13. Seguridad

Requisitos:
- JWT firmado o proveedor OIDC.
- Tokens de acceso de corta duración.
- Refresh token rotativo.
- Contraseñas Argon2id o bcrypt si el servidor las gestiona.
- WebSocket autenticado durante handshake, preferiblemente mediante ticket de un solo uso y corta duración.
- Autorización por endpoint y por mensaje.
- Solo participantes pueden actuar en una partida.
- Solo el jugador activo puede disparar.
- Solo administradores acceden a funciones administrativas.
- Validación de todos los mensajes.
- Límites de tasa por usuario y conexión.
- HTTP 429 con Retry-After.
- Tamaño máximo de mensajes.
- Máximo de conexiones por usuario.
- HTTPS y WSS exclusivamente.
- CORS y orígenes WebSocket restringidos.
- Encabezados de seguridad.
- Secretos en Key Vault con identidad administrada.
- Ningún secreto en repositorio ni configuración plana.
- Escaneo de dependencias, código y secretos en CI (Dependabot, CodeQL, gitleaks o equivalentes).
- Contenedor como usuario no root.
- Sin vulnerabilidades críticas conocidas.

El cliente no debe recibir datos privados de otro jugador. Los logs tampoco deben filtrar secretos o datos sensibles.

---

# 14. Azure, despliegue y observabilidad

Topología de referencia:
- jugadores → HTTPS/WSS → Azure Container Apps (múltiples réplicas);
- Redis para estado caliente y difusión entre réplicas;
- PostgreSQL para persistencia;
- Key Vault para secretos;
- Managed Identity para acceso entre servicios;
- OpenTelemetry → Application Insights.

Obligatorio:
- IaC en Bicep o Terraform;
- un ambiente nuevo levantable con una ejecución del pipeline;
- CI/CD: build, lint, pruebas, validación de contratos, escaneo, build/push imagen;
- despliegue automático a dev;
- aprobación manual a prod;
- despliegues sin cortar partidas: traffic splitting/revisions y drenado de conexiones;
- rollback documentado menor a 5 minutos;
- identidad administrada para acceso entre servicios;
- `/health/live` y `/health/ready`;
- logs estructurados correlacionados por matchId y playerId;
- no incluir datos sensibles en logs;
- métricas: partidas activas, conexiones, jugadas por segundo, latencia por jugada;
- al menos dos alertas;
- estimación de costo mensual dentro de Azure for Students;
- apagar o escalar a cero recursos de dev cuando no se usen.

No afirmar que el sistema está desplegado o cumple metas hasta ejecutar y documentar pruebas reales.

---

# 15. Rendimiento y pruebas

Metas del brief académico:
- p95 menor a 200 ms desde que llega una jugada hasta que todos los jugadores de la partida reciben el nuevo estado;
- ninguna jugada perdida ni duplicada;
- tasa de error menor al 1%;
- reporte de CPU y memoria por partida activa;
- punto de quiebre: cantidad de partidas por réplica antes de degradación;
- mensajes compactos: enviar solo cambios/estado mínimo;
- al menos una optimización con cifras antes/después.

Pruebas requeridas:
- unitarias del dominio;
- unitarias de física y límites;
- integración API;
- integración WebSocket;
- concurrencia;
- idempotencia;
- secuencia y mensajes fuera de orden;
- reconexión;
- reinicio de instancia;
- autorización;
- rate limits;
- validación de payloads;
- compras concurrentes;
- recompensa duplicada;
- pruebas de carga reproducibles;
- prueba del punto de quiebre;
- resiliencia y rollback.

Crear un bot/cliente de prueba para simular jugadores y partidas simultáneas.

---

# 16. Requisitos académicos de Proyecto3.pdf

**Fuente:** documento del curso “Proyecto: Servidor nivel producción en Azure para un juego por turnos”, fechado 22 de octubre de 2026, con entrega indicada para el 12 de noviembre de 2026. Esta sección distingue lo que el profesor pide de las decisiones de diseño de ASHENFALL.

## 16.1 Qué evalúa el proyecto

El juego es el pretexto, no el producto. El profesor evalúa el servidor: arquitectura, seguridad, eficiencia, estándares y consistencia. El diseño, arte y diversión no se califican directamente; el juego sí debe cumplir las restricciones mínimas.

## 16.2 Restricciones del juego

- Por turnos.
- Mínimo dos jugadores humanos por partida.
- Debe ser original: se permite inspirarse en mecánicas existentes, pero no recrear un juego 1:1. Cambiar nombres o gráficos no basta; las reglas deben ser propias.
- Reglas verificables: el servidor debe decidir sin ambigüedad si una jugada es válida y cuándo termina la partida.
- Información oculta es recomendada, no obligatoria.

**Aplicación a ASHENFALL:** el duelo estático de proyectiles por turnos cumple el esquema multijugador y turnos. Para reforzar originalidad, definir y documentar el conjunto propio de armas, biomas, viento, obstáculos, límites de ronda, turnos, reglas de empate, timeout y economía. No copiar exactamente Bowmasters.

## 16.3 Requisitos funcionales del servidor

### Usuarios
- registro;
- inicio/cierre de sesión;
- renovación del token;
- perfil;
- access tokens cortos y refresh token rotativo o proveedor OIDC.

### Salas
- crear partidas públicas/privadas;
- código de invitación;
- listar, unirse, salir;
- marcar listo;
- iniciar solo con 2 o más jugadores listos;
- respetar capacidad máxima incluso con uniones concurrentes.

Para ASHENFALL: capacidad máxima 2.

### Matchmaking
- cola rápida;
- agrupar jugadores en partidas nuevas;
- un jugador nunca asignado a dos partidas;
- tiempo máximo de espera configurable.

### Turnos
- enviar jugada;
- recibir estado nuevo;
- saber a quién le toca;
- solo juega quien tiene turno;
- jugada inválida rechazada con error tipado;
- temporizador por turno con acción por defecto.

### Conexión
- heartbeat;
- detectar caídas;
- reconectar;
- recuperar estado actual;
- periodo de gracia configurable;
- al vencer, aplicar regla de abandono.

### Fin de partida
- declarar ganador/empate;
- resultado inmutable;
- registrar resultado;
- partida reproducible jugada por jugada.

### Historial
- partidas por usuario;
- resultados;
- paginado;
- cada usuario solo ve detalle de sus partidas.

### Administración
- ver partidas activas y conexiones;
- terminar partida;
- suspender usuario;
- solo rol administrador;
- auditar cada acción.

## 16.4 Reglas de servidor obligatorias

- servidor autoritativo;
- cliente envía intenciones, nunca resultados;
- orden por partida;
- eventos con número de secuencia;
- rechazar jugada basada en versión vieja;
- idempotencia por ID de acción;
- vista por jugador, sin filtrar información oculta;
- durabilidad ante reinicios y despliegues;
- aislamiento entre partidas;
- limpieza automática de partidas abandonadas/inactivas;
- reloj y azar resueltos en servidor;
- azar con generador criptográficamente seguro cuando afecte resultado.

## 16.5 Stack y contratos obligatorios

- lenguaje estático con modo estricto;
- TypeScript sobre Node 20+ está permitido, con `strict: true`, sin `any`;
- dominio puro sin red/base de datos/framework;
- WebSocket seguro WSS;
- no polling para cambios de turno;
- AsyncAPI 3.0 para tiempo real;
- REST OpenAPI 3.1 en `/docs`;
- errores RFC 9457 Problem Details;
- validación de cada mensaje;
- heartbeat ping/pong y cierre ordenado con códigos documentados.

## 16.6 Seguridad obligatoria

- JWT firmado / OIDC o servidor con Argon2id/bcrypt;
- autenticación WebSocket en handshake;
- autorización por endpoint y mensaje;
- límites de tasa;
- HTTP 429 + Retry-After;
- límite de tamaño de mensajes;
- límite de conexiones por usuario;
- HTTPS/WSS;
- CORS/orígenes restringidos;
- encabezados de seguridad;
- Key Vault y Managed Identity;
- ningún secreto en repositorio;
- escaneo dependencias/código/secretos;
- contenedor no root;
- sin vulnerabilidades críticas conocidas.

## 16.7 Rendimiento obligatorio

- p95 menor a 200 ms por jugada hasta que todos los jugadores reciban el estado;
- cero jugadas perdidas o duplicadas;
- error menor a 1%;
- CPU/memoria por partida;
- punto de quiebre por réplica;
- mensajes compactos;
- optimización medida antes/después.

## 16.8 Azure obligatorio

- Container Apps como topología de referencia;
- Redis;
- PostgreSQL;
- Key Vault;
- IaC Bicep/Terraform;
- CI/CD;
- dev automático y prod con aprobación;
- despliegue sin cortar partidas;
- rollback menor a 5 minutos;
- Managed Identity;
- OpenTelemetry/Application Insights;
- logs correlacionados;
- métricas propias;
- health probes;
- mínimo dos alertas;
- estimación mensual dentro de Azure for Students;
- apagar/escalar a cero dev cuando no se usa.

El profesor permite justificar sustituciones de componentes, pero no eliminar capacidades requeridas.

## 16.9 Entregables académicos

Repositorio GitHub con acceso de lectura para el profesor. Debe contener:
- código servidor;
- IaC;
- pipelines;
- contratos AsyncAPI y OpenAPI;
- pruebas;
- scripts de carga;
- bot;
- cliente de prueba.

README:
- ejecución local en menos de 10 minutos (por ejemplo docker compose up);
- ejecutar pruebas;
- URL pública Azure disponible durante revisión.

La versión evaluada es el tag `v1.0.0`.

## 16.10 Rúbrica

| Criterio | Peso |
|---|---:|
| Arquitectura y calidad | 20% |
| Sesiones y concurrencia | 20% |
| Seguridad | 20% |
| Rendimiento y optimización | 15% |
| Azure, IaC y CI/CD | 10% |
| Estándares, contratos y pruebas | 10% |
| Documentación y observabilidad | 5% |

Advertencias explícitas del brief:
- El juego, gráficos, diversión y cliente no tienen nota directa; solo se verifica que el juego cumpla restricciones.
- No se acepta recreación 1:1 de otro juego.
- Cualquier secreto incluido en el repositorio limita el criterio de seguridad al 50%.
- Entregas tardías pierden 10% por día.

---

# 17. MVP y fuera de alcance

## 17.1 MVP obligatorio/recomendado

### Juego
- pueblo estático clicable;
- tres personajes;
- cuatro armas;
- tres biomas;
- combate 1v1;
- personajes inmóviles;
- apuntado con guía de trayectoria;
- control de potencia;
- física autoritativa;
- vida/daño;
- turnos y temporizador;
- viento;
- obstáculos estáticos;
- ganador/empate;
- monedas solo por victoria;
- bolsa persistente;
- tienda cosmética sencilla;
- inventario/equipamiento cosmético.

### Backend académico
- usuarios y tokens;
- salas;
- matchmaking;
- WebSocket;
- REST;
- idempotencia;
- orden de eventos;
- reconexión;
- persistencia;
- historial;
- administración;
- seguridad;
- carga;
- observabilidad;
- Azure;
- IaC;
- CI/CD;
- contratos;
- pruebas.

## 17.2 Fuera de alcance explícito

- mundo abierto;
- caminar por el pueblo;
- movimiento de personajes en combate;
- esquivar/saltar/plataformas;
- retroceso que desplace personajes;
- PvE;
- monstruos con IA;
- campaña narrativa;
- misiones;
- crafting;
- clanes;
- chat de voz;
- comercio entre jugadores;
- multijugador de 4+;
- economía premium;
- compra de estadísticas;
- armas de pago con ventaja;
- destructibilidad compleja;
- mapas proceduralmente generados;
- 3D;
- aplicación nativa.

---

# 18. Criterios de aceptación del juego

1. Usuario puede registrarse e iniciar sesión.
2. Usuario llega al pueblo estático.
3. Los edificios abren sus paneles correctos.
4. Puede elegir uno de los tres personajes.
5. Puede consultar y comprar cosméticos.
6. El saldo se conserva tras cerrar sesión.
7. Dos usuarios pueden crear/unirse a una sala y marcarse listos.
8. El servidor inicia partida con ambos jugadores.
9. El servidor selecciona un bioma y viento.
10. Ambos personajes permanecen inmóviles.
11. El jugador activo ajusta ángulo y potencia.
12. La guía de trayectoria cambia al ajustar.
13. El jugador dispara.
14. El servidor valida el ataque y calcula la física.
15. Ambos clientes reciben el mismo resultado confirmado.
16. Vida y daño solo cambian por el servidor.
17. No se acepta un disparo fuera de turno.
18. Acción duplicada no se ejecuta dos veces.
19. Timeout se resuelve conforme a regla documentada.
20. Desconexión permite reconexión dentro del periodo de gracia.
21. El fin de partida declara ganador/empate.
22. El ganador recibe monedas una sola vez.
23. Derrota no entrega monedas en la economía base.
24. El jugador puede gastar monedas en cosméticos.
25. Compras concurrentes no generan saldo negativo ni duplicación.
26. El historial registra el resultado.
27. Una partida no afecta a otra.
28. Un reinicio de réplica no pierde jugadas confirmadas.

---

# 19. Plan de implementación para Claude Opus

**Regla:** no intentar generar el juego completo en un único paso. Trabajar por fases pequeñas, con pruebas y revisión al finalizar cada fase.

## Fase 0 — Inspección y plan
- revisar repositorio y brief académico;
- proponer estructura;
- listar decisiones abiertas;
- identificar riesgos;
- no sobrescribir archivos existentes sin inspeccionarlos.

## Fase 1 — Dominio puro
- tipos;
- estado de partida;
- transiciones;
- reglas de turnos;
- validación de jugadas;
- simulación de proyectiles;
- daño;
- victoria/empate;
- pruebas unitarias exhaustivas.

## Fase 2 — API y usuarios
- auth;
- perfiles;
- salas;
- matchmaking;
- catálogo cosmético;
- wallet;
- compras;
- historial.

## Fase 3 — Tiempo real
- WebSocket;
- handshake auth;
- eventos;
- secuencia;
- idempotencia;
- heartbeat;
- reconexión;
- pruebas de integración.

## Fase 4 — Persistencia y multi-réplica
- PostgreSQL;
- Redis;
- event log;
- recuperación;
- transacciones;
- pruebas de reinicio.

## Fase 5 — Cliente mínimo
- Phaser/Vite;
- login;
- pueblo;
- taberna;
- sala;
- arena;
- guía;
- disparo;
- resultado.

## Fase 6 — Arte y tiendas
- importar assets;
- personajes;
- biomas;
- UI;
- cosméticos;
- bolsa y compras.

## Fase 7 — Azure y CI/CD
- Docker;
- IaC;
- Key Vault;
- Managed Identity;
- Container Apps;
- Redis/PostgreSQL;
- pipelines;
- observabilidad;
- alertas;
- rollback.

## Fase 8 — Validación final
- tests;
- bot;
- carga;
- concurrencia;
- seguridad;
- medición;
- optimización;
- README;
- documentación;
- tag v1.0.0.

## Prioridad temporal

La fecha de entrega académica indicada es 12 de noviembre de 2026. Por el margen corto, priorizar:
1. vertical slice de dos jugadores que termina una partida;
2. dominio y persistencia correctos;
3. concurrencia/idempotencia/reconexión;
4. seguridad y Azure;
5. pruebas y documentación;
6. pueblo y arte mínimo funcional;
7. cosméticos adicionales solo si queda tiempo.

No sacrificar requisitos académicos para producir más arte.

---

# 20. Reglas de trabajo para Claude Opus

1. Leer este documento completo antes de modificar código.
2. Si existe `Proyecto3.pdf`, leerlo y mantener una checklist de cumplimiento.
3. No asumir que una característica visual ya está implementada porque aparezca en el GDD.
4. No afirmar que una prueba pasó sin ejecutarla.
5. No inventar resultados de carga, latencia, costo ni despliegue.
6. Mantener TypeScript strict y evitar `any`.
7. Mantener dominio puro y testeable.
8. No confiar en el cliente para daño, vida, turnos, monedas o resultados.
9. No agregar movimientos de personajes.
10. No introducir sistemas de progresión complejos.
11. No vender poder con monedas.
12. No copiar personajes, nombres, mapas, textos o assets de The Witcher ni Bowmasters.
13. Preferir código pequeño y verificable a abstracciones prematuras.
14. Antes de cada fase, indicar objetivo y archivos a modificar.
15. Después de cada fase, ejecutar pruebas y resumir resultados reales.
16. Si el alcance amenaza la fecha, proponer recortes cosméticos, nunca recortar requisitos críticos del servidor.
17. Mantener un `DECISIONS.md` para decisiones técnicas y un `CHANGELOG.md`.
18. Actualizar contratos OpenAPI/AsyncAPI junto con el código.
19. Mantener un README que permita reproducir el proyecto.
20. Preguntar antes de cambiar una decisión de diseño congelada.

---

# 21. Decisiones abiertas que deben resolverse explícitamente

Estas cuestiones no deben bloquear el primer prototipo, pero deben quedar documentadas:
- ¿El turno por timeout simplemente pasa al rival o cuenta como derrota tras dos timeouts?
- ¿Se permite empate en el límite de rondas? Recomendación: sí.
- ¿El viento permanece fijo durante toda la partida? Recomendación: sí, para que el cálculo sea aprendible.
- ¿Los obstáculos serán simétricos? Recomendación: diseñar arenas equilibradas y probar ambos lados.
- ¿Se implementan pociones funcionales en el MVP? Recomendación: no; primero combate básico.
- ¿Las armas se eligen antes de partida o se fija un arma por personaje? Recomendación: selección simple en lobby, todas disponibles para todos.
- ¿El fondo del pueblo será side-view, top-down o isométrico? Elegir una perspectiva única antes de producir todos los assets.
- ¿La guía de trayectoria muestra el efecto del viento? Recomendación: sí.
- ¿Se simula el vuelo en servidor hasta colisión o se usa solución matemática determinista? Elegir lo más simple que cumpla reproducibilidad y p95.

---

# 22. Definición final del producto

ASHENFALL es un juego web 2D de fantasía medieval oscura. El jugador visita un pueblo mercantil estático, personaliza su mercenario y busca un duelo 1v1. En combate, ambos personajes permanecen fijos. En su turno, cada jugador ajusta el ángulo y la potencia mientras observa una guía de trayectoria, y dispara un arma arrojadiza. El servidor valida la intención y calcula el proyectil, colisión, daño y resultado. Las arenas presentan biomas y viento. Las victorias entregan monedas que se guardan en una bolsa y se gastan en cosméticos dentro del pueblo.

**Fantasía del jugador:** ser un mercenario conocido en una tierra peligrosa, preparar su apariencia en Ashenfall y demostrar su puntería en duelos donde cada disparo cuenta.

**Promesa del producto:** entrar rápido, entender el combate, querer una revancha y volver al pueblo a gastar las monedas ganadas.

**Lema:** *Aim true. Survive the ashes.*

---

# 23. Referencias incluidas

- `references/ashenfall_visual_reference_board.png`: moodboard de dirección visual. Usar como inspiración de paleta, tono, pueblo, siluetas, personajes, objetos y composición. No usar como spritesheet de producción.
- `references/ashenfall_gameplay_and_asset_board.png`: tablero conceptual adicional con referencias de gameplay, personajes, biomas, armas, iconos y UI. Usar como guía visual, no como assets finales ni spritesheets listos para importar.
- `references/ashenfall_visual_pitchboard.png`: tablero conceptual adicional con referencias de gameplay, personajes, biomas, armas, iconos y UI. Usar como guía visual, no como assets finales ni spritesheets listos para importar.
- `Proyecto3.pdf`: brief académico original. Sus requisitos se resumen en la sección 16. Si el PDF está disponible para Claude, debe consultarlo directamente para verificar cualquier duda.

**Fin del documento maestro ASHENFALL.**
