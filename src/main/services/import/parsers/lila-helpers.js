/**
 * Pure helper functions for the LILA importer.
 * Kept in a separate file so they can be unit-tested without the heavy
 * import chain (electron, network, FS) that lila.js pulls in.
 */

import { DateTime } from 'luxon'

/**
 * Transform date field from COCO format to ISO
 */
export function transformDateField(dateValue) {
  if (!dateValue) return null

  // Try ISO format first
  let date = DateTime.fromISO(dateValue)
  if (date.isValid) {
    return date.toUTC().toISO()
  }

  // Try COCO common format: "2022-12-31 09:52:50"
  date = DateTime.fromFormat(dateValue, 'yyyy-MM-dd HH:mm:ss')
  if (date.isValid) {
    return date.toUTC().toISO()
  }

  return null
}

/**
 * Get MIME type from file name. Mirrors the extensionToMediatype map in
 * src/main/services/import/importer.js so LILA imports that contain video
 * files (e.g. .avi in Seattle(ish) Camera Traps) don't end up stamped as
 * image/jpeg.
 */
export function getMediaTypeFromFileName(fileName) {
  if (!fileName) return 'image/jpeg'

  const ext = fileName.toLowerCase().split('.').pop()
  const mimeTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    m4v: 'video/x-m4v'
  }

  return mimeTypes[ext] || 'image/jpeg'
}

/**
 * Transform COCO image rows to Biowatch media rows.
 * Stamps every row with importFolder = dataset.name so the Sources tab
 * can group by importFolder regardless of source type.
 *
 * @param {Array} images - COCO image rows
 * @param {Object} dataset - LILA dataset config (must have `name` and `imageBaseUrl`)
 * @returns {Array}
 */
export function transformCOCOToMedia(images, dataset) {
  return images.map((img) => ({
    mediaID: String(img.id),
    deploymentID: img.location ? String(img.location) : null,
    timestamp: transformDateField(img.datetime),
    filePath: `${dataset.imageBaseUrl}${img.file_name}`,
    fileName: img.file_name,
    fileMediatype: getMediaTypeFromFileName(img.file_name),
    exifData: null,
    favorite: false,
    importFolder: dataset.name
  }))
}
