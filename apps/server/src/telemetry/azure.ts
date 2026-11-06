import { AzureMonitorMetricExporter, AzureMonitorTraceExporter } from '@azure/monitor-opentelemetry-exporter';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, NodeTracerProvider, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';

const METRIC_EXPORT_INTERVAL_MS = 60_000;
/** Una de cada diez jugadas: decidir cuesta una comparación, y exportar menos reduce CPU y costo. */
const TRACE_SAMPLE_RATIO = 0.1;

/**
 * Activa la exportación solo si hay cadena de conexión. Sin ella no se crea nada y el servidor funciona
 * igual en local. Se llama antes de crear la app, para que las métricas usen este proveedor.
 */
export function startAzureTelemetry(connectionString: string | undefined): (() => Promise<void>) | null {
  if (connectionString === undefined || connectionString === '') return null;

  const meterProvider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new AzureMonitorMetricExporter({ connectionString }),
        exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  const tracerProvider = new NodeTracerProvider({
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(TRACE_SAMPLE_RATIO) }),
    spanProcessors: [new BatchSpanProcessor(new AzureMonitorTraceExporter({ connectionString }))],
  });
  tracerProvider.register();

  return async () => {
    await Promise.allSettled([meterProvider.shutdown(), tracerProvider.shutdown()]);
  };
}
