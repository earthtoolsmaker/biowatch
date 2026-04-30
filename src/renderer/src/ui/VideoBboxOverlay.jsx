import { useEffect, useState, useCallback } from 'react'
import { getVideoBounds } from '../utils/videoBboxes.js'

/**
 * Presentational bbox overlay for a <video> element.
 *
 * Draws an absolutely-positioned SVG above the video, with one <rect> per
 * detection in currentFrameBboxes. Rectangles are positioned in normalized
 * (0-1) coordinates relative to the rendered video area (letterbox-aware).
 *
 * Does no data fetching and no time tracking — the parent owns both.
 *
 * Props:
 * - videoRef: React ref to the <video> element
 * - containerRef: React ref to the element wrapping the video (defines the overlay bounds)
 * - currentFrameBboxes: Array<{ frameNumber, bboxX, bboxY, bboxWidth, bboxHeight, conf }>
 * - visible: boolean — gate rendering (ties to the existing showBboxes toggle)
 */
export default function VideoBboxOverlay({ videoRef, containerRef, currentFrameBboxes, visible }) {
  // Rendered geometry kept in state so the component re-renders when the video
  // container resizes or metadata loads. Populated from refs inside effects only.
  const [bounds, setBounds] = useState(null)

  const recomputeBounds = useCallback(() => {
    if (!videoRef?.current || !containerRef?.current) {
      setBounds(null)
      return
    }
    setBounds(getVideoBounds(videoRef.current, containerRef.current))
  }, [videoRef, containerRef])

  // Recompute when the video reports metadata (videoWidth/videoHeight become known).
  useEffect(() => {
    const el = videoRef?.current
    if (!el) return

    if (el.videoWidth > 0 && el.videoHeight > 0) {
      recomputeBounds()
    }

    const handleLoaded = () => recomputeBounds()
    el.addEventListener('loadedmetadata', handleLoaded)
    return () => el.removeEventListener('loadedmetadata', handleLoaded)
  }, [videoRef, recomputeBounds])

  // Recompute on window resize so letterboxing math stays correct.
  useEffect(() => {
    const handleResize = () => recomputeBounds()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [recomputeBounds])

  if (!visible || !bounds || !currentFrameBboxes || currentFrameBboxes.length === 0) {
    return null
  }

  const { offsetX, offsetY, renderedWidth, renderedHeight } = bounds

  return (
    <svg
      className="pointer-events-none absolute inset-0 w-full h-full"
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
    >
      {currentFrameBboxes.map((bbox, index) => {
        const x = offsetX + bbox.bboxX * renderedWidth
        const y = offsetY + bbox.bboxY * renderedHeight
        const w = bbox.bboxWidth * renderedWidth
        const h = bbox.bboxHeight * renderedHeight
        return (
          <rect
            key={`${bbox.frameNumber}-${index}`}
            x={x}
            y={y}
            width={w}
            height={h}
            fill="transparent"
            stroke="#60a5fa"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )
      })}
    </svg>
  )
}
