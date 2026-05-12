import { Pencil } from 'lucide-react'

const VISIBLE_COUNT = 3

/**
 * Compact byline like "By A · B · C +2 more · ✎ Manage".
 *
 * @param {Object} props
 * @param {Array<{title?: string, firstName?: string, lastName?: string, role?: string, organization?: string}>} props.contributors
 * @param {() => void} props.onManageClick - Opens the contributors modal.
 */
export default function ContributorByline({ contributors, onManageClick }) {
  const list = contributors || []

  if (list.length === 0) {
    return (
      <div className="text-[0.78rem] text-muted-foreground mt-3 pt-3 border-t border-border">
        No contributors yet
        <button
          type="button"
          onClick={onManageClick}
          className="ml-2 text-blue-600 hover:underline inline-flex items-center gap-1 text-[0.72rem] dark:text-blue-400"
          title="Add contributor"
        >
          <Pencil size={11} />
          Add
        </button>
      </div>
    )
  }

  const visible = list.slice(0, VISIBLE_COUNT)
  const overflow = list.length - visible.length

  return (
    <div className="text-[0.78rem] text-muted-foreground mt-3 pt-3 border-t border-border flex items-center gap-1.5 flex-wrap">
      <span className="text-muted-foreground">By</span>
      {visible.map((c, idx) => (
        <span key={idx} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onManageClick}
            className="text-muted-foreground hover:text-blue-600 hover:underline dark:text-blue-400"
          >
            {displayName(c)}
          </button>
          {idx < visible.length - 1 && <span className="text-muted-foreground">·</span>}
        </span>
      ))}
      {overflow > 0 && (
        <>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={onManageClick}
            className="text-muted-foreground hover:text-blue-600 hover:underline dark:text-blue-400"
          >
            +{overflow} more
          </button>
        </>
      )}
      <span className="text-muted-foreground">·</span>
      <button
        type="button"
        onClick={onManageClick}
        className="text-blue-600 hover:underline opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity inline-flex items-center gap-1 text-[0.72rem] dark:text-blue-400"
        title="Manage contributors"
      >
        <Pencil size={11} />
        Manage
      </button>
    </div>
  )
}

function displayName(c) {
  if (c.title) return c.title
  return `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed'
}
