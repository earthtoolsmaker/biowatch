/**
 * Centralized logger module for main process
 * Provides electron-log in Electron context, console in tests
 */

let _log = null

export function getLogger() {
  if (_log) return _log
  try {
    _log = require('electron-log')
  } catch {
    _log = console
  }
  return _log
}

// Proxy allows: import log from './logger.js'; log.info(...)
export default new Proxy(
  {},
  {
    get(_, prop) {
      return getLogger()[prop]
    }
  }
)
