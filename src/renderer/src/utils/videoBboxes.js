/**
 * Pure helpers for the video bbox overlay.
 */

/**
 * Filter the flat detections array to those matching a given frame number.
 *
 * @param {Array<{frameNumber: number}>|null|undefined} detections
 * @param {number} frameNumber
 * @returns {Array}
 */
export function getBboxesForFrame(detections, frameNumber) {
  if (!detections || detections.length === 0) return []
  return detections.filter((d) => d.frameNumber === frameNumber)
}

/**
 * Compute the rendered bounds of a <video> element inside a container
 * that uses object-contain letterboxing.
 *
 * Mirrors getImageBounds() in bboxCoordinates.js but reads videoWidth/videoHeight.
 *
 * @param {{videoWidth: number, videoHeight: number}|null|undefined} videoElement
 * @param {{getBoundingClientRect: () => DOMRect}|null|undefined} containerElement
 * @returns {{offsetX: number, offsetY: number, renderedWidth: number, renderedHeight: number, containerRect: DOMRect}|null}
 */
export function getVideoBounds(videoElement, containerElement) {
  if (!videoElement || !containerElement) return null

  const containerRect = containerElement.getBoundingClientRect()
  const natW = videoElement.videoWidth
  const natH = videoElement.videoHeight
  if (!natW || !natH) return null

  const containerAspect = containerRect.width / containerRect.height
  const mediaAspect = natW / natH

  let renderedWidth, renderedHeight, offsetX, offsetY

  if (mediaAspect > containerAspect) {
    renderedWidth = containerRect.width
    renderedHeight = containerRect.width / mediaAspect
    offsetX = 0
    offsetY = (containerRect.height - renderedHeight) / 2
  } else {
    renderedHeight = containerRect.height
    renderedWidth = containerRect.height * mediaAspect
    offsetX = (containerRect.width - renderedWidth) / 2
    offsetY = 0
  }

  return { offsetX, offsetY, renderedWidth, renderedHeight, containerRect }
}
