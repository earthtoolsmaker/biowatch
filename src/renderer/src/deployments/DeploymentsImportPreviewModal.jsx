import { X, AlertTriangle, Ban, ArrowRight, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'

const FIELD_LABELS = {
  deploymentID: 'deploymentID',
  locationID: 'locationID',
  locationName: 'locationName',
  latitude: 'latitude',
  longitude: 'longitude'
}

const EDITABLE_KEYS = ['locationName', 'latitude', 'longitude']

function formatCellValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function CellContent({ col }) {
  if (col.state === 'warning') {
    // Cell was rejected; DB value stays, CSV value shown crossed-out so user
    // sees what they tried to set and what will be kept.
    return (
      <span
        title={col.warning}
        className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"
      >
        <AlertTriangle size={12} className="flex-shrink-0" />
        <span className="tabular-nums">{formatCellValue(col.dbValue)}</span>
        <span className="text-muted-foreground">·</span>
        <span className="tabular-nums line-through opacity-70">
          {formatCellValue(col.csvValue)}
        </span>
      </span>
    )
  }
  if (col.state === 'change') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-green-700 dark:text-green-300">
        <span className="tabular-nums line-through opacity-70 text-muted-foreground font-normal">
          {formatCellValue(col.dbValue)}
        </span>
        <ArrowRight size={12} className="flex-shrink-0" />
        <span className="tabular-nums">{formatCellValue(col.csvValue)}</span>
      </span>
    )
  }
  const display = col.csvValue !== '' ? col.csvValue : (col.dbValue ?? '—')
  return (
    <span
      className={
        col.state === 'readonly'
          ? 'text-muted-foreground italic tabular-nums'
          : 'text-foreground tabular-nums'
      }
    >
      {String(display)}
    </span>
  )
}

function rowBackgroundClass(row) {
  if (row.rowState === 'skipped') {
    return 'bg-muted/40 dark:bg-muted/30 opacity-60'
  }
  const editableKeys = ['locationName', 'latitude', 'longitude']
  const hasChange = editableKeys.some((k) => row.columns[k]?.state === 'change')
  if (hasChange) {
    return 'bg-green-50 dark:bg-green-500/10'
  }
  const hasWarning = editableKeys.some((k) => row.columns[k]?.state === 'warning')
  if (hasWarning) {
    return 'bg-amber-50 dark:bg-amber-500/5'
  }
  return ''
}

/**
 * Preview-table modal for the deployments CSV import flow.
 * Stateless rendering of the preview payload produced by the main process.
 */
export default function DeploymentsImportPreviewModal({
  preview,
  onCancel,
  onApply,
  isApplying = false,
  errorMessage = null
}) {
  // Row filter — 'all' (default) | 'updated' | 'skipped'. The summary tiles
  // act as toggles: click an active filter to clear it. Wrapped in
  // useTransition so the button click stays responsive even when the
  // resulting re-render touches thousands of table rows.
  const [filter, setFilter] = useState('all')
  const [isFilterPending, startFilterTransition] = useTransition()

  const applyFilter = (next) => startFilterTransition(() => setFilter(next))
  const toggleFilter = (next) =>
    startFilterTransition(() => setFilter((prev) => (prev === next ? 'all' : next)))

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !isApplying) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, isApplying])

  const applyPlan = useMemo(() => {
    if (!preview) return []
    const plan = []
    for (const row of preview.rows) {
      if (row.rowState !== 'normal') continue
      const fields = {}
      for (const key of EDITABLE_KEYS) {
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
  }, [preview])

  const filteredRows = useMemo(() => {
    if (!preview) return []
    if (filter === 'all') return preview.rows
    if (filter === 'updated') {
      return preview.rows.filter((row) => {
        if (row.rowState !== 'normal') return false
        return EDITABLE_KEYS.some((k) => row.columns[k]?.state === 'change')
      })
    }
    if (filter === 'skipped') {
      return preview.rows.filter((row) => row.rowState === 'skipped')
    }
    return preview.rows
  }, [preview, filter])

  if (!preview) return null

  const canApply = preview.applyCount > 0 && !isApplying

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Import deployments CSV"
    >
      <div className="bg-card border border-border rounded-lg shadow-2xl w-[90vw] max-w-[1100px] h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Import deployments CSV</h2>
            <div className="text-[11px] text-muted-foreground mt-0.5">{preview.fileName}</div>
          </div>
          <button
            onClick={onCancel}
            disabled={isApplying}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Summary banner — tiles are filter toggles */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border text-xs">
          <button
            onClick={() => toggleFilter('updated')}
            disabled={preview.applyCount === 0}
            title={
              filter === 'updated'
                ? 'Click to show all rows'
                : 'Click to show only rows that will update'
            }
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors disabled:cursor-default disabled:opacity-60 ${
              filter === 'updated'
                ? 'bg-green-100 dark:bg-green-500/20 border-green-300 dark:border-green-500/40 text-green-800 dark:text-green-200'
                : 'border-transparent hover:bg-accent text-green-700 dark:text-green-300'
            }`}
          >
            <ArrowLeftRight size={12} /> {preview.applyCount} rows will update
          </button>
          <span className="inline-flex items-center gap-1 px-2 py-1 text-amber-700 dark:text-amber-300">
            <AlertTriangle size={12} /> {preview.cellWarningCount} cells skipped
          </span>
          <button
            onClick={() => toggleFilter('skipped')}
            disabled={preview.rowSkipCount === 0}
            title={
              filter === 'skipped'
                ? 'Click to show all rows'
                : 'Click to show only rows that will be skipped'
            }
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors disabled:cursor-default disabled:opacity-60 ${
              filter === 'skipped'
                ? 'bg-muted border-border text-foreground'
                : 'border-transparent hover:bg-accent text-muted-foreground'
            }`}
          >
            <Ban size={12} /> {preview.rowSkipCount} rows unknown ID
          </button>
          {filter !== 'all' && (
            <button
              onClick={() => applyFilter('all')}
              className="ml-1 inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded"
              title="Clear filter"
            >
              Show all
            </button>
          )}
          {isFilterPending && (
            <span className="ml-1 text-[11px] text-muted-foreground animate-pulse">
              Filtering…
            </span>
          )}
        </div>

        {errorMessage && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/30 text-xs text-red-700 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left w-10">#</th>
                {Object.keys(FIELD_LABELS).map((key) => (
                  <th key={key} className="px-2 py-1.5 text-left">
                    {FIELD_LABELS[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td
                    colSpan={Object.keys(FIELD_LABELS).length + 1}
                    className="px-2 py-6 text-center text-muted-foreground"
                  >
                    No rows match the current filter.
                  </td>
                </tr>
              )}
              {filteredRows.map((row) => (
                <tr
                  key={row.rowIndex}
                  className={`border-t border-border ${rowBackgroundClass(row)}`}
                >
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {row.rowState === 'skipped' ? (
                      <span title={row.rowWarning} className="inline-flex items-center gap-1">
                        <Ban size={12} /> {row.rowIndex}
                      </span>
                    ) : (
                      row.rowIndex
                    )}
                  </td>
                  {Object.keys(FIELD_LABELS).map((key) => (
                    <td key={key} className="px-2 py-1.5">
                      <CellContent col={row.columns[key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-green-50 dark:bg-green-500/10 border border-green-300/60 dark:border-green-500/30" />
              will update
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-amber-50 dark:bg-amber-500/5 border border-amber-300/60 dark:border-amber-500/30" />
              cell warning
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-muted/40 dark:bg-muted/30 border border-border" />
              skipped
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={isApplying}
              className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(applyPlan)}
              disabled={!canApply}
              className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:hover:bg-blue-500"
            >
              {isApplying ? 'Applying…' : `Apply (${preview.applyCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
