import { X, AlertTriangle, Ban, ArrowRight, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

const FIELDS = ['deploymentID', 'locationID', 'locationName', 'latitude', 'longitude']

const EDITABLE_KEYS = ['locationName', 'latitude', 'longitude']

// 40px gutter for row number + 5 data columns. Columns share remaining
// space with weighting that favours locationName (long strings) and
// gives lat/lon comfortable numeric widths.
const GRID_COLUMNS =
  'grid grid-cols-[40px_minmax(140px,1.2fr)_minmax(80px,0.9fr)_minmax(140px,1.5fr)_minmax(120px,1fr)_minmax(120px,1fr)]'

const ROW_HEIGHT = 32

function formatCellValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function CellContent({ col }) {
  if (col.state === 'warning') {
    return (
      <span
        title={col.warning}
        className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 truncate"
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
      <span className="inline-flex items-center gap-1 font-medium text-green-700 dark:text-green-300 truncate">
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
          ? 'text-muted-foreground italic tabular-nums truncate block'
          : 'text-foreground tabular-nums truncate block'
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
  const hasChange = EDITABLE_KEYS.some((k) => row.columns[k]?.state === 'change')
  if (hasChange) return 'bg-green-50 dark:bg-green-500/10'
  const hasWarning = EDITABLE_KEYS.some((k) => row.columns[k]?.state === 'warning')
  if (hasWarning) return 'bg-amber-50 dark:bg-amber-500/5'
  return ''
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
  const scrollRef = useRef(null)

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

  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  // Reset scroll position when the filter changes so the new view starts
  // at the top rather than wherever the previous list was scrolled to.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [filter])

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

        {/* Header row (matches body grid columns) */}
        <div
          className={`${GRID_COLUMNS} gap-2 bg-muted text-muted-foreground text-xs px-3 py-1.5 border-b border-border flex-shrink-0`}
        >
          <div>#</div>
          {FIELDS.map((key) => (
            <div key={key}>{key}</div>
          ))}
        </div>

        {/* Virtualized body */}
        <div ref={scrollRef} className="flex-1 overflow-auto">
          {filteredRows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No rows match the current filter.
            </div>
          ) : (
            <div
              style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}
            >
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const row = filteredRows[vi.index]
                return (
                  <div
                    key={row.rowIndex}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${vi.size}px`,
                      transform: `translateY(${vi.start}px)`
                    }}
                    className={`${GRID_COLUMNS} gap-2 items-center px-3 text-xs border-b border-border ${rowBackgroundClass(row)}`}
                  >
                    <div className="text-muted-foreground">
                      {row.rowState === 'skipped' ? (
                        <span title={row.rowWarning} className="inline-flex items-center gap-1">
                          <Ban size={12} /> {row.rowIndex}
                        </span>
                      ) : (
                        row.rowIndex
                      )}
                    </div>
                    {FIELDS.map((key) => (
                      <div key={key} className="min-w-0">
                        <CellContent col={row.columns[key]} />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
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
