import { memo, useMemo } from 'react'
import { Check, Play } from 'lucide-react'
import { deriveTableRow } from './tableRows.js'

function noop() {}

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

// One table row, memoized so a selection/hover change only re-renders the rows
// whose props actually changed. `row` and `thumbnailUrl` come pre-derived from
// the parent's useMemo, so they keep a stable identity across unrelated renders.
const TableRow = memo(function TableRow({
  seq,
  row,
  thumbnailUrl,
  isSelected,
  onRowClick,
  onToggleSelect
}) {
  const isMulti = seq.items.length > 1
  return (
    <tr
      className={`border-b border-border cursor-pointer ${
        isSelected ? 'bg-blue-50 dark:bg-blue-500/15' : 'hover:bg-blue-50 dark:hover:bg-blue-500/10'
      }`}
      onClick={() => onRowClick(seq.items[0], isMulti ? seq : null)}
    >
      <td className="py-1.5 px-2" onClick={(e) => e.stopPropagation()}>
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
      </td>
      <td className="py-1.5 px-2">
        <div className="w-12 h-9 rounded bg-black/80 overflow-hidden flex items-center justify-center">
          {row.isVideo ? (
            <Play size={12} className="text-white" />
          ) : (
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          )}
        </div>
      </td>
      <td className="py-1.5 px-2 font-medium truncate">
        {row.species || <span className="text-muted-foreground">—</span>}
        {row.extraSpeciesCount > 0 && (
          <span className="text-muted-foreground font-normal ml-1">+{row.extraSpeciesCount}</span>
        )}
        {isMulti && (
          <span className="text-muted-foreground font-normal ml-2 text-xs">
            {seq.items.length} frames
          </span>
        )}
      </td>
      <td className="py-1.5 px-2">
        {formatWhen(row.when) || <span className="text-muted-foreground">— missing —</span>}
      </td>
      <td className="py-1.5 px-2 truncate">
        {row.deployment || <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-1.5 px-2 tabular-nums">
        {row.confidence != null ? (
          row.confidence.toFixed(2)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-1.5 px-2">
        {row.reviewed ? (
          <span className="inline-flex items-center gap-1 text-green-600 font-medium">
            <Check size={13} /> Reviewed
          </span>
        ) : (
          <span className="text-muted-foreground">— AI —</span>
        )}
      </td>
    </tr>
  )
})

// Table presentation of the same sequences the grid shows. Uses table-layout:
// fixed so appending rows during infinite scroll doesn't trigger a full-table
// column reflow (the main cause of scroll jank with a large auto-layout table).
// Row data is derived once per sequences/bbox change, not on every render.
export default function MediaTableView({
  sequences,
  bboxesByMedia,
  constructImageUrl,
  isVideoMedia,
  onRowClick,
  sort,
  onSortChange,
  selection,
  onToggleSelect
}) {
  const rows = useMemo(
    () =>
      sequences.map((seq) => {
        const row = deriveTableRow(seq, bboxesByMedia, isVideoMedia)
        return {
          seq,
          row,
          thumbnailUrl: row.isVideo ? null : constructImageUrl(row.thumbnailMedia.filePath)
        }
      }),
    [sequences, bboxesByMedia, isVideoMedia, constructImageUrl]
  )

  return (
    <div className="w-full">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <colgroup>
          <col style={{ width: '36px' }} />
          <col style={{ width: '60px' }} />
          <col style={{ width: '28%' }} />
          <col style={{ width: '160px' }} />
          <col />
          <col style={{ width: '90px' }} />
          <col style={{ width: '116px' }} />
        </colgroup>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b-2 border-border bg-card sticky top-0">
            <th className="py-2 px-2"></th>
            <th className="py-2 px-2"></th>
            <th className="py-2 px-2">Species</th>
            <th
              className="py-2 px-2 cursor-pointer select-none text-blue-700 dark:text-blue-300"
              onClick={() => onSortChange && onSortChange(sort === 'newest' ? 'oldest' : 'newest')}
            >
              When {sort === 'oldest' ? '↑' : '↓'}
            </th>
            <th className="py-2 px-2">Deployment</th>
            <th className="py-2 px-2">Confidence</th>
            <th className="py-2 px-2">Reviewed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ seq, row, thumbnailUrl }) => (
            <TableRow
              key={seq.id}
              seq={seq}
              row={row}
              thumbnailUrl={thumbnailUrl}
              isSelected={selection ? selection.has(seq.id) : false}
              onRowClick={onRowClick}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
