// El nombre del administrador es el objectId de la identidad; Bicep exige conocerlo al inicio,
// por eso va en un módulo que lo recibe como parámetro.
param serverName string
param principalId string
param principalName string
param tenantId string

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: serverName
}

resource admin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: principalId
  properties: {
    principalType: 'ServicePrincipal'
    principalName: principalName
    tenantId: tenantId
  }
}
