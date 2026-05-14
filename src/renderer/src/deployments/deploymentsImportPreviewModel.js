// Pure helpers for the deployments CSV import preview modal.
// Kept stateless so they can be unit-tested without a DOM.

/**
 * Columns the import flow may write back to the deployments table.
 * Kept in sync with the parser-side EDITABLE_KEYS in deploymentsCsv.js.
 */
export const EDITABLE_DEPLOYMENT_IMPORT_KEYS = ['locationName', 'latitude', 'longitude']

/**
 * True if any cell on the row is in the 'warning' state. Under row-level
 * blocking semantics, a single warning cell disqualifies the entire row
 * from being applied.
 *
 * @param {object} row - preview row from `parseDeploymentsCsv`.
 * @returns {boolean}
 */
export function rowHasWarning(row) {
  return Object.values(row?.columns || {}).some((col) => col?.state === 'warning')
}

/**
 * True if the row has at least one editable cell in the 'change' state.
 * Read-only cells (deploymentID, locationID) are intentionally excluded.
 *
 * @param {object} row - preview row from `parseDeploymentsCsv`.
 * @returns {boolean}
 */
export function rowHasEditableChange(row) {
  return EDITABLE_DEPLOYMENT_IMPORT_KEYS.some((key) => row?.columns?.[key]?.state === 'change')
}

/**
 * Tailwind class name for the row background. Priority is:
 *   skipped → muted/dimmed
 *   warning → red (whole row blocked, even if it also has change cells)
 *   change  → green (clean update)
 *   else    → none
 *
 * @param {object} row - preview row from `parseDeploymentsCsv`.
 * @returns {string} space-separated Tailwind classes, or '' if no styling.
 */
export function getDeploymentsCsvImportRowClassName(row) {
  if (row?.rowState === 'skipped') {
    return 'bg-muted/40 dark:bg-muted/30 opacity-60'
  }
  if (rowHasWarning(row)) return 'bg-red-50 dark:bg-red-500/10'
  if (rowHasEditableChange(row)) return 'bg-green-50 dark:bg-green-500/10'
  return ''
}

/**
 * Build the apply plan sent to the main process. Mirrors the parser's
 * row-level semantics: rows in the 'skipped' state and rows with any
 * warning cell are excluded entirely. Only editable cells in the
 * 'change' state contribute fields.
 *
 * `plan.length` is guaranteed to equal `preview.applyCount` as produced
 * by `parseDeploymentsCsv` — keep both in sync if you change one.
 *
 * @param {object|null} preview - preview payload from `parseDeploymentsCsv`.
 * @returns {Array<{deploymentID: string, fields: object}>}
 */
export function buildDeploymentsCsvApplyPlan(preview) {
  if (!preview) return []

  const plan = []
  for (const row of preview.rows || []) {
    if (row.rowState !== 'normal') continue
    if (rowHasWarning(row)) continue

    const fields = {}
    for (const key of EDITABLE_DEPLOYMENT_IMPORT_KEYS) {
      const col = row.columns[key]
      if (col.state === 'change') {
        fields[key] = col.appliedValue
      }
    }
    if (Object.keys(fields).length > 0) {
      plan.push({ deploymentID: row.deploymentID, fields })
    }
  }
  return plan
}
