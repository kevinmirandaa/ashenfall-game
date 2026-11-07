#!/usr/bin/env bash
# Pasa el 100 % del tráfico a la revisión anterior (la activa más reciente que no recibe tráfico).
# Objetivo de tiempo: menos de 5 minutos (es un solo cambio de tráfico; objetivo, no medición).
# Requiere `az login` con permisos sobre el grupo de recursos. Uso: scripts/rollback.sh <dev|prod>
set -euo pipefail
# Sin terminal, instalar la extensión containerapp pediría confirmación y el comando fallaría.
az config set extension.use_dynamic_install=yes_without_prompt --only-show-errors

ENV_NAME="${1:?Uso: rollback.sh <dev|prod>}"
case "$ENV_NAME" in dev | prod) ;; *) echo "Ambiente inválido: $ENV_NAME" >&2; exit 2 ;; esac
RG="rg-ashenfall-${ENV_NAME}"
APP="ashenfall-server-${ENV_NAME}"

# La revisión actual sale de la lista de revisiones: si el tráfico va a «la última revisión», `ingress traffic show`
# no trae `revisionName` y la consulta devolvía vacío (el script «volvía» entonces a la misma revisión).
CURRENT="$(az containerapp revision list --name "$APP" --resource-group "$RG" \
  --query "[?properties.trafficWeight==\`100\`].name | [0]" --output tsv)"
if [ -z "$CURRENT" ] || [ "$CURRENT" = "None" ]; then
  echo "No se pudo saber qué revisión recibe el 100 % del tráfico." >&2
  exit 1
fi
PREVIOUS="$(az containerapp revision list --name "$APP" --resource-group "$RG" \
  --query "sort_by([?properties.active && name!='${CURRENT}'], &properties.createdTime)[-1].name" --output tsv)"

if [ -z "$PREVIOUS" ] || [ "$PREVIOUS" = "None" ]; then
  echo "No hay una revisión anterior activa a la que volver." >&2
  exit 1
fi

echo "Revisión actual: ${CURRENT}"
echo "Volviendo a:     ${PREVIOUS}"
az containerapp ingress traffic set --name "$APP" --resource-group "$RG" \
  --revision-weight "${PREVIOUS}=100" --output none
az containerapp ingress traffic show --name "$APP" --resource-group "$RG" --output table
