export const EDITABLE_DEPLOYMENT_IMPORT_KEYS = ['locationName', 'latitude', 'longitude']

export function rowHasWarning(row) {
  return Object.values(row?.columns || {}).some((col) => col?.state === 'warning')
}

export function rowHasEditableChange(row) {
  return EDITABLE_DEPLOYMENT_IMPORT_KEYS.some((key) => row?.columns?.[key]?.state === 'change')
}

export function getDeploymentsCsvImportRowClassName(row) {
  if (row?.rowState === 'skipped') {
    return 'bg-muted/40 dark:bg-muted/30 opacity-60'
  }
  if (rowHasWarning(row)) return 'bg-red-50 dark:bg-red-500/10'
  if (rowHasEditableChange(row)) return 'bg-green-50 dark:bg-green-500/10'
  return ''
}

export function countRowsBlockedByWarnings(preview) {
  if (!preview) return 0
  let count = 0
  for (const row of preview.rows || []) {
    if (row.rowState !== 'normal') continue
    if (rowHasWarning(row)) count++
  }
  return count
}

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
