import { app } from 'electron'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import log from './logger.js'

let cache = null

function findLicensePath() {
  const candidates = [path.join(app.getAppPath(), 'LICENSE'), path.join(process.cwd(), 'LICENSE')]
  return candidates.find((p) => existsSync(p))
}

export function getLicenseText() {
  if (cache !== null) return cache

  const file = findLicensePath()
  if (!file) {
    log.warn('LICENSE not found in any candidate path')
    cache = ''
    return cache
  }

  try {
    cache = readFileSync(file, 'utf-8')
    return cache
  } catch (err) {
    log.error('Failed to read LICENSE:', err)
    cache = ''
    return cache
  }
}
