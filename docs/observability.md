# Observabilidad

Funciona igual sin Azure: si no existe `APPLICATIONINSIGHTS_CONNECTION_STRING`, OpenTelemetry queda en modo no-op y los logs salen por stdout. **Nada de esto se ha verificado todavía en Azure.**

## Métricas propias
Se exportan cada 60 s a Application Insights (tabla `customMetrics`).

| Métrica | Tipo | Significado |
|---|---|---|
| `ashenfall.matches.active` | gauge | Partidas en curso, en todas las réplicas. Una consulta barata por exportación |
| `ashenfall.connections` | gauge | Conexiones WebSocket en esta réplica |
| `ashenfall.shots` | counter | Jugadas confirmadas; jugadas por segundo = incremento / intervalo |
| `ashenfall.shot.latency` | histogram (ms) | Desde que llega la jugada hasta repartirla a los jugadores de esta réplica |

**Latencia:** usa el reloj del servidor. Entre réplicas distintas incluye su posible desfase de reloj. Application Insights guarda de un histograma el conteo, la suma, el mínimo y el máximo, no los percentiles: el p95 oficial sale de la prueba de carga ([load-report.md](load-report.md)).

## Trazas
Un span por comando de partida (`match.shoot`, `match.turn_timeout`...) con `ashenfall.match_id` y `ashenfall.player_id`. Se exporta el 10 % de las trazas y sin instrumentación automática, para mantener bajo el consumo. Los errores registran solo el tipo, no el mensaje.

## Logs
JSON por stdout hacia Log Analytics (`ContainerAppConsoleLogs`), con `matchId`, `playerId` y `traceId` cuando hay un span activo. Ciclo de vida de partida a `info`; cada jugada, a `debug`, desactivado por defecto. Nunca incluyen contraseñas, tokens, tickets, correos, `actionId`, ángulo ni potencia.

```kusto
ContainerAppConsoleLogs
| where Log has "<matchId>"
| project TimeGenerated, Log
| order by TimeGenerated asc
```

## Sondas
- `/health/live`: el proceso responde; sin dependencias y sin límite de tasa.
- `/health/ready`: PostgreSQL y Redis responden; 503 si alguno falla, sin detalles.

## Alertas (`infra/main.bicep`)

| Alerta | Condición | Severidad |
|---|---|---|
| `alert-restarts` | Reinicios del servidor en 15 min | 1 |
| `alert-postgres-cpu` | CPU de PostgreSQL por encima del 80 % durante 15 min | 2 |
| `alert-latency` | Latencia media de jugada por encima de 200 ms en 15 min | 2 |

Para recibir correos, define `ALERT_EMAIL` al desplegar: el Bicep crea un grupo de acciones. **Falta pasar esa variable en `.github/workflows/deploy.yml`**, que quedó fuera de este cambio; sin ella, las alertas se ven solo en el portal. La de latencia usa la media por la limitación descrita arriba, y es una consulta programada que tiene un pequeño costo mensual.
