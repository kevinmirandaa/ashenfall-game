import { metrics, SpanStatusCode, trace, type Attributes, type Meter, type Tracer } from '@opentelemetry/api';

/** Límites del histograma, en ms, alrededor de la meta de 200 ms del enunciado. */
const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 200, 500, 1000, 2500];

export interface Telemetry {
  /** Jugada confirmada en PostgreSQL; la tasa por segundo se calcula al consultar. */
  shotConfirmed(): void;
  /** Tiempo desde que llegó la jugada hasta repartirla a los jugadores conectados a esta réplica. */
  recordShotLatency(milliseconds: number): void;
  /** Los valores se leen solo al exportar: no cuestan nada entre exportaciones. */
  observeConnections(read: () => number): void;
  observeActiveMatches(read: () => Promise<number>): void;
  inSpan<T>(name: string, attributes: Attributes, work: () => Promise<T>): Promise<T>;
}

export function createTelemetry(meter: Meter, tracer: Tracer): Telemetry {
  const shots = meter.createCounter('ashenfall.shots', { description: 'Jugadas confirmadas', unit: '{jugada}' });
  const latency = meter.createHistogram('ashenfall.shot.latency', {
    description: 'Desde que llega la jugada hasta repartirla a los jugadores',
    unit: 'ms',
    advice: { explicitBucketBoundaries: LATENCY_BUCKETS_MS },
  });
  const connections = meter.createObservableGauge('ashenfall.connections', { description: 'Conexiones en esta réplica' });
  const activeMatches = meter.createObservableGauge('ashenfall.matches.active', { description: 'Partidas en curso, en todas las réplicas' });

  return {
    shotConfirmed: () => {
      shots.add(1);
    },
    recordShotLatency: (milliseconds) => {
      latency.record(Math.max(0, milliseconds));
    },
    observeConnections: (read) => {
      connections.addCallback((result) => {
        result.observe(read());
      });
    },
    observeActiveMatches: (read) => {
      activeMatches.addCallback(async (result) => {
        // Si la base falla no se informa un valor falso; el fallo no debe afectar a la exportación.
        const value = await read().catch(() => null);
        if (value !== null) result.observe(value);
      });
    },
    inSpan: (name, attributes, work) =>
      tracer.startActiveSpan(name, { attributes }, async (span) => {
        try {
          return await work();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          // Solo el tipo: el mensaje podría incluir datos internos.
          span.setAttribute('error.type', error instanceof Error ? error.name : 'unknown');
          throw error;
        } finally {
          span.end();
        }
      }),
  };
}

/** Sin proveedor registrado, la API de OpenTelemetry no hace nada: es el modo local y el de las pruebas. */
export function defaultTelemetry(): Telemetry {
  return createTelemetry(metrics.getMeter('ashenfall'), trace.getTracer('ashenfall'));
}

/** Añade el id de traza a cada log, para cruzar registros y trazas. */
export function traceLogFields(): { traceId?: string } {
  const context = trace.getActiveSpan()?.spanContext();
  return context === undefined ? {} : { traceId: context.traceId };
}
