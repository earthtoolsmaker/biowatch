import { Pencil } from 'lucide-react'

/**
 * One KPI tile — icon + label + number + optional sub-detail.
 *
 * Two interaction flavors, mutually exclusive:
 *   - `onEdit`  → tile is editable; shows a pencil on hover. (Span tile.)
 *   - `onClick` → tile is clickable for a view action; no pencil. (Species
 *     tile when there are threatened species to surface.)
 *
 * @param {Object} props
 * @param {React.ReactNode} props.icon - Lucide icon element (already sized 14x14).
 * @param {string} props.label - Uppercase label text.
 * @param {string} props.value - Pre-formatted number (or "—").
 * @param {string} [props.sub] - Sub-detail line (omitted if falsy).
 * @param {React.ReactNode} [props.subAccent] - Optional accent fragment for the sub line.
 * @param {() => void} [props.onEdit] - Edit action handler.
 * @param {() => void} [props.onClick] - Click action handler (no edit pencil).
 */
export default function KpiTile({ icon, label, value, sub, subAccent, onEdit, onClick }) {
  const action = onEdit || onClick
  const interactive = typeof action === 'function'
  const showPencil = typeof onEdit === 'function'
  const Tag = interactive ? 'button' : 'div'

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={interactive ? action : undefined}
      className={`group relative w-full bg-card border border-border rounded-lg px-3 py-2.5 @7xl:px-3.5 @7xl:py-3.5 text-left transition-shadow flex flex-col ${
        interactive
          ? 'cursor-pointer hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300'
          : ''
      }`}
    >
      {showPencil && (
        <Pencil
          size={11}
          className="absolute top-2 right-2 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity"
          aria-hidden="true"
        />
      )}

      <div className="flex items-center justify-center gap-1.5 mb-1 @7xl:mb-1.5 text-blue-600 dark:text-blue-400">
        {icon}
        <span className="text-[0.65rem] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
      </div>

      <div className="text-xl @7xl:text-2xl font-bold text-foreground tabular-nums leading-none text-center">
        {value}
      </div>

      {/* Anchor sub-detail to the bottom so wrapping in one tile (e.g. a long
          camera-days line) doesn't push the number row out of alignment with
          its siblings — the grid stretches all tiles to the tallest, and
          mt-auto keeps the visual baselines matching. */}
      {sub && (
        <div className="mt-auto pt-1.5 @7xl:pt-2 text-[0.7rem] text-muted-foreground text-center">
          {subAccent && (
            <span className="text-blue-700 dark:text-blue-400 font-semibold">{subAccent}</span>
          )}
          {subAccent && ' '}
          {sub}
        </div>
      )}
    </Tag>
  )
}
