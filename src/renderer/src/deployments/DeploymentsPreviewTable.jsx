import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

const FIELDS = ['deploymentID', 'locationID', 'locationName', 'latitude', 'longitude']

const ROW_HEIGHT = 36

const GRID_COLUMNS =
  'grid grid-cols-[40px_minmax(140px,1.2fr)_minmax(80px,0.9fr)_minmax(140px,1.5fr)_minmax(120px,1fr)_minmax(120px,1fr)]'

const HEADER_CLASS = `${GRID_COLUMNS} gap-2 bg-muted/60 dark:bg-muted text-muted-foreground text-[10px] uppercase tracking-wider font-semibold px-3 py-2 border-b border-border flex-shrink-0 cursor-default`

const ROW_BASE_CLASS = `${GRID_COLUMNS} gap-2 items-center px-3 text-xs border-b border-border/60 cursor-default transition-colors hover:bg-accent/40`

/**
 * Shared virtualized table used by the export- and import-preview modals.
 *
 * Owns the grid layout (header + 5 data columns + 40px row-number gutter),
 * the scroll container, and the TanStack virtualizer. Cell content,
 * row-level background, and header decorations are render-prop hooks so
 * each caller can layer on its own state without duplicating the shell.
 *
 * @param {Array<object>} rows - rows to render
 * @param {*} resetScrollKey - whenever this prop changes, the body scrolls
 *     back to top. Pass a filter-state key (or row identity) to keep the
 *     view anchored.
 * @param {({ row, key }) => React.ReactNode} renderCell - required.
 *     Renders the contents of a single data cell.
 * @param {(key: string) => React.ReactNode} [renderHeaderCell] - optional.
 *     Decorate a header label (e.g. add an "editable" icon). Defaults to
 *     the raw column key.
 * @param {(row: object, displayIndex: number) => React.ReactNode} [renderGutter] -
 *     optional. Customize the # column. Defaults to a muted tabular index.
 * @param {(row: object) => string} [rowClassName] - optional. Extra row
 *     classes (e.g. state-tinted backgrounds in the import modal).
 * @param {(row: object, index: number) => string|number} [getRowKey] -
 *     optional. Override the React key strategy.
 * @param {string} [emptyMessage='No rows.']
 */
export default function DeploymentsPreviewTable({
  rows,
  resetScrollKey,
  renderCell,
  renderHeaderCell,
  renderGutter,
  rowClassName,
  getRowKey,
  emptyMessage = 'No rows.'
}) {
  const scrollRef = useRef(null)

  const rowVirtualizer = useVirtualizer({
    count: rows?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [resetScrollKey])

  return (
    <>
      {/* Header row */}
      <div className={HEADER_CLASS}>
        <div>#</div>
        {FIELDS.map((key) => (
          <div key={key} className="truncate flex items-center gap-1">
            {renderHeaderCell ? renderHeaderCell(key) : key}
          </div>
        ))}
      </div>

      {/* Virtualized body */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {!rows || rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">{emptyMessage}</div>
        ) : (
          <div
            style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index]
              const extra = rowClassName ? rowClassName(row) : ''
              return (
                <div
                  key={getRowKey ? getRowKey(row, vi.index) : (row.deploymentID ?? vi.index)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${vi.size}px`,
                    transform: `translateY(${vi.start}px)`
                  }}
                  className={`${ROW_BASE_CLASS} ${extra}`}
                >
                  {renderGutter ? (
                    renderGutter(row, vi.index)
                  ) : (
                    <div className="text-muted-foreground/70 tabular-nums text-[11px]">
                      {vi.index + 1}
                    </div>
                  )}
                  {FIELDS.map((key) => (
                    <div key={key} className="min-w-0 overflow-hidden">
                      {renderCell({ row, key })}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
