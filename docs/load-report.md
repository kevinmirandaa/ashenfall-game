# Reporte de carga

Fecha: 5 de noviembre de 2026. **Entorno local, no Azure:** una réplica limitada a 1 CPU y 1 GB, con PostgreSQL y Redis sin límite y el bot en la misma máquina (Mac de 8 núcleos, Docker Desktop). En Azure las cifras pueden ser peores; esa medición sigue pendiente.

**Latencia medida:** desde que el bot envía la jugada hasta que ambos jugadores reciben el resultado y el tirador su confirmación. Metas del enunciado: p95 menor a 200 ms, ninguna jugada perdida o duplicada, error menor a 1 %.

## Reproducir
```bash
docker compose -f docker-compose.yml -f docker-compose.load.yml up -d --build --wait
```
```bash
npm run build
```
```bash
node apps/bot/dist/load.js --steps 25,50,100,200,400,800 --think-ms 1000 --shots 12 --container ashenfall-server-1 --out load-results/ritmo-normal.json
```
```bash
node apps/bot/dist/load.js --steps 200,400,800 --think-ms 100 --shots 20 --no-stop-on-breach --container ashenfall-server-1 --db-container ashenfall-postgres-1 --out load-results/quiebre.json
```
```bash
node apps/bot/dist/load.js --steps 100 --think-ms 1000 --shots 12 --login-storm 100 --container ashenfall-server-1 --db-container ashenfall-postgres-1 --out load-results/pico.json
```
Los datos crudos están en [docs/load/](load/). `docker-compose.load.yml` desactiva en la práctica los límites de tasa, porque todos los bots comparten IP.

## Ritmo de un disparo por segundo y partida
Sin jugadas perdidas ni duplicadas y sin errores en ningún escalón. Esta serie se midió antes de cambiar Argon2, que no interviene durante la partida.

| Partidas | Conexiones | Jugadas | Jugadas/s | p50 | p95 | p99 | CPU réplica | Memoria máx. |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 | 50 | 300 | 23 | 9 ms | 15 ms | 16 ms | 11 % | 53 MB |
| 50 | 100 | 600 | 46 | 7 ms | 13 ms | 17 ms | 13 % | 55 MB |
| 100 | 200 | 1200 | 92 | 4 ms | 14 ms | 17 ms | 13 % | 56 MB |
| 200 | 400 | 2400 | 184 | 3 ms | 9 ms | 24 ms | 15 % | 61 MB |
| 400 | 800 | 4800 | 369 | 2 ms | 5 ms | 7 ms | 21 % | 66 MB |
| 800 | 1600 | 9600 | 737 | 2 ms | 7 ms | 17 ms | 33 % | 75 MB |

**Consumo por partida**, entre 400 y 800 partidas: unos 0,03 puntos de CPU y 0,02 MB por partida activa, a este ritmo. La memoria incluye lo que el proceso ya tenía reservado, así que es una aproximación.

**Sin explicar:** el p50 baja al subir la carga. Puede deberse a que el proceso nunca llega a estar inactivo, pero no se ha confirmado. No afecta al cumplimiento de la meta.

## Punto de quiebre
Diez disparos por segundo y partida, para saturar sin crear miles de cuentas. Ninguna jugada se perdió ni duplicó, tampoco al degradarse.

| Partidas | Jugadas | Jugadas/s | p50 | p95 | p99 | CPU réplica | CPU PostgreSQL | Meta p95 |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 200 | 4000 | 1692 | 7 ms | 43 ms | 52 ms | 51 % | 46 % | Cumple |
| 400 | 8000 | 1781 | 119 ms | 198 ms | 225 ms | 66 % | 95 % | Justo en el límite |
| 800 | 16000 | 1845 | 327 ms | 428 ms | 453 ms | 98 % | 80 % | No cumple |

**Conclusión:** una réplica deja de cumplir la meta alrededor de **1 800 jugadas por segundo**, y el rendimiento apenas sube a partir de ahí. A un disparo por segundo y partida se midió sin degradación hasta 800 partidas. Extrapolando, el tope rondaría 1 700 partidas, pero **esa cifra no se ha medido**. El bot comparte máquina con el servidor, así que también puede influir en el techo.

## Optimización medida
Mismo pico en ambos casos: 100 partidas en juego mientras 100 clientes envían logins fallidos sin parar, con el límite por IP desactivado, que es el peor caso de un ataque distribuido.

| Métrica | Antes | Después |
|---|---:|---:|
| Contraseñas a la vez | 2 | 1 |
| p95 de las jugadas | 202 ms | 109 ms |
| p99 de las jugadas | 270 ms | 169 ms |
| Máximo | 290 ms | 187 ms |
| Jugadas perdidas | 0 | 0 |

"Después" está en `docs/load/storm.json`. El archivo de "antes" se sobrescribió al repetir la prueba; sus cifras se copiaron del resultado de esa ejecución y se pueden reproducir con `maxConcurrent: 2`.

También se cambió Argon2id de los valores por defecto de la librería (64 MiB, t=3, p=4) a una configuración mínima de OWASP (19 MiB, t=2, p=1). Preparar 100 partidas, con sus 200 cuentas, pasó de **57 s a 5 s** aproximadamente. Durante el pico, la memoria máxima fue de 81 MB y el servidor rechazó con 503 los logins que no cabían en la fila.

**Coste aceptado:** una sola réplica procesa pocos logins por segundo (unos 20 en este pico), así que en un pico real algunos usuarios recibirán 503 y deberán reintentar. Se prefiere a poner en riesgo las partidas en curso.

## Mensajes compactos
JSON con los campos mínimos y trayectorias en enteros muestreados: **unos 302 bytes por mensaje** de media.
