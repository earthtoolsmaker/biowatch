import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import log from './logger.js'

const FILENAME = 'preferences.json'

export function createPreferencesStore(userDataPath) {
  const filePath = join(userDataPath, FILENAME)
  const tmpPath = join(userDataPath, FILENAME + '.tmp')

  function read() {
    if (!existsSync(filePath)) return {}
    try {
      const raw = readFileSync(filePath, 'utf8')
      return JSON.parse(raw)
    } catch (err) {
      log.warn('preferences.json unreadable, falling back to defaults', err)
      return {}
    }
  }

  function write(prefs) {
    writeFileSync(tmpPath, JSON.stringify(prefs, null, 2), 'utf8')
    renameSync(tmpPath, filePath)
  }

  return { read, write }
}
