import { useEffect, useState } from 'react'

// Downscale full-resolution media into tiny thumbnails ONCE, then cache the
// small result for the session. Camera-trap JPEGs are multi-megapixel; rendering
// them in a ~48px box means the browser holds a huge decoded bitmap and
// re-rasters it on every (re)mount during virtualized scroll — the dominant
// Table-view scroll cost. A pre-downscaled ~96px JPEG is cheap to composite, so
// scrolling stays smooth even as rows mount/unmount.
//
// Protocol-agnostic: loads via an <img> element (same path that already works
// for local-file:// and cached-image:// URLs), so no fetch/CORS concerns.

const THUMB_W = 112
const THUMB_H = 84
const MAX_ENTRIES = 800

const cache = new Map() // src -> { url } | { pending: Promise<string> }
const lru = []

function remember(src, url) {
  cache.set(src, { url })
  lru.push(src)
  while (lru.length > MAX_ENTRIES) {
    const old = lru.shift()
    if (old === src) continue
    const e = cache.get(old)
    if (e?.url && e.url.startsWith('blob:')) URL.revokeObjectURL(e.url)
    cache.delete(old)
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function buildThumbnail(src) {
  const supported =
    typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined'
  if (!supported) return src // graceful fallback: use the original

  const img = await loadImage(src)
  // resizeWidth/Height lets Chromium downscale during decode (bounded memory).
  const bmp = await createImageBitmap(img, {
    resizeWidth: THUMB_W,
    resizeHeight: THUMB_H,
    resizeQuality: 'medium'
  })
  const canvas = new OffscreenCanvas(THUMB_W, THUMB_H)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0, THUMB_W, THUMB_H)
  bmp.close?.()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 })
  return URL.createObjectURL(blob)
}

/**
 * Returns a small thumbnail object-URL for `src`, building+caching it on first
 * use. `enabled=false` defers the (one-time, full-res) decode — e.g. while the
 * list is actively scrolling. Returns null until ready.
 */
export function useThumbnail(src, enabled = true) {
  const [url, setUrl] = useState(() => cache.get(src)?.url ?? null)

  useEffect(() => {
    if (!src) {
      setUrl(null)
      return
    }
    const hit = cache.get(src)
    if (hit?.url) {
      setUrl(hit.url)
      return
    }
    if (!enabled) return // wait until enabled (e.g. scroll settles) to decode

    let cancelled = false
    if (hit?.pending) {
      hit.pending.then((u) => !cancelled && setUrl(u)).catch(() => {})
      return () => {
        cancelled = true
      }
    }
    const p = buildThumbnail(src)
      .then((u) => {
        remember(src, u)
        if (!cancelled) setUrl(u)
        return u
      })
      .catch(() => {
        if (!cancelled) setUrl(src) // fall back to the original on failure
        return src
      })
    cache.set(src, { pending: p })
    return () => {
      cancelled = true
    }
  }, [src, enabled])

  return url
}
