import { useEffect } from 'react'
import ObservationRow from './ObservationRow'
import AddObservationMenu from './AddObservationMenu'
import { getMediaMode } from '../utils/mediaMode'

/**
 * Persistent right-side rail listing every observation on the current media.
 *
 * Props:
 *  - observations: array of observation records (bbox or whole-image)
 *  - studyId: string
 *  - selectedObservationId: string | null
 *  - onSelectObservation: (id: string | null) → void
 *  - onUpdateClassification: (id, updates) → void
 *  - onDeleteObservation: (id) → void
 *  - onDrawRectangle: () → void
 *  - onAddWholeImage: () → void
 */
export default function ObservationRail({
  observations = [],
  studyId,
  selectedObservationId,
  onSelectObservation,
  onUpdateClassification,
  onDeleteObservation,
  onDrawRectangle,
  onAddWholeImage
}) {
  const mode = getMediaMode(observations)

  // Auto-select only for whole-image observations (single row, no other to choose).
  // For bbox mode, leave selection empty so keyboard navigation (← / →) isn't
  // hijacked by the species picker input.
  useEffect(() => {
    if (!selectedObservationId && mode === 'whole-image' && observations.length > 0) {
      onSelectObservation(observations[0].observationID)
    }
  }, [selectedObservationId, observations, mode, onSelectObservation])

  return (
    <aside
      className="w-[300px] flex-shrink-0 bg-white border-l border-gray-200 flex flex-col h-full"
      aria-label="Observations"
    >
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 flex-shrink-0">
        <span className="text-sm font-semibold text-[#030213]">Observations</span>
        <span className="text-xs text-gray-500 font-medium">{observations.length}</span>
      </header>

      {mode === 'empty' ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 pt-16 pb-12 text-center gap-5">
          <div className="text-sm text-gray-500 leading-relaxed">
            <strong className="text-[#030213] block">No observations yet</strong>
            Add one to start labelling this media.
          </div>
          <AddObservationMenu
            mode={mode}
            onDrawRectangle={onDrawRectangle}
            onWholeImage={onAddWholeImage}
            variant="centered-button"
          />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto min-h-0">
            {observations.map((obs) => (
              <ObservationRow
                key={obs.observationID}
                observation={obs}
                studyId={studyId}
                isSelected={obs.observationID === selectedObservationId}
                onSelect={() => onSelectObservation(obs.observationID)}
                onUpdateClassification={(updates) =>
                  onUpdateClassification(obs.observationID, updates)
                }
                onDelete={() => onDeleteObservation(obs.observationID)}
              />
            ))}
          </div>

          <AddObservationMenu
            mode={mode}
            onDrawRectangle={onDrawRectangle}
            onWholeImage={onAddWholeImage}
            variant="bottom-row"
          />
        </>
      )}
    </aside>
  )
}
