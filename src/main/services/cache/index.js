/**
 * Cache services re-exports
 *
 * Video transcoding and image caching services
 */

// Video transcoding
export {
  needsTranscoding,
  isBrowserCompatible,
  getTranscodedPath,
  getCachedTranscode,
  getThumbnailPath,
  getCachedThumbnail,
  extractThumbnail,
  transcodeVideo,
  cancelTranscode,
  getCacheStats,
  clearCache,
  cleanExpiredTranscodeCache,
  registerTranscodeIPCHandlers
} from './video.js'

// Image caching
export {
  getImageCacheDir,
  getCacheKeyFromUrl,
  getCachedImagePath,
  getCachedImage,
  isDownloadInProgress,
  downloadAndCacheImage,
  saveImageToCache,
  getMimeType,
  getImageCacheStats,
  clearImageCache,
  cleanExpiredImageCache,
  registerImageCacheIPCHandlers
} from './image.js'

// Cleanup utilities
export {
  CACHE_MAX_AGE_MS,
  cleanExpiredTranscodeCacheImpl,
  cleanExpiredImageCacheImpl
} from './cleanup.js'
