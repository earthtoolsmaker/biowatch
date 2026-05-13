import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDeploymentsCsvApplyPlan,
  countRowsBlockedByWarnings
} from '../../../src/renderer/src/deployments/deploymentsImportPreviewModel.js'

describe('buildDeploymentsCsvApplyPlan', () => {
  test('blocks all editable changes in rows that have any warning cell', () => {
    const preview = {
      rows: [
        {
          rowState: 'normal',
          deploymentID: 'CAM_001',
          columns: {
            deploymentID: { state: 'readonly' },
            locationID: { state: 'warning', warning: 'locationID is read-only.' },
            locationName: {
              state: 'change',
              appliedValue: 'Ridge South'
            },
            latitude: {
              state: 'change',
              appliedValue: 45.5
            },
            longitude: { state: 'unchanged' }
          }
        },
        {
          rowState: 'normal',
          deploymentID: 'CAM_002',
          columns: {
            deploymentID: { state: 'readonly' },
            locationID: { state: 'readonly' },
            locationName: { state: 'unchanged' },
            latitude: {
              state: 'change',
              appliedValue: 46.25
            },
            longitude: { state: 'unchanged' }
          }
        }
      ]
    }

    assert.deepEqual(buildDeploymentsCsvApplyPlan(preview), [
      {
        deploymentID: 'CAM_002',
        fields: {
          latitude: 46.25
        }
      }
    ])
  })
})

describe('countRowsBlockedByWarnings', () => {
  test('counts normal rows with warning cells, not warning cells', () => {
    const preview = {
      rows: [
        {
          rowState: 'normal',
          columns: {
            locationID: { state: 'warning' },
            latitude: { state: 'warning' }
          }
        },
        {
          rowState: 'normal',
          columns: {
            latitude: { state: 'warning' }
          }
        },
        {
          rowState: 'skipped',
          columns: {
            deploymentID: { state: 'readonly' }
          }
        },
        {
          rowState: 'normal',
          columns: {
            latitude: { state: 'change' }
          }
        }
      ]
    }

    assert.equal(countRowsBlockedByWarnings(preview), 2)
  })
})
