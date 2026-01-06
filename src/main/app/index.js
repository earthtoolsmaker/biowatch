/**
 * App module re-exports
 *
 * Electron app lifecycle and configuration
 */

export {
  configureLogging,
  createWindow,
  initializeMigrations,
  initializeApp,
  setupShutdownHandlers
} from './lifecycle.js'

export { registerLocalFileProtocol, registerCachedImageProtocol } from './protocols.js'

export { setupRemoteMediaCORS } from './session.js'
