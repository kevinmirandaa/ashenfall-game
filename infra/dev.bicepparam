using 'main.bicep'

param environmentName = 'dev'
// deployerObjectId, imageTag, deployServer y previousRevision los pasa el pipeline.
param deployerObjectId = readEnvironmentVariable('DEPLOYER_OBJECT_ID', '00000000-0000-0000-0000-000000000000')
param allowedOrigins = readEnvironmentVariable('ALLOWED_ORIGINS', '')
