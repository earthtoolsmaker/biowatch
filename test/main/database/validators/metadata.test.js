import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  contributorSchema,
  contributorsSchema,
  metadataSchema,
  metadataUpdateSchema,
  metadataCreateSchema,
  contributorRoles
} from '../../../../src/main/database/validators.js'

describe('Metadata Zod Validation', () => {
  describe('contributorSchema', () => {
    test('should accept valid contributor with all fields', () => {
      const validContributor = {
        title: 'John Doe',
        email: 'john@example.com',
        role: 'principalInvestigator',
        organization: 'Wildlife Research Institute',
        path: 'https://example.com/johndoe'
      }

      const result = contributorSchema.safeParse(validContributor)
      assert.equal(result.success, true, 'Should accept valid contributor')
      assert.deepEqual(result.data, validContributor)
    })

    test('should accept contributor with only required title field', () => {
      const minimalContributor = { title: 'Jane Smith' }

      const result = contributorSchema.safeParse(minimalContributor)
      assert.equal(result.success, true, 'Should accept minimal contributor')
      assert.equal(result.data.title, 'Jane Smith')
    })

    test('should reject contributor without title', () => {
      const noTitle = {
        email: 'test@example.com',
        role: 'contributor'
      }

      const result = contributorSchema.safeParse(noTitle)
      assert.equal(result.success, false, 'Should reject contributor without title')
    })

    test('should reject contributor with empty title', () => {
      const emptyTitle = { title: '' }

      const result = contributorSchema.safeParse(emptyTitle)
      assert.equal(result.success, false, 'Should reject empty title')
    })

    test('should accept empty string for email', () => {
      const emptyEmail = { title: 'Test User', email: '' }

      const result = contributorSchema.safeParse(emptyEmail)
      assert.equal(result.success, true, 'Should accept empty email string')
    })

    test('should reject invalid email format', () => {
      const invalidEmail = { title: 'Test User', email: 'not-an-email' }

      const result = contributorSchema.safeParse(invalidEmail)
      assert.equal(result.success, false, 'Should reject invalid email')
    })

    test('should accept all valid roles', () => {
      for (const role of contributorRoles) {
        const contributor = { title: 'Test User', role }
        const result = contributorSchema.safeParse(contributor)
        assert.equal(result.success, true, `Should accept role: ${role}`)
      }
    })

    test('should reject invalid role', () => {
      const invalidRole = { title: 'Test User', role: 'invalid-role' }

      const result = contributorSchema.safeParse(invalidRole)
      assert.equal(result.success, false, 'Should reject invalid role')
    })

    test('should accept empty string for role', () => {
      const emptyRole = { title: 'Test User', role: '' }

      const result = contributorSchema.safeParse(emptyRole)
      assert.equal(result.success, true, 'Should accept empty role string')
    })

    test('should accept empty string for path', () => {
      const emptyPath = { title: 'Test User', path: '' }

      const result = contributorSchema.safeParse(emptyPath)
      assert.equal(result.success, true, 'Should accept empty path string')
    })

    test('should reject invalid URL for path', () => {
      const invalidPath = { title: 'Test User', path: 'not-a-url' }

      const result = contributorSchema.safeParse(invalidPath)
      assert.equal(result.success, false, 'Should reject invalid URL path')
    })
  })

  describe('contributorsSchema', () => {
    test('should accept null', () => {
      const result = contributorsSchema.safeParse(null)
      assert.equal(result.success, true, 'Should accept null contributors')
      assert.equal(result.data, null)
    })

    test('should accept empty array', () => {
      const result = contributorsSchema.safeParse([])
      assert.equal(result.success, true, 'Should accept empty array')
      assert.deepEqual(result.data, [])
    })

    test('should accept array of valid contributors', () => {
      const contributors = [
        { title: 'User One', email: 'one@example.com' },
        { title: 'User Two', role: 'contributor' }
      ]

      const result = contributorsSchema.safeParse(contributors)
      assert.equal(result.success, true, 'Should accept valid contributors array')
      assert.equal(result.data.length, 2)
    })

    test('should reject array with invalid contributor', () => {
      const contributors = [
        { title: 'Valid User' },
        { email: 'missing-title@example.com' } // Missing title
      ]

      const result = contributorsSchema.safeParse(contributors)
      assert.equal(result.success, false, 'Should reject array with invalid contributor')
    })
  })

  describe('metadataSchema', () => {
    test('should accept valid metadata with all fields', () => {
      const validMetadata = {
        id: 'test-uuid-123',
        name: 'Test Study',
        title: 'My Wildlife Study',
        description: 'A study about wildlife',
        created: '2024-01-15T10:30:00.000Z',
        importerName: 'wildlife/folder',
        contributors: [{ title: 'John Doe' }],
        updatedAt: '2024-01-16T14:00:00.000Z',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        sequenceGap: 60
      }

      const result = metadataSchema.safeParse(validMetadata)
      assert.equal(result.success, true, 'Should accept valid metadata')
    })

    test('should accept metadata with null optional fields', () => {
      const minimalMetadata = {
        id: 'test-uuid-123',
        name: null,
        title: null,
        description: null,
        created: '2024-01-15T10:30:00.000Z',
        importerName: 'local/images',
        contributors: null,
        updatedAt: null,
        startDate: null,
        endDate: null,
        sequenceGap: null
      }

      const result = metadataSchema.safeParse(minimalMetadata)
      assert.equal(result.success, true, 'Should accept metadata with null fields')
    })

    test('should reject invalid date format for startDate', () => {
      const invalidStartDate = {
        id: 'test-uuid-123',
        name: 'Test',
        title: null,
        description: null,
        created: '2024-01-15T10:30:00.000Z',
        importerName: 'local/images',
        contributors: null,
        updatedAt: null,
        startDate: '2024/01/01', // Invalid format
        endDate: null
      }

      const result = metadataSchema.safeParse(invalidStartDate)
      assert.equal(result.success, false, 'Should reject invalid date format')
    })

    test('should reject invalid date format for endDate', () => {
      const invalidEndDate = {
        id: 'test-uuid-123',
        name: 'Test',
        title: null,
        description: null,
        created: '2024-01-15T10:30:00.000Z',
        importerName: 'local/images',
        contributors: null,
        updatedAt: null,
        startDate: null,
        endDate: 'December 31, 2024' // Invalid format
      }

      const result = metadataSchema.safeParse(invalidEndDate)
      assert.equal(result.success, false, 'Should reject invalid date format')
    })

    test('should reject missing required fields', () => {
      const missingId = {
        name: 'Test',
        created: '2024-01-15T10:30:00.000Z',
        importerName: 'local/images'
      }

      const result = metadataSchema.safeParse(missingId)
      assert.equal(result.success, false, 'Should reject missing id')
    })
  })

  describe('metadataUpdateSchema', () => {
    test('should accept partial updates without name', () => {
      const partialUpdate = { title: 'New Title' }

      const result = metadataUpdateSchema.safeParse(partialUpdate)
      assert.equal(result.success, true, 'Should accept partial update')
    })

    test('should accept update with name', () => {
      const validUpdate = { name: 'Study Name', title: 'New Title' }

      const result = metadataUpdateSchema.safeParse(validUpdate)
      assert.equal(result.success, true, 'Should accept update with name')
    })

    test('should accept multiple field updates', () => {
      const multiUpdate = {
        name: 'Updated Name',
        title: 'Updated Title',
        description: 'Updated description',
        startDate: '2024-06-01',
        endDate: '2024-12-31'
      }

      const result = metadataUpdateSchema.safeParse(multiUpdate)
      assert.equal(result.success, true, 'Should accept multiple updates')
    })

    test('should accept null for nullable fields', () => {
      const nullUpdate = {
        title: null,
        description: null,
        startDate: null,
        endDate: null
      }

      const result = metadataUpdateSchema.safeParse(nullUpdate)
      assert.equal(result.success, true, 'Should accept null for nullable fields')
    })

    test('should reject null for name field', () => {
      const nullName = { name: null }

      const result = metadataUpdateSchema.safeParse(nullName)
      assert.equal(result.success, false, 'Should reject null for name')
    })

    test('should reject unknown fields (strict mode)', () => {
      const unknownField = {
        title: 'Test',
        unknownField: 'should fail'
      }

      const result = metadataUpdateSchema.safeParse(unknownField)
      assert.equal(result.success, false, 'Should reject unknown fields')
    })

    test('should accept empty object', () => {
      const result = metadataUpdateSchema.safeParse({})
      assert.equal(result.success, true, 'Should accept empty update object')
    })

    test('should accept contributors update', () => {
      const contributorsUpdate = {
        contributors: [{ title: 'New Contributor', email: 'new@example.com', role: 'contributor' }]
      }

      const result = metadataUpdateSchema.safeParse(contributorsUpdate)
      assert.equal(result.success, true, 'Should accept contributors update')
    })

    test('should accept null contributors', () => {
      const nullContributors = { contributors: null }

      const result = metadataUpdateSchema.safeParse(nullContributors)
      assert.equal(result.success, true, 'Should accept null contributors')
    })

    test('should reject invalid date format in updates', () => {
      const invalidDateUpdate = { startDate: '01-15-2024' }

      const result = metadataUpdateSchema.safeParse(invalidDateUpdate)
      assert.equal(result.success, false, 'Should reject invalid date format')
    })
  })

  describe('metadataCreateSchema', () => {
    test('should accept valid create data', () => {
      const createData = {
        id: 'new-study-uuid',
        name: 'New Study',
        created: '2024-01-15T10:30:00.000Z',
        importerName: 'wildlife/folder'
      }

      const result = metadataCreateSchema.safeParse(createData)
      assert.equal(result.success, true, 'Should accept valid create data')
    })

    test('should require id and created fields', () => {
      const missingRequired = {
        name: 'Test Study',
        importerName: 'local/images'
      }

      const result = metadataCreateSchema.safeParse(missingRequired)
      assert.equal(result.success, false, 'Should require id and created')
    })

    test('should accept all optional fields as null', () => {
      const withNulls = {
        id: 'test-uuid',
        name: null,
        title: null,
        description: null,
        created: '2024-01-15T10:30:00.000Z',
        importerName: 'local/images',
        startDate: null,
        endDate: null
      }

      const result = metadataCreateSchema.safeParse(withNulls)
      assert.equal(result.success, true, 'Should accept null optional fields')
    })
  })

  describe('Date format validation', () => {
    test('should accept valid ISO date formats', () => {
      const validDates = ['2024-01-01', '2024-12-31', '1999-06-15', '2030-02-28']

      for (const date of validDates) {
        const update = { startDate: date }
        const result = metadataUpdateSchema.safeParse(update)
        assert.equal(result.success, true, `Should accept date: ${date}`)
      }
    })

    test('should reject invalid date formats', () => {
      const invalidDates = [
        '2024/01/01', // Wrong separator
        '01-15-2024', // Wrong order
        '2024-1-1', // Missing leading zeros
        '2024-13-01', // Invalid month (but regex doesn't validate this)
        '24-01-01', // 2-digit year
        '2024-01-01T00:00:00Z', // Full ISO timestamp
        'January 1, 2024' // Text format
      ]

      for (const date of invalidDates) {
        const update = { startDate: date }
        const result = metadataUpdateSchema.safeParse(update)
        // Note: The regex only checks format, not validity of month/day values
        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          assert.equal(result.success, true, `Regex allows: ${date}`)
        } else {
          assert.equal(result.success, false, `Should reject format: ${date}`)
        }
      }
    })
  })
})
