import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Custom hook for prefetching neighboring images in a navigable collection.
 * Maintains an LRU cache of loaded images to enable instant navigation.
 *
 * @param {Object} options
 * @param {Function} options.constructImageUrl - URL constructor function
 * @param {Function} options.isVideoMedia - Video detection function
 * @param {number} options.prefetchRadius - Number of images to prefetch in each direction (default: 2)
 */
export function useImagePrefetch({ constructImageUrl, isVideoMedia, prefetchRadius = 2 } = {}) {
  // Map of mediaID -> { loaded: boolean, error: boolean }
  const [loadState, setLoadState] = useState(new Map())

  // Cache of Image instances (for cleanup)
  const imageCache = useRef(new Map()) // mediaID -> Image

  // Check if a specific image is ready
  const isImageReady = useCallback(
    (mediaID) => {
      const state = loadState.get(mediaID)
      return state?.loaded === true
    },
    [loadState]
  )

  // Prefetch a single image
  const prefetchImage = useCallback(
    (media) => {
      if (!media || isVideoMedia(media)) return

      const { mediaID, filePath } = media

      // Already cached or loading
      if (imageCache.current.has(mediaID)) return

      const img = new Image()
      imageCache.current.set(mediaID, img)

      img.onload = () => {
        setLoadState((prev) => new Map(prev).set(mediaID, { loaded: true, error: false }))
      }

      img.onerror = () => {
        setLoadState((prev) => new Map(prev).set(mediaID, { loaded: false, error: true }))
      }

      img.src = constructImageUrl(filePath)
    },
    [constructImageUrl, isVideoMedia]
  )

  // Prefetch neighbors around current position
  const prefetchNeighbors = useCallback(
    (allItems, currentIndex) => {
      if (!allItems?.length || currentIndex < 0) return

      const start = Math.max(0, currentIndex - prefetchRadius)
      const end = Math.min(allItems.length - 1, currentIndex + prefetchRadius)

      // Collect media items to prefetch
      const toPrefetch = []
      for (let i = start; i <= end; i++) {
        const item = allItems[i]
        if (item?.items) {
          // Sequence - prefetch all items in sequence
          item.items.forEach((m) => toPrefetch.push(m))
        } else {
          toPrefetch.push(item)
        }
      }

      // Prefetch each
      toPrefetch.forEach(prefetchImage)

      // Cleanup: remove items outside window from cache
      const validMediaIds = new Set(toPrefetch.map((m) => m.mediaID))
      imageCache.current.forEach((img, mediaID) => {
        if (!validMediaIds.has(mediaID)) {
          img.src = '' // Cancel loading
          imageCache.current.delete(mediaID)
          setLoadState((prev) => {
            const next = new Map(prev)
            next.delete(mediaID)
            return next
          })
        }
      })
    },
    [prefetchImage, prefetchRadius]
  )

  // Mark an image as loaded (called from img onLoad in component)
  const markLoaded = useCallback((mediaID) => {
    setLoadState((prev) => new Map(prev).set(mediaID, { loaded: true, error: false }))
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    const cache = imageCache.current
    return () => {
      cache.forEach((img) => {
        img.src = ''
      })
      cache.clear()
    }
  }, [])

  return {
    isImageReady,
    prefetchNeighbors,
    markLoaded,
    loadState
  }
}
