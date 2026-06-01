import { X } from 'lucide-react'
import { getMapDisplayName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'

/**
 * Compact, in-control-bar readout of the selected species, shown when the
 * species rail is hidden so the legend + selection stay visible in any view.
 * Colors match the rail/map legend (palette indexed by position).
 *
 * - `compact` (narrow screens): collapses to a single count pill (a color dot
 *   + the number of selected species), no per-species removal.
 * - otherwise: up to `maxVisible` removable chips (dot + name + ×) followed by
 *   a "+N" overflow pill. Removing a chip calls `onRemove(scientificName)`;
 *   the × is disabled when only one species is left (selection can't be empty).
 *
 * Adding species is done by reopening the rail — this readout only displays
 * and removes.
 */
export default function SelectedSpeciesChips({
  selectedSpecies,
  palette,
  scientificToCommon,
  onRemove,
  compact = false,
  maxVisible = 3
}) {
  if (!selectedSpecies || selectedSpecies.length === 0) return null

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5 h-7 rounded-full border border-border bg-card px-2.5 text-sm text-foreground">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: palette[0 % palette.length] }}
        />
        <span className="tabular-nums">{selectedSpecies.length}</span>
      </div>
    )
  }

  const visible = selectedSpecies.slice(0, maxVisible)
  const overflow = selectedSpecies.length - visible.length
  const removable = selectedSpecies.length > 1

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {visible.map((species, index) => {
        const label =
          getMapDisplayName(species.scientificName, scientificToCommon) ||
          formatScientificName(species.scientificName)
        return (
          <span
            key={species.scientificName}
            className="inline-flex items-center gap-1.5 h-7 rounded-full border border-border bg-card pl-2.5 pr-1.5 text-sm text-foreground max-w-[10rem]"
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: palette[index % palette.length] }}
            />
            <span className="truncate capitalize">{label}</span>
            {removable && (
              <button
                type="button"
                onClick={() => onRemove(species.scientificName)}
                aria-label={`Remove ${label}`}
                className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </span>
        )
      })}
      {overflow > 0 && (
        <span className="inline-flex items-center h-7 rounded-full border border-border bg-card px-2.5 text-sm text-muted-foreground tabular-nums">
          +{overflow}
        </span>
      )}
    </div>
  )
}
