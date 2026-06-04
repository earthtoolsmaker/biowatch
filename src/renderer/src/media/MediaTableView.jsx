import { memo, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Play, ImageOff, Layers, Film, Image as ImageIcon } from 'lucide-react'
import { deriveTableRow, speciesDisplay } from './tableRows.js'

const ROW_HEIGHT = 46
// Shared column template for the header and every row so they stay aligned.
// Columns: row number · thumbnail · type · species · when · deployment.
const GRID_COLS = '48px 60px 56px minmax(0,1.4fr) 180px minmax(0,1fr)'

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

// Clickable, sortable column header.
function SortHeader({ label, col, sortCol, sortDir, onSort }) {
  const active = sortCol === col
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`px-2 flex items-center gap-1 cursor-pointer select-none text-left hover:text-foreground ${
        active ? 'text-blue-700 dark:text-blue-300' : ''
      }`}
    >
      {label}
      <span className="w-2">{active ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
    </button>
  )
}

// One virtualized row, absolutely positioned by the virtualizer. Memoized so a
// hover change only re-renders the rows whose props changed.
const TableRow = memo(function TableRow({
  seq,
  row,
  index,
  speciesLabels,
  thumbnailUrl,
  onRowClick,
  style
}) {
  const isMulti = seq.items.length > 1
  const speciesText = speciesLabels.join(', ')
  return (
    <div
      role="row"
      style={{ ...style, gridTemplateColumns: GRID_COLS }}
      className="grid items-center border-b border-border cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10"
      onClick={() => onRowClick(seq.items[0], isMulti ? seq : null)}
    >
      <div className="px-2 text-right tabular-nums text-xs text-muted-foreground">{index}</div>
      <div className="px-2">
        <RowThumb url={thumbnailUrl} isVideo={row.isVideo} />
      </div>
      <div className="px-2 text-muted-foreground">
        {row.isVideo ? (
          <Film size={15} aria-label="Video" />
        ) : isMulti ? (
          <span
            className="inline-flex items-center gap-1 text-xs"
            title={`${seq.items.length}-frame sequence`}
          >
            <Layers size={13} />
            {seq.items.length}
          </span>
        ) : (
          <ImageIcon size={15} className="opacity-50" aria-label="Photo" />
        )}
      </div>
      <Cell className="font-medium" title={speciesText || undefined}>
        {speciesLabels.length > 0 ? (
          speciesText
        ) : (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-normal">
            Blank
          </span>
        )}
      </Cell>
      <Cell>
        {formatWhen(row.when) || <span className="text-muted-foreground">— missing —</span>}
      </Cell>
      <Cell>{row.deployment || <span className="text-muted-foreground">—</span>}</Cell>
    </div>
  )
})

// Column-header row. Rendered OUTSIDE the scroll container (by the gallery) so
// the body's scrollbar doesn't run up alongside it. `gutter` is the measured
// scrollbar width; we pad the header's right by it (the body reserves the same
// space via scrollbar-gutter: stable) so the columns stay aligned.
export function MediaTableHeader({ sortCol = null, sortDir = 'asc', onSort, gutter = 0 }) {
  return (
    <div className="w-full flex-shrink-0 bg-card border-b-2 border-border text-[11px] uppercase tracking-wide text-muted-foreground">
      <div
        role="row"
        className="grid items-center h-9"
        style={{ gridTemplateColumns: GRID_COLS, paddingRight: gutter }}
      >
        <div className="px-2 text-right">#</div>
        <div className="px-2" />
        <SortHeader label="Type" col="type" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
        <SortHeader
          label="Species"
          col="species"
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={onSort}
        />
        <SortHeader label="When" col="when" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
        <SortHeader
          label="Deployment"
          col="deployment"
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={onSort}
        />
      </div>
    </div>
  )
}

// Virtualized table BODY: only the rows in (or near) the viewport are mounted,
// so scroll cost stays bounded regardless of how many sequences have loaded.
// `sequences` arrives already sorted by the gallery (so the media modal
// navigates in the same order). The header is rendered separately above the
// scroll container — see MediaTableHeader.
export default function MediaTableView({
  sequences,
  bboxesByMedia,
  constructImageUrl,
  isVideoMedia,
  onRowClick,
  scrollRef
}) {
  const sortedRows = useMemo(
    () =>
      sequences.map((seq) => {
        const row = deriveTableRow(seq, bboxesByMedia, isVideoMedia)
        return {
          seq,
          row,
          speciesLabels: (row.speciesNames || []).map(speciesDisplay).filter(Boolean),
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
    count: sortedRows.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  return (
    <div className="w-full text-[13px]">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const { seq, row, speciesLabels, thumbnailUrl } = sortedRows[v.index]
          return (
            <TableRow
              key={seq.id}
              seq={seq}
              row={row}
              index={v.index + 1}
              speciesLabels={speciesLabels}
              thumbnailUrl={thumbnailUrl}
              onRowClick={onRowClick}
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
