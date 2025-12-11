/**
 * CamtrapDP Sanitization Helpers
 *
 * Functions to transform observation and media data to comply with the CamtrapDP 1.0 specification.
 * These sanitizers fix common issues before validation.
 */

/**
 * Ensure ISO 8601 timestamp has a timezone designator.
 * Appends 'Z' (UTC) if no timezone is present.
 *
 * @param {string|null|undefined} isoString - ISO datetime string
 * @returns {string|null} - ISO datetime with timezone or null
 */
export function ensureTimezone(isoString) {
  if (!isoString) return null

  // Already has timezone (Z or +/-HH:MM)
  if (isoString.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(isoString)) {
    return isoString
  }

  // Append Z (UTC) if no timezone
  return isoString + 'Z'
}

/**
 * Clamp bounding box dimension to valid range.
 * Per spec: min 1e-15 (tiny positive), max 1
 *
 * @param {number|null|undefined} value - Bbox width or height
 * @returns {number|null} - Clamped value or null
 */
export function clampBboxDimension(value) {
  if (value === null || value === undefined) return null
  if (value <= 0) return 1e-15 // Minimum positive value per spec
  if (value > 1) return 1
  return value
}

/**
 * Clamp bounding box coordinate to valid range (0-1).
 *
 * @param {number|null|undefined} value - Bbox X or Y coordinate
 * @returns {number|null} - Clamped value or null
 */
export function clampBboxCoordinate(value) {
  if (value === null || value === undefined) return null
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Map life stage value to CamtrapDP enum.
 * Returns null for unrecognized values.
 *
 * @param {string|null|undefined} value - Life stage from database
 * @returns {string|null} - Mapped enum value or null
 */
export function mapLifeStage(value) {
  if (!value) return null

  const lower = value.toLowerCase().trim()
  const mapping = {
    adult: 'adult',
    subadult: 'subadult',
    'sub-adult': 'subadult',
    juvenile: 'juvenile',
    young: 'juvenile',
    immature: 'juvenile',
    baby: 'juvenile',
    cub: 'juvenile',
    pup: 'juvenile',
    calf: 'juvenile',
    fawn: 'juvenile'
  }

  return mapping[lower] || null
}

/**
 * Map sex value to CamtrapDP enum.
 * Returns null for unrecognized values.
 *
 * @param {string|null|undefined} value - Sex from database
 * @returns {string|null} - Mapped enum value or null
 */
export function mapSex(value) {
  if (!value) return null

  const lower = value.toLowerCase().trim()
  const mapping = {
    female: 'female',
    f: 'female',
    male: 'male',
    m: 'male'
  }

  return mapping[lower] || null
}

/**
 * Map classification method to CamtrapDP enum.
 * Returns null for unrecognized values.
 *
 * @param {string|null|undefined} value - Classification method from database
 * @returns {string|null} - Mapped enum value or null
 */
export function mapClassificationMethod(value) {
  if (!value) return null

  const lower = value.toLowerCase().trim()
  const mapping = {
    human: 'human',
    manual: 'human',
    machine: 'machine',
    auto: 'machine',
    automatic: 'machine',
    ai: 'machine',
    ml: 'machine'
  }

  return mapping[lower] || null
}

/**
 * Sanitize count value.
 * Per spec: count must be >= 1 when present.
 * Convert 0 or negative to null.
 *
 * @param {number|null|undefined} value - Count from database
 * @returns {number|null} - Valid count or null
 */
export function sanitizeCount(value) {
  if (value === null || value === undefined) return null
  if (value < 1) return null
  return Math.floor(value) // Ensure integer
}

/**
 * Sanitize classification probability.
 * Per spec: must be 0-1 range.
 *
 * @param {number|null|undefined} value - Probability from database
 * @returns {number|null} - Clamped probability or null
 */
export function sanitizeClassificationProbability(value) {
  if (value === null || value === undefined) return null
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Sanitize a complete observation row for CamtrapDP compliance.
 *
 * @param {Object} row - Raw observation row
 * @returns {Object} - Sanitized observation row
 */
export function sanitizeObservation(row) {
  return {
    // Pass through required fields (no transformation needed)
    observationID: row.observationID,
    deploymentID: row.deploymentID,
    observationLevel: row.observationLevel,
    observationType: row.observationType,

    // Timestamps with timezone
    eventStart: ensureTimezone(row.eventStart),
    eventEnd: ensureTimezone(row.eventEnd),
    classificationTimestamp: ensureTimezone(row.classificationTimestamp),

    // Optional string fields (pass through)
    mediaID: row.mediaID || null,
    eventID: row.eventID || null,
    scientificName: row.scientificName || null,
    behavior: row.behavior || null,
    individualID: row.individualID || null,
    classifiedBy: row.classifiedBy || null,
    observationTags: row.observationTags || null,
    observationComments: row.observationComments || null,

    // Enum fields with mapping
    lifeStage: mapLifeStage(row.lifeStage),
    sex: mapSex(row.sex),
    classificationMethod: mapClassificationMethod(row.classificationMethod),
    cameraSetupType: row.cameraSetupType || null,

    // Numeric fields with sanitization
    count: sanitizeCount(row.count),
    classificationProbability: sanitizeClassificationProbability(row.classificationProbability),

    // Bounding box fields
    bboxX: clampBboxCoordinate(row.bboxX),
    bboxY: clampBboxCoordinate(row.bboxY),
    bboxWidth: clampBboxDimension(row.bboxWidth),
    bboxHeight: clampBboxDimension(row.bboxHeight),

    // Individual position fields (pass through, already optional)
    individualPositionRadius: row.individualPositionRadius ?? null,
    individualPositionAngle: row.individualPositionAngle ?? null,
    individualSpeed: row.individualSpeed ?? null
  }
}

/**
 * Sanitize a complete media row for CamtrapDP compliance.
 *
 * @param {Object} row - Raw media row
 * @returns {Object} - Sanitized media row
 */
export function sanitizeMedia(row) {
  return {
    // Required fields
    mediaID: row.mediaID,
    deploymentID: row.deploymentID,
    timestamp: ensureTimezone(row.timestamp),
    filePath: row.filePath,
    filePublic: row.filePublic,
    fileMediatype: row.fileMediatype,

    // Optional fields
    captureMethod: row.captureMethod || null,
    fileName: row.fileName || null,
    exifData: row.exifData || null,
    favorite: row.favorite ?? null,
    mediaComments: row.mediaComments || null
  }
}

/**
 * Sanitize a complete deployment row for CamtrapDP compliance.
 *
 * @param {Object} row - Raw deployment row
 * @returns {Object} - Sanitized deployment row
 */
export function sanitizeDeployment(row) {
  return {
    // Required fields
    deploymentID: row.deploymentID,
    latitude: row.latitude,
    longitude: row.longitude,
    deploymentStart: ensureTimezone(row.deploymentStart),
    deploymentEnd: ensureTimezone(row.deploymentEnd),

    // Optional fields
    locationID: row.locationID || null,
    locationName: row.locationName || null,

    // EXIF-extracted CamtrapDP fields
    cameraModel: row.cameraModel || null,
    cameraID: row.cameraID || null,
    coordinateUncertainty:
      row.coordinateUncertainty != null ? Math.round(row.coordinateUncertainty) : null
  }
}

/**
 * Map contributor role to CamtrapDP spec compliant values.
 * 'author' is not in the spec, map to 'contributor'.
 *
 * @param {string|null|undefined} role - Role from database
 * @returns {string|null} - Spec-compliant role or null
 */
export function mapContributorRole(role) {
  if (!role) return null

  // Valid spec roles
  const validRoles = [
    'contact',
    'principalInvestigator',
    'rightsHolder',
    'publisher',
    'contributor'
  ]

  if (validRoles.includes(role)) {
    return role
  }

  // Map 'author' to 'contributor' for spec compliance
  if (role === 'author') {
    return 'contributor'
  }

  return null
}

/**
 * CamtrapDP Profile URL constant
 */
export const CAMTRAP_DP_PROFILE_URL =
  'https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/camtrap-dp-profile.json'

/**
 * Sanitize a complete datapackage.json for CamtrapDP compliance.
 *
 * @param {Object} pkg - Raw datapackage object
 * @returns {Object} - Sanitized datapackage object
 */
export function sanitizeDatapackage(pkg) {
  return {
    // Ensure name is lowercase (spec requirement)
    name: pkg.name?.toLowerCase(),

    // Ensure profile is the correct CamtrapDP URL
    profile: CAMTRAP_DP_PROFILE_URL,

    // Ensure created timestamp has timezone
    created: ensureTimezone(pkg.created),

    // Sanitize contributors - map 'author' to 'contributor'
    contributors: pkg.contributors?.map((c) => ({
      title: c.title,
      email: c.email || null,
      role: mapContributorRole(c.role),
      organization: c.organization || null,
      path: c.path || null
    })) || [{ title: 'Biowatch User', role: 'contributor' }],

    // Pass through other fields
    title: pkg.title,
    description: pkg.description,
    version: pkg.version,
    licenses: pkg.licenses,
    resources: pkg.resources,

    // Only include temporal if present
    ...(pkg.temporal && { temporal: pkg.temporal })
  }
}
