import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import log from './logger.js'
import { getMLModelLocalRootDir, getMLModelEnvironmentRootDir } from './ml/index.js'
import { getBiowatchDataPath } from './paths.js'

async function dirSize(dir) {
  let total = 0
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return 0
    log.warn(`storage-usage: cannot read ${dir}: ${err.message}`)
    return 0
  }
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          total += await dirSize(full)
        } else if (entry.isFile()) {
          const st = await fs.stat(full)
          total += st.size
        }
      } catch {
        // ignore unreadable entries
      }
    })
  )
  return total
}

export async function getStorageUsage() {
  const modelsRoot = getMLModelLocalRootDir()
  const envsRoot = getMLModelEnvironmentRootDir()
  const studiesRoot = path.join(getBiowatchDataPath(), 'studies')
  const logsRoot = app.getPath('logs')

  const [modelsBytes, envsBytes, studiesBytes, logsBytes] = await Promise.all([
    dirSize(modelsRoot),
    dirSize(envsRoot),
    dirSize(studiesRoot),
    dirSize(logsRoot)
  ])

  return {
    models: { bytes: modelsBytes + envsBytes, path: modelsRoot },
    studies: { bytes: studiesBytes, path: studiesRoot },
    logs: { bytes: logsBytes, path: logsRoot }
  }
}
