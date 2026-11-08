#!/usr/bin/env bash
# Despliega un ambiente de ASHENFALL. Lo ejecuta el pipeline tras `azure/login` (OIDC); no usa secretos.
# Uso: scripts/deploy.sh <dev|prod>
# Entorno: IMAGE_TAG (12 caracteres del sha), AZURE_LOCATION (opcional), ALLOWED_ORIGINS (opcional).
set -euo pipefail
# Sin terminal, instalar la extensión containerapp pediría confirmación y el comando fallaría.
az config set extension.use_dynamic_install=yes_without_prompt --only-show-errors

ENV_NAME="${1:?Uso: deploy.sh <dev|prod>}"
case "$ENV_NAME" in dev | prod) ;; *) echo "Ambiente inválido: $ENV_NAME" >&2; exit 2 ;; esac
: "${IMAGE_TAG:?Falta IMAGE_TAG}"
LOCATION="${AZURE_LOCATION:-northeurope}"
RG="rg-ashenfall-${ENV_NAME}"
APP="ashenfall-server-${ENV_NAME}"
NEW_REVISION="${APP}--$(echo "$IMAGE_TAG" | tr -d '-' | tr '[:upper:]' '[:lower:]' | cut -c1-12)"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"
TEMPLATE="infra/main.bicep"

step() { echo "::group::$*"; }
endstep() { echo "::endgroup::"; }

# --- 1. Grupo de recursos y quién despliega (claim oid del token OIDC; no necesita permisos de Graph) ---
step "Grupo de recursos"
az group create --name "$RG" --location "$LOCATION" --output none
endstep

TOKEN="$(az account get-access-token --query accessToken --output tsv)"
PAYLOAD="$(echo "$TOKEN" | cut -d. -f2 | tr '_-' '/+')"
while [ $((${#PAYLOAD} % 4)) -ne 0 ]; do PAYLOAD="${PAYLOAD}="; done
DEPLOYER_OBJECT_ID="$(echo "$PAYLOAD" | base64 -d | jq -r .oid)"
export DEPLOYER_OBJECT_ID

deploy() { # deploy <deployServer> [previousRevision]
  az deployment group create \
    --resource-group "$RG" \
    --name "ashenfall-${ENV_NAME}-${IMAGE_TAG}-$1" \
    --template-file "$TEMPLATE" \
    --parameters "infra/${ENV_NAME}.bicepparam" \
    --parameters location="$LOCATION" deployServer="$1" imageTag="$IMAGE_TAG" previousRevision="${2:-}" \
    --query "properties.outputs" --output json
}

# --- 2. Primera pasada: infraestructura base (ACR, Key Vault, PostgreSQL, Redis) sin la app del servidor ---
step "Infraestructura base"
OUT="$(deploy false)"
endstep
ACR="$(echo "$OUT" | jq -r .acrName.value)"
KV="$(echo "$OUT" | jq -r .keyVaultName.value)"

# --- 3. Imagen: build y push a ACR con el sha como tag ---
step "Imagen en ACR"
az acr login --name "$ACR" --output none
LOGIN_SERVER="$(echo "$OUT" | jq -r .acrLoginServer.value)"
docker build -t "${LOGIN_SERVER}/ashenfall-server:${IMAGE_TAG}" .
docker push "${LOGIN_SERVER}/ashenfall-server:${IMAGE_TAG}"
endstep

# --- 4. jwt-secret: se crea solo si no existe; el valor nunca se imprime ---
step "jwt-secret en Key Vault"
exists=0
for attempt in $(seq 1 12); do # el rol recién asignado puede tardar unos minutos en propagarse
  if az keyvault secret show --vault-name "$KV" --name jwt-secret --query id --output none 2>/dev/null; then
    exists=1
    break
  fi
  if value="$(openssl rand -hex 32)" && echo "::add-mask::$value" &&
    az keyvault secret set --vault-name "$KV" --name jwt-secret --value "$value" --output none 2>/dev/null; then
    exists=1
    break
  fi
  echo "Intento $attempt: esperando permisos de Key Vault..."
  sleep 20
done
unset value
[ "$exists" -eq 1 ] || { echo "No se pudo crear jwt-secret" >&2; exit 1; }
endstep

# --- 5. Segunda pasada: app del servidor ---
PREVIOUS=""
if [ "$ENV_NAME" = "prod" ] && az containerapp show --name "$APP" --resource-group "$RG" --output none 2>/dev/null; then
  # De la lista de revisiones: `ingress traffic show` no trae `revisionName` si el tráfico va a «la última revisión».
  PREVIOUS="$(az containerapp revision list --name "$APP" --resource-group "$RG" \
    --query "[?properties.trafficWeight==\`100\`].name | [0]" --output tsv)"
  [ "$PREVIOUS" = "None" ] && PREVIOUS=""
fi
step "Despliegue de la app (revisión ${NEW_REVISION}; tráfico previo en: ${PREVIOUS:-ninguna})"
OUT="$(deploy true "$PREVIOUS")"
endstep

diagnostics() { # Sin secretos: registros de la app, identidad y administradores de PostgreSQL.
  echo "::group::Diagnóstico"
  az containerapp logs show --name "$APP" --resource-group "$RG" --type console --tail 80 --format text 2>&1 | grep -E 'msg|message|rror' | tail -n 40 || true
  az identity show --name "id-ashenfall-${ENV_NAME}" --resource-group "$RG" --query "{name:name,clientId:clientId,principalId:principalId}" --output json || true
  PG="$(az postgres flexible-server list --resource-group "$RG" --query "[0].name" --output tsv)"
  az postgres flexible-server show --name "$PG" --resource-group "$RG" --query "{auth:authConfig,state:state}" --output json || true
  az postgres flexible-server microsoft-entra-admin list --server-name "$PG" --resource-group "$RG" --output json 2>&1 || az postgres flexible-server ad-admin list --server-name "$PG" --resource-group "$RG" --output json 2>&1 || true
  echo "::endgroup::"
}

smoke() { # smoke <fqdn>: hasta ~5 min (con réplicas a cero, dev arranca en frío)
  for attempt in $(seq 1 ${SMOKE_ATTEMPTS:-12}); do
    if curl -fsS --max-time 10 "https://$1/health/ready" --output /dev/null; then
      echo "Smoke test OK en https://$1/health/ready"
      return 0
    fi
    echo "Intento $attempt: sin respuesta aún..."
    sleep 10
  done
  echo "Smoke test falló en https://$1/health/ready" >&2
  return 1
}

if [ "$ENV_NAME" = "prod" ] && [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$NEW_REVISION" ]; then
  # --- 6a. Prod: la nueva revisión está al 0 %; se prueba por su URL y luego recibe el tráfico ---
  REVISION_FQDN="$(az containerapp revision show --name "$APP" --resource-group "$RG" \
    --revision "$NEW_REVISION" --query properties.fqdn --output tsv)"
  step "Smoke test de la revisión al 0 % de tráfico"
  smoke "$REVISION_FQDN" || { diagnostics; exit 1; }
  endstep
  step "Traslado de tráfico"
  az containerapp ingress traffic set --name "$APP" --resource-group "$RG" \
    --revision-weight "${NEW_REVISION}=100" --output none
  endstep
else
  step "Smoke test"
  smoke "$(echo "$OUT" | jq -r .serverFqdn.value)" || { diagnostics; exit 1; }
  endstep
fi

# --- 7. Drenado: se desactivan las revisiones viejas, salvo la nueva y la anterior (destino de rollback).
# La anterior se desactiva en el siguiente despliegue; las conexiones WSS que quedan en ella terminan
# solas (cierre ordenado, terminationGracePeriodSeconds=120) y ya no recibe tráfico nuevo.
step "Drenado de revisiones antiguas"
ACTIVE="$(az containerapp revision list --name "$APP" --resource-group "$RG" \
  --query "sort_by([?properties.active], &properties.createdTime)[].name" --output tsv)"
KEEP_PREVIOUS="${PREVIOUS:-}"
if [ -z "$KEEP_PREVIOUS" ]; then
  KEEP_PREVIOUS="$(echo "$ACTIVE" | grep -v "^${NEW_REVISION}$" | tail -n 1 || true)"
fi
while IFS= read -r rev; do
  [ -z "$rev" ] && continue
  [ "$rev" = "$NEW_REVISION" ] && continue
  [ "$rev" = "$KEEP_PREVIOUS" ] && continue
  echo "Desactivando $rev"
  az containerapp revision deactivate --name "$APP" --resource-group "$RG" --revision "$rev" --output none
done <<< "$ACTIVE"
endstep

echo "Despliegue de ${ENV_NAME} terminado: revisión ${NEW_REVISION}"
