# Costo estimado en Azure

**ESTIMACIÓN. No es una factura: nada de esto se ha desplegado ni medido en Azure.** Precios consultados el 5 nov 2026; revisión de coste y cambios de Bicep del 7 nov 2026 (SCRUM-70).

## Fuente de los precios
API pública de precios (`https://prices.azure.com/api/retail/prices`, región `northeurope`, USD, precios de lista), consultada el 5 nov 2026:

| Recurso | Precio de lista verificado |
|---|---|
| PostgreSQL Flexible Server Burstable B1ms | 0,018 USD/hora |
| ACR Basic | 0,1666 USD/día |
| Container Apps, vCPU activa | 0,000024 USD/s |
| Container Apps, vCPU en reposo | 0,000003 USD/s |
| Container Apps, memoria (activa o reposo) | 0,000003 USD/GiB·s |
| Log Analytics, datos analizados | 2,3 USD/GB |
| Backups de PostgreSQL | 0,095 USD/GB·mes |

**No se pudo verificar**: precio del almacenamiento de 32 GB de PostgreSQL, Key Vault estándar (se cobra por operaciones, centavos a este volumen), Application Insights (se factura como datos de Log Analytics), las cuotas gratuitas mensuales de Container Apps y de Log Analytics, y si el entorno solo Consumption tiene un cargo fijo de gestión (la API lista "Environment Management Hour" 0,1 USD/h, que según la documentación aplica a perfiles dedicados; se asume que no aplica aquí, **compruébalo en la Pricing Calculator antes de desplegar**: 0,1 USD/h son 73 USD/mes por entorno). La región real depende de tu suscripción; los precios cambian por región.

## Supuestos
Mes de 30 días (2 592 000 s; PostgreSQL con 730 h). "Reposo" = réplica encendida sin trabajo (Container Apps cobra la vCPU a la tarifa de reposo); "activo" = siempre trabajando. Sin descontar cuotas gratuitas. Sin tráfico de salida. Las cifras son la multiplicación de los precios de arriba por los recursos del Bicep; no son lecturas de una factura.

## Por recurso y ambiente (USD/mes)
| Recurso | Configuración en Bicep | prod | dev (encendido) |
|---|---|---|---|
| PostgreSQL B1ms, cómputo 24/7 | Burstable B1ms, sin HA | 13,14 | 13,14 (0 si está detenido) |
| PostgreSQL, almacenamiento | 32 GB (mínimo), sin crecimiento automático | sin verificar | sin verificar (se cobra aunque esté detenido) |
| PostgreSQL, backup | 7 días (mínimo), sin geo-redundancia | 0,095 por GB por encima de lo incluido | igual |
| ACR Basic | SKU mínimo | 5,00 | 5,00 |
| Redis (Container App) | 0,25 vCPU, 0,5 GiB, 1 réplica fija | 5,8 (reposo) a 19,4 (activo) | 5,8 a 19,4 |
| Servidor | prod 0,5 vCPU y 1 GiB, 1 a 3 réplicas; dev 0,25 vCPU y 0,5 GiB, 0 a 1 | 11,7 (reposo) a 38,9 (activo) por réplica | 0 a cero réplicas; ~2,7 con 100 h activas (antes ~5,4) |
| Log Analytics | 30 días de retención, tope 1 GB/día | desde 0; peor caso 69 | igual |
| Application Insights | 10 % de trazas muestreadas en el código, métricas cada 60 s | incluido en Log Analytics | igual |
| Key Vault, VNet, identidad, alertas (3) | estándar | ~0 | ~0 |
| **Subtotal sin almacenamiento ni logs** | | **~36 a ~77** | **~24 a ~40** |

Los dos ambientes encendidos todo el mes suman **~60 a ~117 USD**, más almacenamiento y logs. Azure for Students suele dar 100 USD de crédito (confírmalo en el portal): **es ajustado**, por eso conviene apagar o borrar lo que no se use (abajo).

## Cambios aplicados en Bicep (SCRUM-70)
Solo los que reducen coste sin quitar ningún requisito del enunciado (las 3 alertas, Key Vault con identidad administrada, observabilidad y sondas siguen igual):

| Cambio | Ahorro estimado | Por qué no afecta a los requisitos |
|---|---|---|
| Servidor de dev a 0,25 vCPU y 0,5 GiB (prod sin cambios) | la mitad del coste por segundo activo de dev: ~2,7 USD con 100 h | Bajo carga se midieron como mucho 104 MB de memoria. dev no es donde se mide el rendimiento. |
| `NODE_OPTIONS=--max-old-space-size` a la mitad de la memoria (512 MB prod, 256 MB dev) | indirecto: evita reinicios por falta de memoria | Ninguno; el recolector actúa antes del límite del contenedor. |
| Diagnóstico del entorno: solo registros, sin copiar `AllMetrics` a Log Analytics | lo que pesen esas métricas al mes (no medido) | Las métricas de plataforma siguen en Azure Monitor sin coste y las alertas las leen de ahí. |
| PostgreSQL con `autoGrow: 'Disabled'` explícito | evita que el disco (y la factura) crezca sin decidirlo | 32 GB sobran para este volumen de datos. |
| Sin registros de petición para las sondas `/health/*` ni para los estáticos (código del servidor) | ~0,3 GB/mes por réplica de Log Analytics, ~0,7 USD (estimado, no medido en Azure) | Los fallos se siguen registrando como `warn`; las peticiones a la API se siguen registrando. |

Ya estaban en el mínimo: SKU de ACR (Basic), PostgreSQL (B1ms, 32 GB, 7 días de backup, sin HA ni geo-redundancia), retención de Log Analytics (30 días, incluida en el precio) y Redis (0,25 vCPU y 0,5 GiB es la combinación más pequeña de Container Apps).

## Decisiones pendientes (no aplicadas)
Cambian comportamiento, capacidad o el modo de trabajo; las decide el usuario.

| Opción | Ahorro estimado | Coste o riesgo | Recomendación |
|---|---|---|---|
| No desplegar dev, o borrar su grupo tras probar | ~24 a ~40 USD/mes | Se pierde el ambiente de pruebas; el pipeline despliega dev antes que prod. | **Sí**: desplegar dev solo para probar el pipeline y borrarlo después. |
| Detener PostgreSQL de dev cuando no se use | 13,14 USD/mes | Azure lo vuelve a encender a los 7 días; hay que encenderlo antes de desplegar. | **Sí**, ya documentado en azure-setup.md. |
| Un solo ACR para dev y prod | 5 USD/mes | Hay que cambiar el Bicep para que dev y prod compartan registro (otro grupo de recursos) y la asignación de AcrPull. | Solo si se mantienen los dos ambientes más de una semana. |
| Servidor de prod a 0,25 vCPU y 0,5 GiB | ~5,8 (reposo) a ~19,4 (activo) USD/mes por réplica | Reduce a la mitad la CPU con la que se midió el punto de quiebre (1 CPU en local). Argon2 tarda más en cada login. | **No** antes de la entrega: la nota de rendimiento usa esa capacidad. |
| Prod con `minReplicas 0` fuera de la revisión | 11,7 a 38,9 USD/mes | Arranque en frío; sin réplica el barrido de plazos se detiene y las partidas en curso no avanzan por timeout. | **No** durante la revisión; sí se puede borrar prod después. |
| Tope diario de Log Analytics de dev a 0,5 GB | el peor caso baja de 69 a ~35 USD/mes | Si se alcanza, se pierden registros el resto del día. | Opcional; en uso normal no se llega a 1 GB/día. |

## Cómo pausar o borrar todo para no gastar crédito
Nada de esto lo ejecuta Claude: son pasos para hacer desde el portal o desde Cloud Shell (que ya trae `az`). Los nombres reales tienen un sufijo; cópialos del portal.

**Pausar dev (se conserva todo, se sigue pagando almacenamiento, ACR y Redis en reposo):**
1. Servidor: ya escala a cero solo.
2. PostgreSQL: portal, `rg-ashenfall-dev`, servidor `psql-ashenfall-dev-...`, **Detener**. Equivale a `az postgres flexible-server stop --resource-group rg-ashenfall-dev --name <servidor>`. Para volver: **Iniciar** o `az postgres flexible-server start ...`.
3. Redis: portal, Container App `ashenfall-redis-dev`, **Escala**, réplicas mínimas a 0, guardar (equivale a `az containerapp update --resource-group rg-ashenfall-dev --name ashenfall-redis-dev --min-replicas 0`). **Sin verificar en Azure**: comprueba en **Réplicas** que queda en 0; si no baja, la forma segura de que Redis deje de costar es borrar el grupo. Para volver, mínimo 1. Sin Redis el servidor no está listo (`/health/ready` falla), así que hazlo solo con dev apagado.

**Pausar prod tras la revisión:** lo mismo que dev, y además el servidor: Container App `ashenfall-server-prod`, **Revisiones**, desactivar la revisión activa (`az containerapp revision deactivate --resource-group rg-ashenfall-prod --name ashenfall-server-prod --revision <revisión>`).

**Borrar todo (deja de costar, salvo el Key Vault en eliminación suave, que no se cobra):** portal, **Grupos de recursos**, `rg-ashenfall-dev` y `rg-ashenfall-prod`, **Eliminar grupo de recursos**. Equivale a `az group delete --name rg-ashenfall-dev --yes --no-wait`. Volver a desplegar es una ejecución del workflow **Deploy**.

**Vigilar el crédito:** portal, **Suscripciones**, tu suscripción de Azure for Students, **Análisis de costos**; y en **Presupuestos**, un presupuesto con aviso por correo al 50 % y al 80 % del crédito.
