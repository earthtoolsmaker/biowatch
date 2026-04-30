import { useEffect, useState } from 'react'
import ObservationRow from './ObservationRow'
import AddObservationMenu from './AddObservationMenu'
import { getMediaMode } from '../utils/mediaMode'

const KBD_CLASSNAME = 'font-mono text-[11px] font-semibold text-[#030213]'

function Kbd({ children }) {
  return <kbd className={KBD_CLASSNAME}>{children}</kbd>
}

/**
 * Persistent right-side rail listing every observation on the current media.
 *
 * Props:
 *  - observations: array of observation records (bbox or whole-image)
 *  - studyId: string
 *  - mediaId: string — used to reset per-media UI state on navigation
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
  mediaId,
  selectedObservationId,
  onSelectObservation,
  onUpdateClassification,
  onDeleteObservation,
  onDrawRectangle,
  onAddWholeImage,
  showShortcuts = false,
  isLoading = false
}) {
  const mode = getMediaMode(observations)

  // Whether the user explicitly clicked a row (drives picker autoFocus). The
  // auto-select effect below does NOT set this — only user clicks do.
  const [userInteracted, setUserInteracted] = useState(false)

  // Whether the per-media auto-select has already fired once. Prevents the
  // effect from re-selecting after the user explicitly deselected.
  const [hasAutoSelected, setHasAutoSelected] = useState(false)

  // Reset per-media flags when navigating between media.
  useEffect(() => {
    setUserInteracted(false)
    setHasAutoSelected(false)
  }, [mediaId])

  // Auto-expand the single whole-image row once per media. After this fires,
  // the user can deselect it (e.g., by clicking the image) without it being
  // re-selected on the next render.
  useEffect(() => {
    if (
      !hasAutoSelected &&
      !selectedObservationId &&
      mode === 'whole-image' &&
      observations.length > 0
    ) {
      setHasAutoSelected(true)
      onSelectObservation(observations[0].observationID)
    }
  }, [hasAutoSelected, selectedObservationId, observations, mode, onSelectObservation])

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
            <Kbd>Tab</Kbd>
            <span>Next observation</span>
            <Kbd>Shift+Tab</Kbd>
            <span>Previous observation</span>
            <Kbd>Left/Right</Kbd>
            <span>Navigate images</span>
            <Kbd>Ctrl+Left/Right</Kbd>
            <span>Navigate sequences</span>
            <Kbd>B</Kbd>
            <span>Toggle bboxes</span>
            <Kbd>?</Kbd>
            <span>Toggle this panel</span>
            <Kbd>+/-</Kbd>
            <span>Zoom in/out</span>
            <Kbd>0</Kbd>
            <span>Reset zoom</span>
            <Kbd>Del</Kbd>
            <span>Delete observation</span>
            <Kbd>Esc</Kbd>
            <span>Close modal</span>
          </div>
        </div>
      )}

      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 flex-shrink-0">
        <span className="text-sm font-semibold text-[#030213]">Observations</span>
        <span className="text-xs text-gray-500 font-medium">{observations.length}</span>
      </header>

      {isLoading ? (
        // Suppress the empty state while data is still loading to avoid a
        // "No observations yet" flash during media navigation.
        <div className="flex-1" aria-hidden="true" />
      ) : mode === 'empty' ? (
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
                onSelect={() => {
                  setUserInteracted(true)
                  onSelectObservation(obs.observationID)
                }}
                onUpdateClassification={(updates) =>
                  onUpdateClassification(obs.observationID, updates)
                }
                onDelete={() => onDeleteObservation(obs.observationID)}
                autoFocusPicker={userInteracted}
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
