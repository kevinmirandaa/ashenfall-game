# Guía de Azure, solo con el portal

No necesitas instalar `az`. Tú preparas la suscripción y la identidad de GitHub; el pipeline crea todo lo demás con `infra/main.bicep`. Nada de esto se ha probado todavía contra una suscripción real.

## 1. Suscripción y región
1. Entra a https://portal.azure.com y abre **Suscripciones**. Debe aparecer **Azure for Students** activa; anota el **Id. de suscripción**. En **Costos y facturación** comprueba el crédito restante.
2. Azure for Students restringe regiones mediante una directiva. Para verla: suscripción, **Directivas**, **Cumplimiento**, directiva "Allowed resource deployment regions" (o "Ubicaciones permitidas") y mira los parámetros con la lista de regiones. Otra forma: en el portal crea (sin terminar) un grupo de recursos y mira qué regiones ofrece el desplegable.
3. Elige una región de esa lista que también ofrezca PostgreSQL Flexible Server y Container Apps. Si no es `northeurope` (valor por defecto del pipeline), la pasarás en la variable `AZURE_LOCATION` (paso 5). Si un despliegue falla por "región sin capacidad" o "no permitida", prueba otra de la lista.

## 2. Registrar proveedores de recursos
Suscripción, **Proveedores de recursos**. Busca cada uno y pulsa **Registrar** (esperar a "Registrado"):
`Microsoft.App`, `Microsoft.DBforPostgreSQL`, `Microsoft.KeyVault`, `Microsoft.ContainerRegistry`, `Microsoft.OperationalInsights`, `Microsoft.Insights`, `Microsoft.Network`. Añade `Microsoft.ManagedIdentity` y `Microsoft.Authorization` si no figuran como registrados.

## 3. Identidad para GitHub (OIDC, sin secretos)
Si no tienes acceso a Entra ID, como en una cuenta de estudiante, crea una **identidad administrada asignada por el usuario** `ashenfall-github` en el grupo `rg-ashenfall-identity`, con credenciales federadas para los entornos `dev` y `prod`, y usa su Client ID. Es el método en uso. En el rol RBAC, elige la opción que excluye roles privilegiados. Alternativa con App Registration:

1. **Microsoft Entra ID**, **Registros de aplicaciones**, **Nuevo registro**. Nombre `ashenfall-github`, un solo inquilino, sin URI de redirección.
2. En el registro: **Certificados y secretos**, **Credenciales federadas**, **Agregar credencial**, escenario **GitHub Actions**. Crea dos:
   - Organización `kevinmirandaa`, repositorio `ashenfall-game`, entidad **Entorno**, nombre `dev`.
   - Igual, entorno `prod`.
   (El asunto resultante es `repo:kevinmirandaa/ashenfall-game:environment:dev` y `...:environment:prod`.) No crees ningún secreto de cliente.
3. Anota el **Id. de aplicación (cliente)** y el **Id. de directorio (inquilino)**.

## 4. Roles en la suscripción
Suscripción, **Control de acceso (IAM)**, **Agregar asignación de roles**, miembro = la aplicación `ashenfall-github`:
- **Contributor**: crear los recursos.
- **Role Based Access Control Administrator**: el Bicep asigna roles (AcrPull, Key Vault Secrets User/Officer). Si el portal pide condiciones, elige "Permitir al usuario asignar todos los roles".
Ambos a nivel de suscripción (los grupos de recursos los crea el pipeline).

## 5. Variables del repositorio
GitHub, repositorio, **Settings**, **Secrets and variables**, **Actions**, pestaña **Variables** (no Secrets), **New repository variable**:
- `AZURE_CLIENT_ID`: Id. de aplicación.
- `AZURE_TENANT_ID`: Id. de directorio.
- `AZURE_SUBSCRIPTION_ID`: Id. de suscripción.
- Opcional `AZURE_LOCATION`: región del paso 1.
- Opcional `ALLOWED_ORIGINS`: orígenes del cliente separados por comas.
Mientras `AZURE_CLIENT_ID` no exista, el workflow `Deploy` omite sus jobs.

## 6. Environments en GitHub
Se espera `dev` (sin reglas) y `prod` con revisores obligatorios (kevinmirandaa). Si no existen: **Settings**, **Environments**, **New environment**; en `prod` activa **Required reviewers**.

## 7. Qué debes devolverme
Confirmación de que los pasos 2 a 6 están hechos, la región elegida y, tras ejecutar `Deploy`, el resultado de los jobs (o el error exacto). No me envíes secretos: no hay ninguno. Los tres identificadores son datos de configuración, no credenciales.

## 8. Desplegar
Actions, **Deploy**, **Run workflow**. Tras un merge a `main` solo despliega si la variable `AUTO_DEPLOY` vale `true`; está apagada para no gastar crédito. `dev` se despliega solo; `prod` espera tu aprobación. La primera ejecución de cada ambiente tarda de 15 a 25 minutos (PostgreSQL y el entorno de Container Apps son lentos). Si PostgreSQL de dev está detenido, enciéndelo antes (paso 9): un despliegue sobre un servidor parado puede fallar.

## 9. Apagar dev
- **Servidor**: ya escala a cero (`minReplicas 0`). **Advertencia, solo dev**: sin réplica el barrido de plazos se detiene, así que las partidas en curso no avanzan por timeout hasta que otra petición arranque una réplica. En prod hay siempre al menos una.
- **PostgreSQL**: portal, `rg-ashenfall-dev`, servidor `psql-ashenfall-dev-...`, **Detener**. Para volver a usarlo: **Iniciar** (Azure lo enciende solo a los 7 días).
- Redis de dev (`ashenfall-redis-dev`) sigue encendido; se puede detener borrando su revisión o el grupo.

## 10. Borrar todo
Portal, **Grupos de recursos**, `rg-ashenfall-dev` y `rg-ashenfall-prod`, **Eliminar grupo de recursos**. El Key Vault queda en eliminación suave 7 días (su nombre no se libera hasta purgarlo; el nombre lleva un sufijo derivado del grupo, por lo que un grupo nuevo no choca). Después puedes borrar el App Registration.

## 11. Rollback (objetivo: menos de 5 minutos)
Cada despliegue crea una revisión; la anterior se deja activa. Con `az login` (por ejemplo en Cloud Shell del portal, que ya trae `az`):
```bash
scripts/rollback.sh prod
```
Lo mismo desde el portal: Container App `ashenfall-server-prod`, **Gestión de revisiones**, poner 100 % en la revisión anterior. Es un solo cambio de tráfico; los 5 minutos son un objetivo, aún no medido. Si la causa es un esquema de base de datos incompatible, el rollback de tráfico no revierte migraciones.

## Cómo funciona un despliegue (resumen)
`scripts/deploy.sh <ambiente>`: crea el grupo, despliega la infraestructura base, construye y sube la imagen a ACR (tag = sha), crea `jwt-secret` en Key Vault solo si falta (valor aleatorio sin imprimir), despliega la app. En prod la revisión nueva nace con 0 % de tráfico, se prueba por su URL de revisión (`/health/ready`), recibe el tráfico y se desactivan las revisiones más antiguas; la inmediatamente anterior queda activa para el rollback y se desactiva en el siguiente despliegue.
