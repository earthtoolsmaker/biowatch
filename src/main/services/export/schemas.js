/**
 * CamtrapDP Zod Schemas
 *
 * Validates observation and media data against the official TDWG CamtrapDP 1.0 specification.
 * Schema sources:
 * - https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/observations-table-schema.json
 * - https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/media-table-schema.json
 */

import { z } from 'zod'

/**
 * ISO 8601 datetime with timezone pattern
 * Accepts formats like:
 * - 2024-01-15T10:30:00Z
 * - 2024-01-15T10:30:00+02:00
 * - 2024-01-15T10:30:00.123Z
 */
const isoDateTimeWithTz = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    'Must be ISO 8601 datetime with timezone (e.g., 2024-01-15T10:30:00Z)'
  )

/**
 * Observation Level enum
 * - media: observation directly associated with a media file
 * - event: observation associated with an event (collection of media files)
 */
const observationLevelEnum = z.enum(['media', 'event'])

/**
 * Observation Type enum
 * Categories understandable from both human and AI perspectives
 */
const observationTypeEnum = z.enum([
  'animal',
  'human',
  'vehicle',
  'blank',
  'unknown',
  'unclassified'
])

/**
 * Life Stage enum
 */
const lifeStageEnum = z.enum(['adult', 'subadult', 'juvenile'])

/**
 * Sex enum
 */
const sexEnum = z.enum(['female', 'male'])

/**
 * Classification Method enum
 */
const classificationMethodEnum = z.enum(['human', 'machine'])

/**
 * Camera Setup Type enum
 */
const cameraSetupTypeEnum = z.enum(['setup', 'calibration'])

/**
 * Bounding box coordinate (0-1 range)
 */
const bboxCoordinate = z.number().min(0).max(1)

/**
 * Bounding box dimension (min 1e-15 to avoid zero, max 1)
 */
const bboxDimension = z.number().min(1e-15).max(1)

/**
 * CamtrapDP Observation Schema
 *
 * Validates a single observation row against the official spec.
 */
export const observationSchema = z.object({
  // === Required fields ===
  observationID: z.string().min(1, 'observationID is required'),
  deploymentID: z.string().min(1, 'deploymentID is required'),
  eventStart: isoDateTimeWithTz,
  eventEnd: isoDateTimeWithTz,
  observationLevel: observationLevelEnum,
  observationType: observationTypeEnum,

  // === Optional string fields ===
  mediaID: z.string().nullable().optional(),
  eventID: z.string().nullable().optional(),
  scientificName: z.string().nullable().optional(),
  behavior: z.string().nullable().optional(),
  individualID: z.string().nullable().optional(),
  classifiedBy: z.string().nullable().optional(),
  observationTags: z.string().nullable().optional(),
  observationComments: z.string().nullable().optional(),

  // === Optional enum fields ===
  cameraSetupType: cameraSetupTypeEnum.nullable().optional(),
  lifeStage: lifeStageEnum.nullable().optional(),
  sex: sexEnum.nullable().optional(),
  classificationMethod: classificationMethodEnum.nullable().optional(),

  // === Optional numeric fields with constraints ===
  count: z.number().int().min(1).nullable().optional(),

  // Bounding box fields (normalized 0-1)
  bboxX: bboxCoordinate.nullable().optional(),
  bboxY: bboxCoordinate.nullable().optional(),
  bboxWidth: bboxDimension.nullable().optional(),
  bboxHeight: bboxDimension.nullable().optional(),

  // Individual position/movement fields
  individualPositionRadius: z.number().min(0).nullable().optional(),
  individualPositionAngle: z.number().min(-90).max(90).nullable().optional(),
  individualSpeed: z.number().min(0).nullable().optional(),

  // Classification metadata
  classificationTimestamp: isoDateTimeWithTz.nullable().optional(),
  classificationProbability: z.number().min(0).max(1).nullable().optional()
})

/**
 * Schema for validating an array of observations
 */
export const observationsArraySchema = z.array(observationSchema)

// =============================================================================
// Media Schema
// =============================================================================

/**
 * Capture Method enum
 */
const captureMethodEnum = z.enum(['activityDetection', 'timeLapse'])

/**
 * File media type pattern - must be image/*, video/*, or audio/*
 */
const fileMediaTypePattern = z
  .string()
  .regex(
    /^(image|video|audio)\/.*$/,
    'Must be a valid IANA media type (image/*, video/*, or audio/*)'
  )

/**
 * CamtrapDP Media Schema
 *
 * Validates a single media row against the official spec.
 */
export const mediaSchema = z.object({
  // === Required fields ===
  mediaID: z.string().min(1, 'mediaID is required'),
  deploymentID: z.string().min(1, 'deploymentID is required'),
  timestamp: isoDateTimeWithTz,
  filePath: z.string().min(1, 'filePath is required'),
  filePublic: z.boolean(),
  fileMediatype: fileMediaTypePattern,

  // === Optional fields ===
  captureMethod: captureMethodEnum.nullable().optional(),
  fileName: z.string().nullable().optional(),
  exifData: z.string().nullable().optional(),
  favorite: z.boolean().nullable().optional(),
  mediaComments: z.string().nullable().optional()
})

/**
 * Schema for validating an array of media
 */
export const mediaArraySchema = z.array(mediaSchema)

// =============================================================================
// Deployment Schema
// =============================================================================

/**
 * Feature Type enum
 */
const featureTypeEnum = z.enum([
  'roadPaved',
  'roadDirt',
  'trailHiking',
  'trailGame',
  'roadUnderpass',
  'roadOverpass',
  'roadBridge',
  'culvert',
  'burrow',
  'nestSite',
  'carcass',
  'waterSource',
  'fruitingTree'
])

/**
 * CamtrapDP Deployment Schema
 *
 * Validates a single deployment row against the official spec.
 */
export const deploymentSchema = z.object({
  // === Required fields ===
  deploymentID: z.string().min(1, 'deploymentID is required'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  deploymentStart: isoDateTimeWithTz,
  deploymentEnd: isoDateTimeWithTz,

  // === Optional fields (what we currently export) ===
  locationID: z.string().nullable().optional(),
  locationName: z.string().nullable().optional(),

  // === Additional optional fields from spec (for future use) ===
  coordinateUncertainty: z.number().int().min(1).nullable().optional(),
  cameraID: z.string().nullable().optional(),
  cameraModel: z.string().nullable().optional(),
  cameraDelay: z.number().int().min(0).nullable().optional(),
  cameraHeight: z.number().nullable().optional(),
  cameraDepth: z.number().nullable().optional(),
  cameraTilt: z.number().int().min(-90).max(90).nullable().optional(),
  cameraHeading: z.number().int().min(0).max(360).nullable().optional(),
  detectionDistance: z.number().nullable().optional(),
  setupBy: z.string().nullable().optional(),
  featureType: featureTypeEnum.nullable().optional(),
  habitat: z.string().nullable().optional(),
  baitUse: z.boolean().nullable().optional(),
  timestampIssues: z.boolean().nullable().optional(),
  deploymentGroups: z.string().nullable().optional(),
  deploymentTags: z.string().nullable().optional(),
  deploymentComments: z.string().nullable().optional()
})

/**
 * Schema for validating an array of deployments
 */
export const deploymentsArraySchema = z.array(deploymentSchema)

// =============================================================================
// Datapackage Schema
// =============================================================================

/**
 * ISO 8601 date pattern (YYYY-MM-DD)
 */
const isoDatePattern = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO 8601 date (YYYY-MM-DD)')

/**
 * Contributor role enum (CamtrapDP spec compliant)
 * Note: 'author' is NOT in spec, use 'contributor' instead
 */
const datapackageContributorRoleEnum = z.enum([
  'contact',
  'principalInvestigator',
  'rightsHolder',
  'publisher',
  'contributor'
])

/**
 * Contributor schema for datapackage.json
 */
const datapackageContributorSchema = z.object({
  title: z.string().min(1, 'contributor title is required'),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  role: datapackageContributorRoleEnum.optional().nullable(),
  organization: z.string().optional().nullable(),
  path: z.string().url().optional().or(z.literal('')).nullable()
})

/**
 * License schema for datapackage.json
 */
const datapackageLicenseSchema = z.object({
  name: z.string().min(1, 'license name is required'),
  path: z.string().url('license path must be a valid URL'),
  title: z.string().optional(),
  scope: z.enum(['data', 'media']).optional()
})

/**
 * Temporal coverage schema
 */
const datapackageTemporalSchema = z.object({
  start: isoDatePattern,
  end: isoDatePattern
})

/**
 * Resource field schema
 */
const datapackageResourceFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1)
})

/**
 * Resource schema for datapackage.json
 */
const datapackageResourceSchema = z.object({
  name: z.enum(['deployments', 'media', 'observations']),
  path: z.string().min(1, 'resource path is required'),
  profile: z.literal('tabular-data-resource'),
  schema: z.object({
    fields: z.array(datapackageResourceFieldSchema)
  })
})

/**
 * CamtrapDP Datapackage Schema
 *
 * Validates datapackage.json against the official CamtrapDP 1.0 specification.
 * Only validates fields we currently export.
 *
 * @see https://camtrap-dp.tdwg.org/metadata/
 */
export const datapackageSchema = z.object({
  // === Required fields we export ===
  name: z.string().regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens only'),
  created: isoDateTimeWithTz,
  contributors: z
    .array(datapackageContributorSchema)
    .min(1, 'At least one contributor is required'),
  resources: z.array(datapackageResourceSchema).length(3, 'Must have exactly 3 resources'),
  profile: z.string().url('profile must be a valid URL'),

  // === Recommended fields we export ===
  title: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  licenses: z.array(datapackageLicenseSchema).optional(),
  temporal: datapackageTemporalSchema.optional()
})

// =============================================================================
// Exports
// =============================================================================

/**
 * Type inference for TypeScript users
 */
export const ObservationType = observationSchema
export const MediaType = mediaSchema
export const DeploymentType = deploymentSchema
export const DatapackageType = datapackageSchema

// Export enums for use in sanitizers
export const enums = {
  observationLevel: observationLevelEnum,
  observationType: observationTypeEnum,
  lifeStage: lifeStageEnum,
  sex: sexEnum,
  classificationMethod: classificationMethodEnum,
  cameraSetupType: cameraSetupTypeEnum,
  captureMethod: captureMethodEnum,
  featureType: featureTypeEnum,
  datapackageContributorRole: datapackageContributorRoleEnum
}
