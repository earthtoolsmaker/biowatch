import { z } from 'zod'

// Camtrap DP contributor roles (spec-compliant)
export const contributorRoles = /** @type {const} */ ([
  'contact',
  'principalInvestigator',
  'rightsHolder',
  'publisher',
  'contributor'
])

// Camtrap DP contributor schema
export const contributorSchema = z.object({
  title: z.string().min(1), // Required: person/org name
  email: z.string().email().optional().or(z.literal('')),
  role: z.enum(contributorRoles).optional().or(z.literal('')),
  organization: z.string().optional(),
  path: z.string().url().optional().or(z.literal('')) // URL to contributor info
})

// Contributors array (nullable for when no contributors exist)
export const contributorsSchema = z.array(contributorSchema).nullable()

// Importer types
export const importerNames = /** @type {const} */ ([
  'camtrap/datapackage',
  'wildlife/folder',
  'deepfaune/csv',
  'local/images',
  'local/ml_run',
  'gbif/dataset'
])

// ISO date pattern (YYYY-MM-DD)
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

// Full metadata schema matching the database table
export const metadataSchema = z.object({
  id: z.string(), // Study UUID
  name: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  created: z.string(), // ISO 8601 datetime
  importerName: z.enum(importerNames),
  contributors: contributorsSchema,
  updatedAt: z.string().nullable(),
  startDate: z.string().regex(isoDatePattern, 'Must be ISO date format (YYYY-MM-DD)').nullable(),
  endDate: z.string().regex(isoDatePattern, 'Must be ISO date format (YYYY-MM-DD)').nullable()
})

// Schema for updating metadata (all fields optional except what's being updated)
export const metadataUpdateSchema = z
  .object({
    name: z.string().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    contributors: contributorsSchema.optional(),
    startDate: z
      .string()
      .regex(isoDatePattern, 'Must be ISO date format (YYYY-MM-DD)')
      .nullable()
      .optional(),
    endDate: z
      .string()
      .regex(isoDatePattern, 'Must be ISO date format (YYYY-MM-DD)')
      .nullable()
      .optional()
  })
  .strict()

// Schema for creating new metadata
export const metadataCreateSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  created: z.string(),
  importerName: z.enum(importerNames),
  contributors: contributorsSchema.optional(),
  startDate: z
    .string()
    .regex(isoDatePattern, 'Must be ISO date format (YYYY-MM-DD)')
    .nullable()
    .optional(),
  endDate: z
    .string()
    .regex(isoDatePattern, 'Must be ISO date format (YYYY-MM-DD)')
    .nullable()
    .optional()
})

// ============================================================================
// Model Run Options Schema
// ============================================================================

// Model run options schema (for geofencing configuration)
export const modelRunOptionsSchema = z
  .object({
    country: z.string().length(3).optional() // ISO 3166-1 alpha-3 code (e.g., "FRA", "USA")
  })
  .strict()
  .nullable()

// ============================================================================
// Raw Output Schemas (Permissive - ML model outputs vary)
// ============================================================================

// ---------- Permissive Raw Output Schema ----------

// Single image prediction schema that validates core fields only
// Uses passthrough to allow model-specific extra fields
const imagePredictionSchema = z
  .object({
    filepath: z.string(),
    prediction: z.string(),
    model_version: z.string(),
    // Optional fields - use z.any() for maximum permissiveness (Zod v4 compatible)
    classifications: z.any().optional(), // Any object structure (including empty {})
    detections: z.any().optional(), // Any detection array structure
    prediction_score: z.number().min(0).max(1).optional(),
    prediction_source: z.string().optional()
  })
  .passthrough() // Allow any extra fields from ML models

// Video frame prediction schema (includes frame_number and metadata)
const videoFramePredictionSchema = z
  .object({
    filepath: z.string(),
    prediction: z.string(),
    model_version: z.string(),
    frame_number: z.number().int().min(0),
    metadata: z
      .object({
        fps: z.number(),
        duration: z.number()
      })
      .passthrough()
      .optional(),
    // Optional fields
    classifications: z.any().optional(),
    detections: z.any().optional(),
    prediction_score: z.number().min(0).max(1).optional(),
    prediction_source: z.string().optional()
  })
  .passthrough()

// Video raw output schema (array of frame predictions wrapped in 'frames' key)
const videoRawOutputSchema = z.object({
  frames: z.array(videoFramePredictionSchema)
})

// Combined schema: either image prediction or video output
export const rawOutputSchema = z.union([imagePredictionSchema, videoRawOutputSchema]).nullable()

// ---------- Strict Schemas (for documentation/type inference) ----------

// SpeciesNet detection (bbox format: [x_min, y_min, width, height] normalized 0-1)
const speciesnetDetectionSchema = z.object({
  category: z.string(),
  label: z.string(),
  conf: z.number().min(0).max(1),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()])
})

// DeepFaune/Manas detection (xywhn center format + xyxy absolute coords)
const deepfauneDetectionSchema = z.object({
  class: z.number().int(),
  label: z.string(),
  conf: z.number().min(0).max(1),
  xywhn: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  xyxy: z.tuple([z.number(), z.number(), z.number(), z.number()])
})

// SpeciesNet classifications (hierarchical "uuid;class;order;family;genus;species;common name")
const speciesnetClassificationsSchema = z.object({
  classes: z.array(z.string()),
  scores: z.array(z.number())
})

// DeepFaune/Manas classifications (simple labels like "chamois", "marmot")
const deepfauneClassificationsSchema = z.object({
  labels: z.array(z.string()),
  scores: z.array(z.number())
})

// SpeciesNet raw output schema (strict - for type inference)
export const speciesnetRawOutputSchema = z.object({
  filepath: z.string(),
  classifications: speciesnetClassificationsSchema.optional(),
  detections: z.array(speciesnetDetectionSchema).optional().default([]),
  prediction: z.string(),
  prediction_score: z.number().min(0).max(1).optional(),
  prediction_source: z.string().optional(),
  model_version: z.string()
})

// DeepFaune raw output schema (strict - for type inference)
export const deepfauneRawOutputSchema = z.object({
  filepath: z.string(),
  classifications: deepfauneClassificationsSchema.optional(),
  detections: z.array(deepfauneDetectionSchema).optional().default([]),
  prediction: z.string(),
  prediction_score: z.number().min(0).max(1).optional(),
  model_version: z.string()
})

// Manas uses same structure as DeepFaune
export const manasRawOutputSchema = deepfauneRawOutputSchema

// ============================================================================
// JSDoc Type Exports (for IDE support)
// ============================================================================

/**
 * @typedef {import('zod').infer<typeof modelRunOptionsSchema>} ModelRunOptionsType
 * @typedef {import('zod').infer<typeof speciesnetRawOutputSchema>} SpeciesnetRawOutputType
 * @typedef {import('zod').infer<typeof deepfauneRawOutputSchema>} DeepfauneRawOutputType
 * @typedef {import('zod').infer<typeof rawOutputSchema>} RawOutputType
 */
