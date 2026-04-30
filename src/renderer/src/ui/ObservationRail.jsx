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
  onAddWholeImage,
  showShortcuts = false
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
      {showShortcuts && (
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-2">
            Keyboard shortcuts
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-gray-600">
            <kbd className="font-mono text-[11px] font-semibold text-[#030213]">Tab</kbd>
            <span>Next bbox</span>
            <kbd className="font-mono text-[11px] font-semibold text-[#030213]">Shift+Tab</kbd>
            <span>Previous bbox</span>
            <kbd className="font-mono text-[11px] font-semibold text-[#030213]">←/→</kbd>
            <span>Navigate images</span>
            <kbd className="font-mono text-[11px] font-semibold text-[#030213]">B</kbd>
            <span>Toggle bboxes</span>
            <kbd className="font-mono text-[11px] font-semibold text-[#030213]">+/-</kbd>
            <span>Zoom in/out</span>
            <kbd className="font-mono text-[11px] font-semibold text-[#030213]">0</kbd>
            <span>Reset zoom</span>
            <kbd className="font-mono text-[11px] font-semibold text-[#030213]">Del</kbd>
            <span>Delete observation</span>
            <kbd className="font-mono text-[11px] font-semibold text-[#030213]">Esc</kbd>
            <span>Close modal</span>
          </div>
        </div>
      )}

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
