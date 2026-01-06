/**
 * ML services re-exports
 *
 * Machine learning model management and classification services
 */

// Path utilities
export {
  listDirectories,
  getMLModelLocalRootDir,
  getMLModelLocalTarPathRoot,
  getMLModelLocalTarPath,
  getMLModelLocalInstallPath,
  getMLModelLocalDownloadManifest,
  getMLModelEnvironmentRootDir,
  getMLEnvironmentDownloadManifest,
  getMLModelEnvironmentLocalInstallPath,
  getMLModelEnvironmentLocalTarPathRoot,
  getMLModelEnvironmentLocalTarPath,
  parseReferenceFromPath
} from './paths.js'

// Server lifecycle
export {
  registerActiveServer,
  unregisterActiveServer,
  getActiveServers,
  findFreePort,
  startAndWaitTillServerHealty,
  startSpeciesNetHTTPServer,
  startDeepFauneHTTPServer,
  startManasHTTPServer,
  stopMLModelHTTPServer,
  startMLModelHTTPServer,
  shutdownAllServers
} from './server.js'

// Download management
export {
  listInstalledMLModels,
  listInstalledMLModelEnvironments,
  listStaleInstalledModels,
  listStaleInstalledMLModelEnvironments,
  garbageCollect,
  isMLModelDownloaded,
  getMLModelDownloadStatus,
  getGlobalModelDownloadStatus,
  clearAllLocalMLModels,
  deleteLocalMLModel,
  downloadPythonEnvironment,
  downloadMLModel
} from './download.js'

// Classification
export { selectVideoClassificationWinner } from './classification.js'
