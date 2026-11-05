# Costo estimado en Azure

**ESTIMACIÓN del 5 nov 2026. No es una factura: nada de esto se ha desplegado ni medido.**

## Qué se verificó
Se consultó la API pública de precios (`https://prices.azure.com/api/retail/prices`, región `northeurope`, USD, precios de lista) el 5 nov 2026:

| Recurso | Precio de lista verificado |
|---|---|
| PostgreSQL Flexible Server Burstable B1ms | 0,018 USD/hora |
| ACR Basic | 0,1666 USD/día |
| Container Apps, vCPU activa | 0,000024 USD/s |
| Container Apps, vCPU en reposo | 0,000003 USD/s |
| Container Apps, memoria (activa o reposo) | 0,000003 USD/GiB·s |
| Log Analytics, datos analizados | 2,3 USD/GB |
| Backups de PostgreSQL | 0,095 USD/GB·mes |

**No se pudo verificar** (no apareció en la consulta o no se comprobó): precio del almacenamiento de 32 GB de PostgreSQL, Key Vault estándar (se cobra por operaciones, centavos a este volumen), Application Insights (se factura como datos de Log Analytics), las cuotas gratuitas mensuales de Container Apps y si el entorno solo Consumption tiene un cargo fijo de gestión (la API lista "Environment Management Hour" 0,1 USD/h, que según la documentación aplica a perfiles dedicados; se asume que no aplica aquí, **compruébalo en la Pricing Calculator antes de desplegar**: 0,1 USD/h son 73 USD/mes por entorno).
La región real depende de lo que permita tu suscripción; los precios cambian por región.

## Supuestos
Mes de 30 días. Rango bajo = réplicas casi siempre en reposo; rango alto = réplicas siempre activas. Sin descontar cuotas gratuitas de Container Apps. Sin tráfico de salida.

## Por ambiente (USD/mes)
| Recurso | prod | dev (encendido) |
|---|---|---|
| PostgreSQL B1ms, cómputo 24/7 | 13,14 | 13,14 |
| PostgreSQL, almacenamiento 32 GB | sin verificar | sin verificar |
| ACR Basic | 5,00 | 5,00 |
| Redis (0,25 vCPU, 0,5 GiB, 1 réplica fija) | 5,8 a 19,4 | 5,8 a 19,4 |
| Servidor | 11,7 a 38,9 (1 réplica mínima; más si escala a 3) | 0 si está a cero; ~5 con ~100 h activas al mes |
| Log Analytics (tope diario 1 GB) | desde 0 hasta 69 en el peor caso; esperado muy bajo | igual |
| Key Vault, VNet, identidad | ~0 | ~0 |
| **Subtotal sin almacenamiento ni logs** | **~36 a ~77** | **~24 a ~43** |

Los dos ambientes encendidos todo el mes suman **~60 a ~120 USD**, más almacenamiento y logs. Azure for Students suele dar un crédito de 100 USD (confírmalo en el portal de la suscripción): **es ajustado**.

## Cómo mantenerlo dentro del crédito
1. Desplegar `prod` cerca de la entrega (una ejecución del pipeline lo crea) y borrar el grupo de recursos tras la revisión.
2. Detener PostgreSQL de dev cuando no se use (ahorra el cómputo, 13,14 USD/mes; el almacenamiento se sigue cobrando). Azure lo vuelve a encender solo a los 7 días.
3. El servidor de dev ya escala a cero. Redis de dev sigue encendido (5,8 a 19,4 USD); si hace falta, se puede borrar con el grupo.
4. El tope diario de 1 GB de Log Analytics acota el peor caso de logs.
5. Si el costo no cabe, la decisión ya documentada es sustituir y recortar ambientes, nunca requisitos del servidor (ver `DECISIONS.md`, D12).
