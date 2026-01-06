/**
 * Custom protocol handlers for the Electron app
 *
 * Provides:
 * - local-file:// protocol for serving local media files
 * - cached-image:// protocol for caching remote images
 */

import { net, protocol } from 'electron'
import log from 'electron-log'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { getCachedImage, getMimeType, saveImageToCache } from '../services/cache/image.js'

/**
 * Register local-file:// protocol for serving local media files.
 * Supports range requests for video streaming.
 */
export function registerLocalFileProtocol() {
  protocol.handle('local-file', (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')

    log.info('=== local-file protocol request ===')
    log.info('File path:', filePath)

    // Check if file exists
    if (!filePath || !existsSync(filePath)) {
      log.error('File not found:', filePath)
      return new Response('File not found', { status: 404 })
    }

    try {
      const stats = statSync(filePath)
      const fileSize = stats.size
      const rangeHeader = request.headers.get('range')

      // Determine content type
      const ext = extname(filePath).toLowerCase()
      const mimeTypes = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      }
      const contentType = mimeTypes[ext] || 'application/octet-stream'

      // Read entire file into buffer (simpler approach for now)
      const buffer = readFileSync(filePath)

      // Handle Range requests for video streaming
      if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/)
        if (rangeMatch) {
          const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1
          const chunkSize = end - start + 1

          log.info(`Range request: bytes=${start}-${end}/${fileSize}`)

          // Slice the buffer to get the requested range
          const chunk = buffer.slice(start, end + 1)

          return new Response(chunk, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes'
            }
          })
        }
      }

      // Non-range request: return full file
      log.info(`Full file request: ${fileSize} bytes`)

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes'
        }
      })
    } catch (error) {
      log.error('Error serving file:', error)
      return new Response('Error serving file', { status: 500 })
    }
  })
}

/**
 * Register cached-image:// protocol for caching remote images.
 * Checks cache first, redirects to original URL if not cached while
 * triggering a background download for future requests.
 */
export function registerCachedImageProtocol() {
  protocol.handle('cached-image', async (request) => {
    const url = new URL(request.url)
    const studyId = url.searchParams.get('studyId')
    const remoteUrl = url.searchParams.get('url')

    if (!studyId || !remoteUrl) {
      log.error('[CachedImage] Missing studyId or url parameter')
      return new Response('Missing studyId or url parameter', { status: 400 })
    }

    log.info(`[CachedImage] Request for: ${remoteUrl}`)

    try {
      // Check cache first
      const cachedPath = getCachedImage(studyId, remoteUrl)

      if (cachedPath) {
        log.info(`[CachedImage] Serving from cache: ${cachedPath}`)
        const buffer = readFileSync(cachedPath)
        return new Response(buffer, {
          status: 200,
          headers: {
            'Content-Type': getMimeType(cachedPath),
            'Content-Length': String(buffer.length),
            'X-Cache': 'HIT'
          }
        })
      }

      // Not cached - fetch the image directly (can't use redirect from custom protocols)
      log.info(`[CachedImage] Fetching remote: ${remoteUrl}`)
      const response = await net.fetch(remoteUrl)

      if (!response.ok) {
        log.error(`[CachedImage] Remote fetch failed: ${response.status}`)
        return new Response('Failed to fetch image', { status: response.status })
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg'
      const buffer = Buffer.from(await response.arrayBuffer())

      // Background cache save (don't await)
      saveImageToCache(studyId, remoteUrl, buffer).catch((err) => {
        log.warn(`[CachedImage] Cache save failed: ${err.message}`)
      })

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(buffer.length),
          'X-Cache': 'MISS'
        }
      })
    } catch (error) {
      log.error(`[CachedImage] Error handling request: ${error.message}`)
      return new Response('Error fetching image', { status: 500 })
    }
  })

  log.info('[CachedImage] Protocol handler registered')
}
