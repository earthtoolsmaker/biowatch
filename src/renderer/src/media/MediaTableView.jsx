import { Check, Play } from 'lucide-react'
import { deriveTableRow } from './tableRows.js'

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

// Table presentation of the same sequences the grid shows. Reuses deriveTableRow
// for each row and calls the shared onRowClick (Gallery's handleImageClick) to
// open the existing media modal. Only the "When" column is sortable — it maps to
// the server-side newest/oldest sort; other columns are display-only for now.
export default function MediaTableView({
  sequences,
  bboxesByMedia,
  constructImageUrl,
  isVideoMedia,
  onRowClick,
  sort,
  onSortChange
}) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b-2 border-border bg-card sticky top-0">
            <th className="py-2 px-2 w-14"></th>
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
          {sequences.map((seq) => {
            const row = deriveTableRow(seq, bboxesByMedia, isVideoMedia)
            const isMulti = seq.items.length > 1
            return (
              <tr
                key={seq.id}
                className="border-b border-border hover:bg-blue-50 dark:hover:bg-blue-500/10 cursor-pointer"
                onClick={() => onRowClick(seq.items[0], isMulti ? seq : null)}
              >
                <td className="py-1.5 px-2">
                  <div className="w-12 h-9 rounded bg-black/80 overflow-hidden flex items-center justify-center">
                    {row.isVideo ? (
                      <Play size={12} className="text-white" />
                    ) : (
                      <img
                        src={constructImageUrl(row.thumbnailMedia.filePath)}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </div>
                </td>
                <td className="py-1.5 px-2 font-medium">
                  {row.species || <span className="text-muted-foreground">—</span>}
                  {row.extraSpeciesCount > 0 && (
                    <span className="text-muted-foreground font-normal ml-1">
                      +{row.extraSpeciesCount}
                    </span>
                  )}
                  {isMulti && (
                    <span className="text-muted-foreground font-normal ml-2 text-xs">
                      {seq.items.length} frames
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-2">
                  {formatWhen(row.when) || (
                    <span className="text-muted-foreground">— missing —</span>
                  )}
                </td>
                <td className="py-1.5 px-2">
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
          })}
        </tbody>
      </table>
    </div>
  )
}
