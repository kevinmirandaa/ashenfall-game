# Optimización de recursos (SCRUM-70)

Fecha: 7 de noviembre de 2026. **Todo se midió en local** (Mac de 8 núcleos, Docker Desktop), no en Azure. Cada cifra sale de una ejecución real; donde algo no se pudo medir se dice. Objetivo: que el juego pese poco en el navegador, que el servidor gaste poca CPU y memoria, y que Azure consuma el mínimo crédito, **sin cambiar el juego ni las reglas**.

## Resumen

| Medida | Antes | Después |
|---|---:|---:|
| Descarga de un jugador nuevo, de abrir la página a empezar una partida contra un monstruo (caché vacía) | 105 peticiones, **3,84 MB** | 47 peticiones de red, **1,29 MB** |
| Pantalla de acceso (antes de iniciar sesión) | 70 peticiones, 3,45 MB | 7 peticiones, 0,42 MB |
| JavaScript transferido | 1 292 KB (sin comprimir) | 289 KB (brotli: 24,5 KB juego + 264,5 KB Phaser) |
| Atlas de obstáculos | 1 039 KB | 365 KB |
| Volver a abrir la pantalla de acceso (caché llena, menos de 1 hora después) | 37 peticiones revalidadas (304), 11 100 B | 1 petición (solo el HTML, 304), 300 B; el resto sale de la caché |
| Imagen Docker (disco / contenido) | 565 MB / 102 MB | 387 MB / 79,4 MB |
| Consultas a PostgreSQL en reposo | 4,42 transacciones/s | 2,76 transacciones/s |
| Idas y vueltas a PostgreSQL por jugada | 7 | 5 |
| Listado de salas públicas (50 salas) | 101 consultas, p95 7,5 ms | 2 consultas, p95 1,1 ms |
| Jugadas/s en saturación (400 y 800 partidas, 2 ejecuciones) | 1 593 a 1 647 | 1 754 a 1 839 |

## 1. Peso del cliente

**Cómo se midió.** Navegador real (panel de navegador de Claude, Chromium) sobre `docker compose`, con la caché vacía (otro origen: `localhost` antes, `127.0.0.1` después). Se creó una cuenta de prueba local, se abrió el modo historia y se empezó el nivel 1. Las cifras salen de `performance.getEntriesByType('resource')` (`transferSize`, es decir, bytes por la red con cabeceras).

| Momento | Antes | Después |
|---|---|---|
| Pantalla de acceso | 70 peticiones, 3 454 064 B | 7 peticiones, 416 381 B |
| Pueblo tras registrarse | 77 peticiones | 15 peticiones, 691 582 B |
| Partida empezada | 105 peticiones, 3 838 871 B | 52 entradas (47 por red, 5 desde caché), 1 286 679 B |

La cifra de "después" incluye además abrir la ventana de Personajes, que el "antes" no abrió; el resto del recorrido es el mismo. La arena sorteada difiere entre las dos ejecuciones (ruinas vs. puente helado); cada partida descarga un solo fondo, de 55 a 136 KB.

**Qué se cambió.**
- **Carga por partida** (`apps/client/src/arena.ts`). Antes `preload` bajaba al abrir la página los 20 cuerpos, las 32 armas, los 7 fondos, los 4 terrenos y el atlas, aunque el jugador aún no hubiera iniciado sesión. Ahora `preload` solo carga la daga y `loadMatch` pide lo de esa partida: dos cuerpos, sus dos armas, un fondo, un terreno y el atlas (una vez; luego queda en caché). La protección contra partidas que llegan antes de tiempo se conserva y se amplía: mientras faltan texturas la partida espera en `pendingLoad`, sus eventos en `pendingEvents`, `busy` es verdadero (no se puede apuntar) y al terminar la descarga se construye la última partida pedida y se aplican sus eventos en orden. Si llega otra partida durante la descarga, se reintenta con la nueva.
- **Atlas con pérdida casi invisible** (`scripts/build-obstacles.py`). WebP con calidad 90 y alfa sin pérdida: de 1 039 098 a 364 750 bytes (−65 %). Diferencia medida píxel a píxel sobre las zonas visibles: PSNR 37,8 dB, error medio 2,6/1,9/2,9 de 255 por canal (R/G/B), percentil 99 de 6/255 en luminancia y **alfa idéntico** (siluetas y colisiones dibujadas sin cambios). Se comparó también una captura de partida antes y después. Se probaron calidad 80 (267 KB, 33 dB) y 95 (469 KB, 40 dB); 90 es el punto en que la diferencia deja de verse.
- **Phaser en un fichero aparte** (`apps/client/vite.config.ts`). El código del juego pesa 83 KB; Phaser, 1,2 MB. Separados, un despliegue del juego solo invalida los 83 KB y el navegador conserva Phaser en caché.
- **Phaser pasa a devDependencies** del cliente: el bundle lo incluye y en ejecución no hace falta. Esto es lo que reduce la imagen Docker.

**Qué no se hizo.** No se cargó Phaser de forma diferida (tras iniciar sesión): `main.ts` crea el juego al arrancar y separar esa dependencia obliga a reescribir el flujo de pantallas, con riesgo de repetir el error de partidas que llegan antes de `preload`. No se hizo un build parcial de Phaser (quitar física, audio, etc.): Phaser 3 no se reduce bien con Vite sin un build propio. No se quitaron ficheros de arte: todos los prefijos (`body-`, `portrait-`, `icon-`, `proj-`, `biome-`, `terrain-`) se usan.

**Coste aceptado.** Al empezar la primera partida se descargan unos 450 KB (atlas incluido); en las siguientes, solo lo nuevo (60 a 200 KB). Con una conexión de 10 Mb/s son menos de 0,5 s, y la presentación de la arena (paneo de cámara) dura unos 3 s. No se ha medido con una red lenta real.

## 2. Servidor de ficheros estáticos

`apps/server/src/app.ts`:
- **Precompresión en el build** (`vite.config.ts`, sin dependencias nuevas, solo `node:zlib`): cada JS, CSS, HTML y JSON de más de 1 KB queda con su `.br` (brotli 11) y `.gz` (gzip 9). `@fastify/static` con `preCompressed` elige según `Accept-Encoding` y añade `Vary: accept-encoding`. **Coste de CPU en ejecución: cero**; se descartó `@fastify/compress`, que comprimiría en cada petición. Las imágenes WebP no se comprimen (ya lo están) y la API y el WebSocket no se tocan.
- **Caché**: `/assets/*` (nombres con hash de Vite) `public, max-age=31536000, immutable`; `/art/*` `public, max-age=3600` (sin hash: una hora y luego revalida con ETag); el HTML `no-cache` para que un despliegue llegue en la siguiente carga. ETag y `Last-Modified` siguen activos.
- **Sin registro por fichero**: las rutas estáticas y las sondas de salud registran a nivel `warn`. Una visita pide unas 50 a 100 rutas estáticas y las sondas de Azure llegan cada 5 y 10 s; cada petición escribía dos líneas (unos 425 bytes). Para las sondas son unos 0,3 GB al mes por réplica en Log Analytics, que se paga por GB (estimación con 0,3 peticiones/s, no medida en Azure). Los errores siguen registrándose.

Comprobado con `curl` sobre el contenedor:
```
/assets/phaser-Jt__PiWe.js   content-encoding: br   content-length: 264499   cache-control: public, max-age=31536000, immutable   vary: Origin, accept-encoding
/art/obs-atlas.json          content-encoding: br   content-length: 1809     cache-control: public, max-age=3600
/art/obs-atlas.webp          (sin comprimir)        content-length: 364750   cache-control: public, max-age=3600   etag: W/"590ce-..."
/                            cache-control: no-cache   content-security-policy presente
```
`apps/server/src/static.test.ts` (3 pruebas) fija este comportamiento: brotli, gzip y sin compresión según el cliente, caché por carpeta, 304 con `If-None-Match` y cabeceras de seguridad presentes en los estáticos.

## 3. CPU y memoria del servidor

**Reposo** (90 s tras 60 s de calma, sin partidas activas, `docker stats` cada 2 s y `pg_stat_database`):

| | Antes | Después |
|---|---:|---:|
| Transacciones de PostgreSQL/s | 4,42 | 2,76 |
| CPU media del servidor | 0,42 % | 0,57 % |
| CPU media de PostgreSQL | 1,55 % | 1,55 % |

La CPU en reposo ya era casi nula y la diferencia entre 0,42 % y 0,57 % es ruido de medición. La memoria en reposo osciló entre 48 y 85 MB según la ejecución y no se puede atribuir a ningún cambio. Lo que sí baja es el trabajo continuo de PostgreSQL, que en Azure es la pieza que más cuesta. **Cambio:** el barrido de plazos (`MatchSweeper`) seguía limpiando la cola de emparejamiento y las salas caducadas cada segundo; ahora lo hace cada 30 s (la cola ya filtra por `expires_at` y las salas caducan a la hora, así que el comportamiento no cambia). Los plazos de turno y los turnos del bot siguen comprobándose cada segundo.

**Por jugada.** `MatchEventStore.append` insertaba cada evento por separado y actualizaba el plazo y el turno del bot con dos `UPDATE`; en PvP el segundo se ejecutaba en cada jugada aunque no cambiara nada útil. Ahora es un `INSERT ... SELECT FROM unnest(...)` y un solo `UPDATE`: de 7 idas y vueltas por jugada (lectura del log, BEGIN, 2 INSERT, 2 UPDATE, COMMIT) a 5. PostgreSQL era el cuello de botella medido en el punto de quiebre.

**Prueba de quiebre** (diez disparos por segundo y partida, 20 disparos, `docker-compose.load.yml`: una réplica con 1 CPU y 1 GB). Dos ejecuciones de cada versión el mismo día, en la misma máquina; la versión "antes" se construyó desde el commit anterior (`22930f0`) para comparar en igualdad de condiciones. Ninguna jugada se perdió ni se duplicó y no hubo errores en ninguna.

| Partidas | Jugadas/s antes (1ª / 2ª) | Jugadas/s después (1ª / 2ª) | p95 antes | p95 después | CPU PostgreSQL antes | CPU PostgreSQL después | Memoria máx. antes / después |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 200 | 1 481 / 1 484 | 1 531 / 1 753 | 98 / 103 ms | 108 / 25 ms | 84 / 63 % | 85 / 96 % | 78 / 74 MB · 76 / 98 MB |
| 400 | 1 570 / 1 593 | 1 754 / 1 791 | 212 / 189 ms | 180 / 181 ms | 99 / 88 % | 59 / 57 % | 86 / 84 MB · 84 / 100 MB |
| 800 | 1 586 / 1 647 | 1 839 / 1 793 | 547 / 488 ms | 424 / 472 ms | 91 / 68 % | 67 / 83 % | 100 / 100 MB · 99 / 104 MB |

**Lectura honesta.** En saturación (400 y 800 partidas) el rendimiento sube un 9 a 16 % y a 400 partidas el p95 queda por debajo de la meta de 200 ms en las dos ejecuciones (antes, una de dos la incumplía). PostgreSQL deja de estar al 88 a 99 % a 400 partidas. A 200 partidas la variación entre ejecuciones (p95 de 25 a 108 ms) es mayor que la diferencia entre versiones, así que ahí no se afirma mejora. El techo de la réplica sigue rondando las 1 800 jugadas por segundo; ahora lo marca la CPU del servidor (96 %) más que PostgreSQL. Datos crudos en [load/](load/) (`opt-quiebre-*.json`).

**Salas públicas.** `RoomService.listPublic` hacía 1 + 2 consultas por sala (con 50 salas, 101, todas a la vez contra un pool de 20 conexiones). Ahora son 2 para toda la página, con la misma respuesta. Medido con 50 salas y 300 llamadas sobre PostgreSQL local: p50 de 4,96 a 0,92 ms, p95 de 7,53 a 1,11 ms, y 50 llamadas simultáneas de 264 a 27 ms.

**Revisado sin cambiar** (medido o razonado, sin evidencia de que fuera un problema): heartbeat de 15 s (una ping por conexión, coste mínimo); `toPlayerView` por mensaje (estructuras pequeñas: unos 350 bytes por mensaje); tamaño del log de eventos (como mucho unas 50 filas por partida); índices de plazos y turnos de bot (ya parciales sobre `in_progress`); pool de 20 conexiones (en la prueba no se agotó: el límite fue la CPU). El bot del servidor ya va en el mismo barrido, sin temporizadores propios.

**Límite de memoria de Node.** En Azure se fija `NODE_OPTIONS=--max-old-space-size` a la mitad de la memoria del contenedor (512 MB en prod, 256 MB en dev), para que el recolector actúe antes de que la plataforma mate el proceso. El máximo medido bajo carga fue de 104 MB. En `docker compose` local no se fija (sin límite de contenedor).

## 4. Imagen Docker

| | Antes | Después |
|---|---:|---:|
| Tamaño en disco | 565 MB | 387 MB |
| Contenido comprimido | 102 MB | 79,4 MB |
| `node_modules` en la imagen | 284 MB, de ellos 148 MB de Phaser | sin Phaser |

El `Dockerfile` ya era multi-stage, con usuario no root y `npm prune --omit=dev`; Phaser se colaba porque era dependencia de producción del cliente. Pasarlo a `devDependencies` lo elimina sin tocar el `Dockerfile`. `.dockerignore` ya excluía `node_modules`, `dist`, `.git`, `references` y los `.md`. **No se midió el tiempo de build en frío** (las capas estaban en caché; con caché, 68 s). Lo siguiente más grande es `@azure/msal-browser` (19 MB), que arrastra `@azure/identity` aunque en Node no se use; quitarlo a mano de la imagen es frágil y no se hizo.

## 5. Azure
Ver [azure-cost.md](azure-cost.md): cambios aplicados en Bicep, tabla de coste estimado y cómo pausar o borrar todo.

## Reproducir
- Cliente: `npm run build -w @ashenfall/client`, `docker compose up -d --build --wait` y abrir `http://127.0.0.1:8080` con la caché vacía; sumar `performance.getEntriesByType('resource')`.
- Quiebre: los comandos de [load-report.md](load-report.md) (`--steps 200,400,800 --think-ms 100 --shots 20 --no-stop-on-breach`).
- Reposo: `docker stats` y `SELECT xact_commit + xact_rollback FROM pg_stat_database WHERE datname = 'ashenfall'` al principio y al final de un intervalo.
