import { z } from 'zod'

// Camtrap DP contributor roles
export const contributorRoles = [
  'contact',
  'principalInvestigator',
  'rightsHolder',
  'publisher',
  'contributor',
  'author'
]

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
export const importerNames = [
  'camtrap/datapackage',
  'wildlife/folder',
  'deepfaune/csv',
  'local/images',
  'local/speciesnet',
  'gbif/dataset'
]

// ISO date pattern (YYYY-MM-DD)
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

// Full metadata schema matching the database table
export const metadataSchema = z.object({
  id: z.string(), // Study UUID
  name: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  created: z.string(), // ISO 8601 datetime
  importerName: z.string(),
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
  importerName: z.string(),
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
