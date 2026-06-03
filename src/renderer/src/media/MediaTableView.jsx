import { memo, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Play, ImageOff, Layers, Film, Image as ImageIcon } from 'lucide-react'
import { deriveTableRow } from './tableRows.js'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { formatScientificName } from '../utils/scientificName'

// Display label for the species column: common name (capitalized), falling back
// to the formatted scientific name. null (no species) → null (renders a pill).
function speciesDisplay(name) {
  if (!name) return null
  const label = resolveCommonName(name) || formatScientificName(name)
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : name
}

const ROW_HEIGHT = 46
// Shared column template for the header and every row so they stay aligned.
// Columns: thumbnail · type · species · when · deployment.
const GRID_COLS = '60px 56px minmax(0,1.4fr) 180px minmax(0,1fr)'

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

// Comparator for a given column over the derived rows (client-side sort of the
// loaded rows). Missing values sort to the start in ascending order.
function compareRows(a, b, col) {
  if (col === 'when') {
    const av = a.row.when ? new Date(a.row.when).getTime() : -Infinity
    const bv = b.row.when ? new Date(b.row.when).getTime() : -Infinity
    return av - bv
  }
  const av = (col === 'species' ? a.speciesLabel : a.row.deployment) || ''
  const bv = (col === 'species' ? b.speciesLabel : b.row.deployment) || ''
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
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

// Virtualized table view: only the rows in (or near) the viewport are mounted,
// so scroll cost stays bounded regardless of how many sequences have loaded.
// Column headers sort the currently-loaded rows client-side.
export default function MediaTableView({
  sequences,
  bboxesByMedia,
  constructImageUrl,
  isVideoMedia,
  onRowClick,
  scrollRef
}) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const onSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const rows = useMemo(
    () =>
      sequences.map((seq) => {
        const row = deriveTableRow(seq, bboxesByMedia, isVideoMedia)
        return {
          seq,
          row,
          // Primary label drives the sort; the full list drives the display.
          speciesLabel: speciesDisplay(row.species),
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

  const sortedRows = useMemo(() => {
    if (!sortCol) return rows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => dir * compareRows(a, b, sortCol))
  }, [rows, sortCol, sortDir])

  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  return (
    // The gallery scroll container drops its top padding in table view (see
    // Gallery.jsx), so the sticky header pins flush at the very top with no gap
    // for rows to bleed into above it.
    <div className="w-full text-[13px]">
      <div
        role="row"
        style={{ gridTemplateColumns: GRID_COLS }}
        className="grid items-center sticky top-0 z-20 bg-card border-b-2 border-border text-[11px] uppercase tracking-wide text-muted-foreground h-9"
      >
        <div className="px-2" />
        <div className="px-2">Type</div>
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

      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const { seq, row, speciesLabels, thumbnailUrl } = sortedRows[v.index]
          return (
            <TableRow
              key={seq.id}
              seq={seq}
              row={row}
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
