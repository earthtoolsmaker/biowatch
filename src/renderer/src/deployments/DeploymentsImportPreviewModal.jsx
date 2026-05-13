import { X, AlertTriangle, Ban, ArrowRight, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import DeploymentsPreviewTable from './DeploymentsPreviewTable'
import { formatCellValue } from './deploymentsPreviewHelpers'
import {
  buildDeploymentsCsvApplyPlan,
  countRowsBlockedByWarnings,
  EDITABLE_DEPLOYMENT_IMPORT_KEYS,
  getDeploymentsCsvImportRowClassName
} from './deploymentsImportPreviewModel'

const EDITABLE_KEYS = EDITABLE_DEPLOYMENT_IMPORT_KEYS

function CellContent({ col }) {
  if (col.state === 'warning') {
    return (
      <div
        title={col.warning}
        className="flex items-center gap-1 min-w-0 text-amber-700 dark:text-amber-300"
      >
        <AlertTriangle size={12} className="flex-shrink-0" />
        <span className="tabular-nums truncate min-w-0">{formatCellValue(col.dbValue)}</span>
        <span className="text-muted-foreground flex-shrink-0">·</span>
        <span className="tabular-nums line-through opacity-70 truncate min-w-0">
          {formatCellValue(col.csvValue)}
        </span>
      </div>
    )
  }
  if (col.state === 'change') {
    return (
      <div
        title={`${formatCellValue(col.dbValue)} → ${formatCellValue(col.csvValue)}`}
        className="flex items-center gap-1 min-w-0 font-medium text-green-700 dark:text-green-300"
      >
        <span className="tabular-nums line-through opacity-70 text-muted-foreground font-normal truncate min-w-0">
          {formatCellValue(col.dbValue)}
        </span>
        <ArrowRight size={12} className="flex-shrink-0" />
        <span className="tabular-nums truncate min-w-0">{formatCellValue(col.csvValue)}</span>
      </div>
    )
  }
  const display = col.csvValue !== '' ? col.csvValue : (col.dbValue ?? '—')
  return (
    <span
      title={String(display)}
      className={
        col.state === 'readonly'
          ? 'text-muted-foreground tabular-nums truncate block'
          : 'text-foreground tabular-nums truncate block'
      }
    >
      {String(display)}
    </span>
  )
}

function rowBackgroundClass(row) {
  return getDeploymentsCsvImportRowClassName(row)
}

function renderGutter(row) {
  if (row.rowState === 'skipped') {
    return (
      <div className="text-muted-foreground/70 tabular-nums text-[11px]">
        <span title={row.rowWarning} className="inline-flex items-center gap-1">
          <Ban size={12} /> {row.rowIndex}
        </span>
      </div>
    )
  }
  return <div className="text-muted-foreground/70 tabular-nums text-[11px]">{row.rowIndex}</div>
}

/**
 * Preview-table modal for the deployments CSV import flow.
 * Stateless rendering of the preview payload produced by the main process.
 * Body rows are virtualized so filter toggles stay snappy on large studies.
 */
export default function DeploymentsImportPreviewModal({
  preview,
  onCancel,
  onApply,
  isApplying = false,
  errorMessage = null
}) {
  const [filter, setFilter] = useState('all')
  const toggleFilter = (next) => setFilter((prev) => (prev === next ? 'all' : next))

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !isApplying) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, isApplying])

  const applyPlan = useMemo(() => {
    return buildDeploymentsCsvApplyPlan(preview)
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
    if (filter === 'warnings') {
      return preview.rows.filter((row) => {
        if (row.rowState !== 'normal') return false
        return Object.values(row.columns).some((c) => c?.state === 'warning')
      })
    }
    if (filter === 'skipped') {
      return preview.rows.filter((row) => row.rowState === 'skipped')
    }
    return preview.rows
  }, [preview, filter])

  // Rows (not cells) with at least one warning. Used to disable the
  // warnings-filter tile when there's nothing to show, and to label it
  // honestly: cellWarningCount is per-cell, this is per-row.
  const rowsWithWarningCount = useMemo(() => {
    return countRowsBlockedByWarnings(preview)
  }, [preview])

  if (!preview) return null

  const applyCount = applyPlan.length
  const canApply = applyCount > 0 && !isApplying

  const handleBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget && !isApplying) onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Import deployments CSV"
      onMouseDown={handleBackdropMouseDown}
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
            disabled={applyCount === 0}
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
            <ArrowLeftRight size={12} /> {applyCount} {applyCount === 1 ? 'row' : 'rows'} will
            update
          </button>
          <button
            onClick={() => toggleFilter('warnings')}
            disabled={rowsWithWarningCount === 0}
            title={
              filter === 'warnings'
                ? 'Click to show all rows'
                : 'Click to show only rows blocked by warnings'
            }
            className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors disabled:cursor-default disabled:opacity-60 ${
              filter === 'warnings'
                ? 'bg-amber-100 dark:bg-amber-500/20 border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-200'
                : 'border-transparent hover:bg-accent text-amber-700 dark:text-amber-300'
            }`}
          >
            <AlertTriangle size={12} /> {rowsWithWarningCount}{' '}
            {rowsWithWarningCount === 1 ? 'row' : 'rows'} blocked by warnings
          </button>
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
            <Ban size={12} /> {preview.rowSkipCount} {preview.rowSkipCount === 1 ? 'row' : 'rows'}{' '}
            unknown ID
          </button>
          {filter !== 'all' && (
            <button
              onClick={() => setFilter('all')}
              className="ml-1 inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded"
              title="Clear filter"
            >
              Show all
            </button>
          )}
        </div>

        {errorMessage && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/30 text-xs text-red-700 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        <DeploymentsPreviewTable
          rows={filteredRows}
          resetScrollKey={filter}
          emptyMessage="No rows match the current filter."
          getRowKey={(row) => row.rowIndex}
          rowClassName={rowBackgroundClass}
          renderGutter={renderGutter}
          renderCell={({ row, key }) => <CellContent col={row.columns[key]} />}
        />

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-green-50 dark:bg-green-500/10 border border-green-300/60 dark:border-green-500/30" />
              will update
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-amber-50 dark:bg-amber-500/5 border border-amber-300/60 dark:border-amber-500/30" />
              warning row blocked
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
