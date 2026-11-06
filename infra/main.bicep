// ASHENFALL: toda la infraestructura de un ambiente en un solo archivo.
// Dos pasadas (ver .github/workflows/deploy.yml):
//   1) deployServer=false: red, ACR, PostgreSQL, Key Vault, Redis, entorno de Container Apps.
//   2) deployServer=true con imageTag: crea la app del servidor (necesita imagen en ACR y el secreto jwt-secret).
targetScope = 'resourceGroup'

@allowed(['dev', 'prod'])
param environmentName string

param location string = resourceGroup().location

@description('Tag de la imagen en ACR (sha corto del commit). Solo se usa con deployServer=true.')
param imageTag string = ''

@description('Orígenes CORS/WSS permitidos, separados por comas.')
param allowedOrigins string = ''

@description('false en la primera pasada (aún no hay imagen ni jwt-secret).')
param deployServer bool = false

@description('Object ID de quien despliega (el service principal de OIDC); recibe Key Vault Secrets Officer para crear jwt-secret.')
param deployerObjectId string

@description('Revisión que debe seguir con el 100 % del tráfico mientras la nueva se prueba. Vacío = la última revisión recibe todo.')
param previousRevision string = ''

@description('Correo que recibe las alertas. Vacío = solo se ven en el portal.')
param alertEmail string = ''

var isProd = environmentName == 'prod'
var suffix = take(uniqueString(resourceGroup().id), 6)
var identityName = 'id-ashenfall-${environmentName}'
var serverAppName = 'ashenfall-server-${environmentName}'
var redisAppName = 'ashenfall-redis-${environmentName}'
var databaseName = 'ashenfall'
var revisionSuffix = toLower(take(replace(imageTag, '-', ''), 12))

var roles = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  keyVaultSecretsOfficer: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

// ---------- Red ----------
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-ashenfall-${environmentName}'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.20.0.0/16'] }
    subnets: [
      {
        name: 'snet-apps'
        properties: {
          addressPrefix: '10.20.0.0/23'
          delegations: [{ name: 'apps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: '10.20.2.0/24'
          delegations: [{ name: 'pg', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
    ]
  }
}

resource pgDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'ashenfall-${environmentName}.private.postgres.database.azure.com'
  location: 'global'
}

resource pgDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: pgDns
  name: 'link-vnet'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

// ---------- Observabilidad ----------
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-ashenfall-${environmentName}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-ashenfall-${environmentName}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

// ---------- Key Vault ----------
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-ash-${environmentName}-${suffix}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, identity.id, roles.keyVaultSecretsUser)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
  }
}

resource kvSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, deployerObjectId, roles.keyVaultSecretsOfficer)
  properties: {
    principalId: deployerObjectId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsOfficer)
  }
}

// Valor tomado de otro recurso en el despliegue; nunca pasa por el repositorio.
resource appInsightsSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'appinsights-connection-string'
  properties: { value: appInsights.properties.ConnectionString }
  dependsOn: [kvSecretsOfficer]
}

// ---------- ACR ----------
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acrashenfall${environmentName}${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, identity.id, roles.acrPull)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
  }
}

// ---------- PostgreSQL (solo Entra, sin acceso público) ----------
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-ashenfall-${environmentName}-${suffix}'
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: subscription().tenantId
    }
    network: {
      delegatedSubnetResourceId: '${vnet.id}/subnets/snet-postgres'
      privateDnsZoneArmResourceId: pgDns.id
    }
  }
  dependsOn: [pgDnsLink]
}

module postgresAdmin 'modules/pg-admin.bicep' = {
  name: 'pg-admin'
  params: {
    serverName: postgres.name
    principalId: identity.properties.principalId
    principalName: identity.name
    tenantId: subscription().tenantId
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
  dependsOn: [postgresAdmin]
}

// ---------- Container Apps ----------
resource appsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-ashenfall-${environmentName}'
  location: location
  properties: {
    vnetConfiguration: { infrastructureSubnetId: '${vnet.id}/subnets/snet-apps', internal: false }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    // Registros por Azure Monitor: evita pasar la clave del workspace en la configuración.
    appLogsConfiguration: { destination: 'azure-monitor' }
  }
}

resource appsEnvDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: appsEnv
  name: 'to-log-analytics'
  properties: {
    workspaceId: logs.id
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

// Redis sin contraseña: solo es alcanzable dentro del entorno (ingress interno TCP). Ver DECISIONS.md.
resource redisApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: redisAppName
  location: location
  properties: {
    managedEnvironmentId: appsEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        transport: 'tcp'
        targetPort: 6379
        exposedPort: 6379
      }
    }
    template: {
      containers: [
        {
          name: 'redis'
          image: 'docker.io/library/redis:7-alpine'
          args: ['redis-server', '--save', '', '--appendonly', 'no']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

var serverEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'DATABASE_URL', value: 'postgres://${identity.name}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require' }
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'REDIS_URL', value: 'redis://${redisAppName}:6379' }
  { name: 'TRUST_PROXY', value: '1' }
  { name: 'OTEL_SERVICE_NAME', value: 'ashenfall-server' }
  { name: 'ALLOWED_ORIGINS', value: allowedOrigins }
  { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection-string' }
]

resource serverApp 'Microsoft.App/containerApps@2024-03-01' = if (deployServer) {
  name: serverAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: appsEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        traffic: empty(previousRevision)
          ? [{ latestRevision: true, weight: 100 }]
          : [{ revisionName: previousRevision, weight: 100 }]
      }
      registries: [{ server: acr.properties.loginServer, identity: identity.id }]
      secrets: [
        { name: 'jwt-secret', keyVaultUrl: '${keyVault.properties.vaultUri}secrets/jwt-secret', identity: identity.id }
        { name: 'appinsights-connection-string', keyVaultUrl: appInsightsSecret.properties.secretUri, identity: identity.id }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      terminationGracePeriodSeconds: 120
      containers: [
        {
          name: 'server'
          image: '${acr.properties.loginServer}/ashenfall-server:${imageTag}'
          env: serverEnv
          resources: { cpu: json('0.5'), memory: '1Gi' }
          probes: [
            { type: 'Liveness', httpGet: { path: '/health/live', port: 8080 }, periodSeconds: 10, failureThreshold: 3 }
            { type: 'Readiness', httpGet: { path: '/health/ready', port: 8080 }, periodSeconds: 5, failureThreshold: 3 }
          ]
        }
      ]
      scale: {
        minReplicas: isProd ? 1 : 0
        maxReplicas: isProd ? 3 : 1
        rules: isProd
          ? [{ name: 'http-concurrency', http: { metadata: { concurrentRequests: '50' } } }]
          : []
      }
    }
  }
  dependsOn: [acrPull, kvSecretsUser, redisApp, database]
}

// ---------- Alertas ----------
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (!empty(alertEmail)) {
  name: 'ag-ashenfall-${environmentName}'
  location: 'global'
  properties: {
    groupShortName: 'ashenfall'
    enabled: true
    emailReceivers: [{ name: 'correo', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}

var alertActions = empty(alertEmail) ? [] : [{ actionGroupId: actionGroup.id }]

resource restartsAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (deployServer) {
  name: 'alert-restarts-${environmentName}'
  location: 'global'
  properties: {
    description: 'El servidor se reinició: posible fallo al arrancar o caída.'
    severity: 1
    enabled: true
    scopes: [serverApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'reinicios'
          criterionType: 'StaticThresholdCriterion'
          metricNamespace: 'Microsoft.App/containerApps'
          metricName: 'RestartCount'
          operator: 'GreaterThan'
          threshold: 0
          timeAggregation: 'Total'
        }
      ]
    }
    actions: alertActions
  }
}

resource postgresCpuAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-postgres-cpu-${environmentName}'
  location: 'global'
  properties: {
    description: 'PostgreSQL es el primer cuello de botella medido; CPU sostenida alta anticipa degradación.'
    severity: 2
    enabled: true
    scopes: [postgres.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'cpu'
          criterionType: 'StaticThresholdCriterion'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          metricName: 'cpu_percent'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
        }
      ]
    }
    actions: alertActions
  }
}

// Application Insights no guarda percentiles de un histograma: se vigila la media sobre la meta de 200 ms.
resource latencyAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'alert-latency-${environmentName}'
  location: location
  properties: {
    description: 'Latencia media de jugada por encima de 200 ms.'
    severity: 2
    enabled: true
    scopes: [appInsights.id]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'customMetrics | where name == "ashenfall.shot.latency" | summarize avgMs = sum(valueSum) / sum(valueCount)'
          timeAggregation: 'Average'
          metricMeasureColumn: 'avgMs'
          operator: 'GreaterThan'
          threshold: 200
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: empty(alertEmail) ? [] : [actionGroup.id] }
  }
}

output identityName string = identity.name
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output keyVaultName string = keyVault.name
output postgresServerName string = postgres.name
output serverAppName string = serverAppName
output serverFqdn string = deployServer ? serverApp!.properties.configuration.ingress.fqdn : ''
