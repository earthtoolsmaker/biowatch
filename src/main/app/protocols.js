/**
 * Custom protocol handlers for the Electron app
 *
 * Provides:
 * - local-file:// protocol for serving local media files
 * - cached-image:// protocol for caching remote images
 */

import { nativeImage, net, protocol } from 'electron'
import log from '../services/logger.js'
import { createReadStream, existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { Readable } from 'stream'
import { getCachedImage, getMimeType, saveImageToCache } from '../services/cache/image.js'

/**
 * Downscale an image buffer to a small thumbnail JPEG for the Media tab's table
 * rows. Camera-trap JPEGs are multi-megapixel; serving them at full resolution
 * into a ~48px box forces the renderer to decode/raster huge bitmaps on every
 * virtualized row mount during scroll. Resizing here (off the renderer) returns
 * a tiny image cheap to composite. Returns null on failure so the caller falls
 * back to the full image.
 */
function resizeToThumbnail(buffer, width) {
  try {
    const img = nativeImage.createFromBuffer(buffer)
    if (img.isEmpty()) return null
    const out = img.resize({ width, quality: 'good' }).toJPEG(72)
    return out && out.length ? out : null
  } catch (error) {
    log.warn(`[Thumbnail] resize failed: ${error.message}`)
    return null
  }
}

// Parse a positive ?thumb=<width> param; returns 0 when absent/invalid.
function thumbWidth(url) {
  const w = parseInt(url.searchParams.get('thumb') || '', 10)
  return Number.isFinite(w) && w > 0 ? Math.min(w, 512) : 0
}

function createWebFileStream(filePath, options = undefined) {
  return Readable.toWeb(createReadStream(filePath, options))
}

// In-memory cache of file paths known to be missing (404).
// Avoids repeated synchronous existsSync() calls for the same missing paths.
const missingPathCache = new Set()

/**
 * Register privileged custom schemes. Both are made `standard` + `secure` so
 * Chromium routes them through its HTTP cache — letting `Cache-Control` headers
 * (set on thumbnail responses) actually cache, so re-mounting a row during
 * scroll doesn't re-hit the handler / re-resize the source.
 */
export function registerPrivilegedSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'local-file',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    },
    {
      scheme: 'cached-image',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true
      }
    }
  ])
}

/**
 * Register local-file:// protocol for serving local media files.
 * Supports range requests for video streaming.
 */
export function registerLocalFileProtocol() {
  protocol.handle('local-file', (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')

    log.debug('=== local-file protocol request ===')
    log.debug('File path:', filePath)

    if (!filePath) {
      return new Response('File not found', { status: 404 })
    }

    // Fast path: skip filesystem check for known-missing files
    if (missingPathCache.has(filePath)) {
      return new Response('File not found', { status: 404 })
    }

    // Check if file exists
    if (!existsSync(filePath)) {
      log.warn('File not found (caching 404):', filePath)
      missingPathCache.add(filePath)
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

      // Thumbnail request: downscale images (never videos) before serving.
      const tW = thumbWidth(url)
      if (tW > 0 && contentType.startsWith('image/')) {
        const thumb = resizeToThumbnail(readFileSync(filePath), tW)
        if (thumb) {
          return new Response(thumb, {
            status: 200,
            headers: {
              'Content-Type': 'image/jpeg',
              'Content-Length': String(thumb.length),
              'Cache-Control': 'public, max-age=31536000, immutable'
            }
          })
        }
        // fall through to serving the full image on resize failure
      }

      // Handle Range requests for video streaming
      if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/)
        if (rangeMatch) {
          const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1
          const chunkSize = end - start + 1

          log.debug(`Range request: bytes=${start}-${end}/${fileSize}`)

          return new Response(createWebFileStream(filePath, { start, end }), {
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
      log.debug(`Full file request: ${fileSize} bytes`)

      return new Response(createWebFileStream(filePath), {
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
    const tW = thumbWidth(url)

    try {
      // Check cache first
      const cachedPath = getCachedImage(studyId, remoteUrl)

      if (cachedPath) {
        log.info(`[CachedImage] Serving from cache: ${cachedPath}`)
        const buffer = readFileSync(cachedPath)
        const thumb = tW > 0 ? resizeToThumbnail(buffer, tW) : null
        if (thumb) {
          return new Response(thumb, {
            status: 200,
            headers: {
              'Content-Type': 'image/jpeg',
              'Content-Length': String(thumb.length),
              'X-Cache': 'HIT',
              'Cache-Control': 'public, max-age=31536000, immutable'
            }
          })
        }
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

      // Background cache save (don't await) — always save the FULL image so the
      // modal/full view still has it; thumbnails are derived on demand.
      saveImageToCache(studyId, remoteUrl, buffer).catch((err) => {
        log.warn(`[CachedImage] Cache save failed: ${err.message}`)
      })

      const thumb = tW > 0 ? resizeToThumbnail(buffer, tW) : null
      if (thumb) {
        return new Response(thumb, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(thumb.length),
            'X-Cache': 'MISS',
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        })
      }

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
