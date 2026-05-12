import { X, Download, Info, Pencil } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

const FIELDS = ['deploymentID', 'locationID', 'locationName', 'latitude', 'longitude']

const GRID_COLUMNS =
  'grid grid-cols-[40px_minmax(140px,1.2fr)_minmax(80px,0.9fr)_minmax(140px,1.5fr)_minmax(120px,1fr)_minmax(120px,1fr)]'

const ROW_HEIGHT = 36

const EDITABLE_KEYS = new Set(['locationName', 'latitude', 'longitude'])

function formatCellValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

/**
 * Read-only preview of the rows that will be written to the export CSV.
 * Shown before the save dialog so the user can confirm the data and
 * understand which columns are editable on a future re-import.
 */
export default function DeploymentsExportPreviewModal({
  rows,
  onCancel,
  onSave,
  isSaving = false
}) {
  const scrollRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !isSaving) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, isSaving])

  const rowVirtualizer = useVirtualizer({
    count: rows?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  if (!rows) return null

  const handleBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget && !isSaving) onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Export deployments CSV preview"
      onMouseDown={handleBackdropMouseDown}
    >
      <div className="bg-card border border-border rounded-lg shadow-2xl w-[90vw] max-w-[1100px] h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Export deployments CSV</h2>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {rows.length} {rows.length === 1 ? 'row' : 'rows'} will be written
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Explanatory banner */}
        <div className="flex items-start gap-2 px-4 py-2 border-b border-border bg-blue-50/60 dark:bg-blue-500/5 text-xs">
          <Info size={14} className="flex-shrink-0 mt-0.5 text-blue-600 dark:text-blue-300" />
          <div className="text-foreground/80 leading-relaxed">
            Edit{' '}
            <span className="font-medium text-foreground">
              latitude, longitude, and locationName
            </span>{' '}
            in a spreadsheet, then re-import the CSV. The other columns (deploymentID, locationID)
            are read-only and used to match rows. Empty cells on re-import leave the existing value
            unchanged.
          </div>
        </div>

        {/* Header row */}
        <div
          className={`${GRID_COLUMNS} gap-2 bg-muted/60 dark:bg-muted text-muted-foreground text-[10px] uppercase tracking-wider font-semibold px-3 py-2 border-b border-border flex-shrink-0 cursor-default`}
        >
          <div>#</div>
          {FIELDS.map((key) => (
            <div key={key} className="truncate flex items-center gap-1">
              <span className="truncate">{key}</span>
              {EDITABLE_KEYS.has(key) && (
                <Pencil
                  size={10}
                  className="flex-shrink-0 text-green-600 dark:text-green-400"
                  aria-label="Editable on re-import"
                />
              )}
            </div>
          ))}
        </div>

        {/* Virtualized body */}
        <div ref={scrollRef} className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No deployments to export.
            </div>
          ) : (
            <div
              style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}
            >
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const row = rows[vi.index]
                return (
                  <div
                    key={row.deploymentID ?? vi.index}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${vi.size}px`,
                      transform: `translateY(${vi.start}px)`
                    }}
                    className={`${GRID_COLUMNS} gap-2 items-center px-3 text-xs border-b border-border/60 cursor-default transition-colors hover:bg-accent/40`}
                  >
                    <div className="text-muted-foreground/70 tabular-nums text-[11px]">
                      {vi.index + 1}
                    </div>
                    {FIELDS.map((key) => (
                      <div key={key} className="min-w-0 overflow-hidden">
                        <span
                          title={formatCellValue(row[key])}
                          className={
                            EDITABLE_KEYS.has(key)
                              ? 'text-foreground tabular-nums truncate block'
                              : 'text-muted-foreground tabular-nums truncate block'
                          }
                        >
                          {formatCellValue(row[key])}
                        </span>
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
          <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Pencil size={10} className="text-green-600 dark:text-green-400" />
            <span>marks columns that are editable on re-import.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={isSaving}
              className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={isSaving || rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:hover:bg-blue-500"
            >
              <Download size={12} />
              {isSaving ? 'Saving…' : 'Save as CSV…'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
