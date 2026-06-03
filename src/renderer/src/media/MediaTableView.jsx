import { memo, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Play, ImageOff } from 'lucide-react'
import { deriveTableRow } from './tableRows.js'

function noop() {}

const ROW_HEIGHT = 46
// Shared column template for the header and every row so they stay aligned.
const GRID_COLS = '36px 60px minmax(0,28fr) 168px minmax(0,22fr) 90px 116px'

function formatWhen(when) {
  if (!when) return null
  const d = new Date(when)
  if (Number.isNaN(d.getTime())) return when
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Small thumbnail. `url` points at a server-resized ~128px JPEG (see
// protocols.js), so it's cheap to decode/composite even as virtualized rows
// mount during scroll — no full-res decode, no scroll placeholder needed.
function RowThumb({ url, isVideo }) {
  const [failed, setFailed] = useState(false)
  const box =
    'w-12 h-9 rounded-[3px] bg-black/80 overflow-hidden flex items-center justify-center text-white/70'
  if (isVideo) {
    return (
      <div className={box}>
        <Play size={12} className="text-white" />
      </div>
    )
  }
  if (!url || failed) {
    return (
      <div className={box}>
        <ImageOff size={13} />
      </div>
    )
  }
  return (
    <div className={box}>
      <img
        src={url}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

const Cell = ({ children, className = '' }) => (
  <div className={`px-2 min-w-0 truncate ${className}`}>{children}</div>
)

// One virtualized row, absolutely positioned by the virtualizer. Memoized so a
// selection/hover change only re-renders the rows whose props changed.
const TableRow = memo(function TableRow({
  seq,
  row,
  thumbnailUrl,
  isSelected,
  onRowClick,
  onToggleSelect,
  style
}) {
  const isMulti = seq.items.length > 1
  return (
    <div
      role="row"
      style={{ ...style, gridTemplateColumns: GRID_COLS }}
      className={`grid items-center border-b border-border cursor-pointer ${
        isSelected ? 'bg-blue-50 dark:bg-blue-500/15' : 'hover:bg-blue-50 dark:hover:bg-blue-500/10'
      }`}
      onClick={(e) =>
        e.shiftKey && onToggleSelect
          ? onToggleSelect(seq.id, true)
          : onRowClick(seq.items[0], isMulti ? seq : null)
      }
    >
      <div className="px-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={(e) => (onToggleSelect || noop)(seq.id, e.shiftKey)}
          aria-label={isSelected ? 'Deselect' : 'Select'}
          className={`w-4 h-4 rounded border flex items-center justify-center ${
            isSelected ? 'bg-blue-600 border-blue-600' : 'bg-card border-border'
          }`}
        >
          {isSelected && <Check size={11} className="text-white" />}
        </button>
      </div>
      <div className="px-2">
        <RowThumb url={thumbnailUrl} isVideo={row.isVideo} />
      </div>
      <Cell className="font-medium">
        {row.species ? (
          row.species
        ) : (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-normal">
            Blank
          </span>
        )}
        {row.extraSpeciesCount > 0 && (
          <span className="text-muted-foreground font-normal ml-1">+{row.extraSpeciesCount}</span>
        )}
        {isMulti && (
          <span className="text-muted-foreground font-normal ml-2 text-xs">
            {seq.items.length} frames
          </span>
        )}
      </Cell>
      <Cell>
        {formatWhen(row.when) || <span className="text-muted-foreground">— missing —</span>}
      </Cell>
      <Cell>{row.deployment || <span className="text-muted-foreground">—</span>}</Cell>
      <Cell className="tabular-nums">
        {row.confidence != null ? (
          row.confidence.toFixed(2)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Cell>
      <Cell>
        {row.reviewed ? (
          <span className="inline-flex items-center gap-1 text-green-600 font-medium">
            <Check size={13} /> Reviewed
          </span>
        ) : (
          <span className="text-muted-foreground">— AI —</span>
        )}
      </Cell>
    </div>
  )
})

// Virtualized table view: only the rows in (or near) the viewport are mounted,
// so scroll cost stays bounded regardless of how many sequences have loaded.
// Shares the Gallery scroll container via scrollRef. Row data is derived once
// per sequences/bbox change, not on every render.
export default function MediaTableView({
  sequences,
  bboxesByMedia,
  constructImageUrl,
  isVideoMedia,
  onRowClick,
  sort,
  onSortChange,
  selection,
  onToggleSelect,
  scrollRef
}) {
  const rows = useMemo(
    () =>
      sequences.map((seq) => {
        const row = deriveTableRow(seq, bboxesByMedia, isVideoMedia)
        return {
          seq,
          row,
          // Request a small server-resized thumbnail (see protocols.js): the
          // original is multi-megapixel, far too costly to decode per row.
          thumbnailUrl: row.isVideo
            ? null
            : `${constructImageUrl(row.thumbnailMedia.filePath)}&thumb=128`
        }
      }),
    [sequences, bboxesByMedia, isVideoMedia, constructImageUrl]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  return (
    <div className="w-full text-[13px]">
      <div
        role="row"
        style={{ gridTemplateColumns: GRID_COLS }}
        className="grid items-center sticky top-0 z-10 bg-card border-b-2 border-border text-[11px] uppercase tracking-wide text-muted-foreground h-9"
      >
        <div className="px-2" />
        <div className="px-2" />
        <Cell>Species</Cell>
        <div
          className="px-2 cursor-pointer select-none text-blue-700 dark:text-blue-300"
          onClick={() => onSortChange && onSortChange(sort === 'newest' ? 'oldest' : 'newest')}
        >
          When {sort === 'oldest' ? '↑' : '↓'}
        </div>
        <Cell>Deployment</Cell>
        <Cell>Confidence</Cell>
        <Cell>Reviewed</Cell>
      </div>

      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const { seq, row, thumbnailUrl } = rows[v.index]
          return (
            <TableRow
              key={seq.id}
              seq={seq}
              row={row}
              thumbnailUrl={thumbnailUrl}
              isSelected={selection ? selection.has(seq.id) : false}
              onRowClick={onRowClick}
              onToggleSelect={onToggleSelect}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${v.size}px`,
                transform: `translateY(${v.start}px)`
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
