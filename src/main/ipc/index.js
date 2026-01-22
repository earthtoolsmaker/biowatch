/**
 * IPC handlers registration hub
 *
 * Centralizes registration of all IPC handlers for the main process.
 */

import { ipcMain } from 'electron'
import log from 'electron-log'

import { registerSpeciesIPCHandlers } from './species.js'
import { registerDeploymentsIPCHandlers } from './deployments.js'
import { registerMediaIPCHandlers } from './media.js'
import { registerObservationsIPCHandlers } from './observations.js'
import { registerActivityIPCHandlers } from './activity.js'
import { registerStudyIPCHandlers } from './study.js'
import { registerImportIPCHandlers } from './import.js'
import { registerFilesIPCHandlers } from './files.js'
import { registerDialogIPCHandlers } from './dialog.js'
import { registerShellIPCHandlers } from './shell.js'
import { registerMLIPCHandlers } from './ml.js'
import { registerDiagnosticsIPCHandlers } from './diagnostics.js'

/**
 * Register all IPC handlers
 */
export function registerAllIPCHandlers() {
  // IPC test
  ipcMain.on('ipc:ping', () => log.info('pong'))

  // Register all domain-specific handlers
  registerSpeciesIPCHandlers()
  registerDeploymentsIPCHandlers()
  registerMediaIPCHandlers()
  registerObservationsIPCHandlers()
  registerActivityIPCHandlers()
  registerStudyIPCHandlers()
  registerImportIPCHandlers()
  registerFilesIPCHandlers()
  registerDialogIPCHandlers()
  registerShellIPCHandlers()
  registerMLIPCHandlers()
  registerDiagnosticsIPCHandlers()

  log.info('All IPC handlers registered')
}

// Re-export individual registration functions for selective use
export {
  registerSpeciesIPCHandlers,
  registerDeploymentsIPCHandlers,
  registerMediaIPCHandlers,
  registerObservationsIPCHandlers,
  registerActivityIPCHandlers,
  registerStudyIPCHandlers,
  registerImportIPCHandlers,
  registerFilesIPCHandlers,
  registerDialogIPCHandlers,
  registerShellIPCHandlers,
  registerMLIPCHandlers,
  registerDiagnosticsIPCHandlers
}
