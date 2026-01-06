/**
 * Bbox transformers for converting model-specific bbox formats to Camtrap DP format.
 *
 * Camtrap DP format uses:
 * - bboxX: x coordinate of top-left corner (normalized 0-1)
 * - bboxY: y coordinate of top-left corner (normalized 0-1)
 * - bboxWidth: width (normalized 0-1)
 * - bboxHeight: height (normalized 0-1)
 */

/**
 * Transform a model detection bbox to Camtrap DP format (top-left corner, normalized)
 * @param {Object} detection - Detection object from model
 * @param {string} modelType - 'speciesnet' | 'deepfaune' | 'manas'
 * @returns {{ bboxX: number, bboxY: number, bboxWidth: number, bboxHeight: number } | null}
 */
export function transformBboxToCamtrapDP(detection, modelType) {
  if (!detection) return null

  switch (modelType) {
    case 'speciesnet': {
      // SpeciesNet bbox format: [x_min, y_min, width, height] normalized (already top-left corner)
      if (!detection.bbox || !Array.isArray(detection.bbox) || detection.bbox.length < 4) {
        return null
      }
      const [xMin, yMin, width, height] = detection.bbox
      // Validate values are numbers
      if (
        typeof xMin !== 'number' ||
        typeof yMin !== 'number' ||
        typeof width !== 'number' ||
        typeof height !== 'number'
      ) {
        return null
      }
      // SpeciesNet already uses top-left corner format, pass through directly
      return {
        bboxX: xMin,
        bboxY: yMin,
        bboxWidth: width,
        bboxHeight: height
      }
    }

    case 'manas':
    case 'deepfaune': {
      // DeepFaune/Manas xywhn format: [x_center, y_center, width, height] (normalized 0-1, center format)
      if (!detection.xywhn || !Array.isArray(detection.xywhn) || detection.xywhn.length < 4) {
        return null
      }
      const [xCenter, yCenter, width, height] = detection.xywhn
      // Validate values are numbers
      if (
        typeof xCenter !== 'number' ||
        typeof yCenter !== 'number' ||
        typeof width !== 'number' ||
        typeof height !== 'number'
      ) {
        return null
      }
      // Convert from center format to top-left corner format (Camtrap DP standard)
      return {
        bboxX: xCenter - width / 2,
        bboxY: yCenter - height / 2,
        bboxWidth: width,
        bboxHeight: height
      }
    }

    default:
      console.warn(`Unknown model type for bbox transformation: ${modelType}`)
      return null
  }
}

/**
 * Detect model type from prediction object
 * @param {Object} prediction - Prediction object from ML model
 * @returns {string} Model type identifier
 */
export function detectModelType(prediction) {
  if (!prediction) return 'unknown'

  // Check model_version format to determine model type
  const version = prediction.model_version || ''

  // SpeciesNet versions typically look like "4.0.1a", "4.0.0a"
  if (version.match(/^\d+\.\d+\.\d+[a-z]?$/)) {
    return 'speciesnet'
  }

  // Manas version is "1.0" and uses xywhn format
  if (version === '1.0' && prediction.detections?.[0]?.xywhn) {
    return 'manas'
  }

  // DeepFaune versions typically look like "1.3"
  if (version.match(/^\d+\.\d+$/) && prediction.detections?.[0]?.xywhn) {
    return 'deepfaune'
  }

  // Check detection format as fallback
  if (prediction.detections?.[0]?.bbox) {
    return 'speciesnet'
  }

  if (prediction.detections?.[0]?.xywhn) {
    return 'deepfaune'
  }

  return 'unknown'
}
