/**
 * Helpers shared between the export and import preview modals + the
 * shared DeploymentsPreviewTable. Lives in its own module so the table
 * file can stay a pure component (React Fast Refresh requirement).
 */

export function formatCellValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}
