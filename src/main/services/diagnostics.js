/**
 * Diagnostics service
 * Collects logs and system info for troubleshooting
 */

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import archiver from 'archiver'
import log from 'electron-log'
import { listStudies } from './study.js'

/**
 * Get system information for diagnostics
 * @returns {Promise<Object>} System info object
 */
async function getSystemInfo() {
  // Get studies (IDs and names only - no sensitive data)
  let studies = []
  try {
    const allStudies = await listStudies()
    studies = allStudies.map((s) => ({
      id: s.id,
      name: s.name || 'Unnamed'
    }))
  } catch (error) {
    log.error('Failed to get studies for diagnostics:', error)
  }

  return {
    app: {
      name: app.getName(),
      version: app.getVersion()
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      osType: os.type(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem()
    },
    electron: {
      version: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    studies: studies,
    exportedAt: new Date().toISOString()
  }
}

/**
 * Export diagnostics to a zip file
 * @param {string} outputPath - Path where the zip file will be saved
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
 */
export async function exportDiagnostics(outputPath) {
  const logsDir = app.getPath('logs')
  log.info(`Exporting diagnostics to: ${outputPath}`)
  log.info(`Logs directory: ${logsDir}`)

  // Get system info before creating archive
  const systemInfo = await getSystemInfo()

  return new Promise((resolve) => {
    try {
      // Create write stream
      const output = fs.createWriteStream(outputPath)
      const archive = archiver('zip', {
        zlib: { level: 9 }
      })

      // Handle archive events
      output.on('close', () => {
        log.info(`Diagnostics exported successfully: ${archive.pointer()} bytes`)
        resolve({ success: true, filePath: outputPath })
      })

      archive.on('error', (err) => {
        log.error('Archive error:', err)
        resolve({ success: false, error: err.message })
      })

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          log.warn('Archive warning:', err)
        } else {
          log.error('Archive warning (throwing):', err)
          resolve({ success: false, error: err.message })
        }
      })

      // Pipe archive to output file
      archive.pipe(output)

      // Add system info
      archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' })

      // Add log files if directory exists
      if (fs.existsSync(logsDir)) {
        const logFiles = fs.readdirSync(logsDir)
        for (const file of logFiles) {
          const filePath = path.join(logsDir, file)
          const stat = fs.statSync(filePath)
          if (stat.isFile() && file.endsWith('.log')) {
            archive.file(filePath, { name: `logs/${file}` })
          }
        }
      } else {
        log.warn('Logs directory does not exist:', logsDir)
      }

      // Finalize archive
      archive.finalize()
    } catch (error) {
      log.error('Failed to export diagnostics:', error)
      resolve({ success: false, error: error.message })
    }
  })
}
