import { useEffect, useRef } from 'react'
import { Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import SexSelector from './SexSelector'
import LifeStageSelector from './LifeStageSelector'
import BehaviorSelector from './BehaviorSelector'
import SpeciesPicker from './SpeciesPicker'

const BBOX_TYPE_ICON = (
  <span
    className="inline-flex w-4 h-4 rounded-sm border-[1.5px] border-[#2563eb] flex-shrink-0"
    style={{ background: 'rgba(37,99,235,0.08)' }}
    aria-hidden="true"
  />
)

const WHOLE_TYPE_ICON = (
  <span
    className="inline-flex w-4 h-4 rounded-sm border-[1.5px] border-dashed border-gray-400 bg-gray-100 flex-shrink-0"
    aria-hidden="true"
  />
)

/**
 * One row in the observation rail.
 *
 * Props:
 *  - observation: full observation record from the DB
 *  - studyId: string
 *  - isSelected: boolean — when true, the row is expanded
 *  - onSelect: () → void
 *  - onUpdateClassification: (updates: object) → void
 *  - onDelete: () → void
 */
export default function ObservationRow({
  observation,
  studyId,
  isSelected,
  onSelect,
  onUpdateClassification,
  onDelete,
  autoFocusPicker = true
}) {
  const rowRef = useRef(null)

  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isSelected])

  const isBbox = observation.bboxX != null
  const isHuman = observation.classificationMethod === 'human'

  const displayName =
    observation.commonName ||
    observation.scientificName ||
    (observation.observationType === 'blank' ? 'Blank' : '—')

  const confidence =
    observation.classificationProbability != null && !isHuman
      ? `${Math.round(observation.classificationProbability * 100)}%`
      : null

  const sexBadge = observation.sex === 'female' ? '♀' : observation.sex === 'male' ? '♂' : null
  const stageBadge =
    observation.lifeStage === 'adult'
      ? 'A'
      : observation.lifeStage === 'subadult'
        ? 'SA'
        : observation.lifeStage === 'juvenile'
          ? 'J'
          : null

  const handleSpeciesSelect = (scientificName, commonName) => {
    onUpdateClassification({
      scientificName,
      commonName,
      observationType: 'animal'
    })
  }

  const handleMarkBlank = () => {
    onUpdateClassification({
      scientificName: null,
      commonName: null,
      observationType: 'blank'
    })
  }

  return (
    <div
      ref={rowRef}
      className={`relative border-b border-gray-100 ${
        isSelected ? 'bg-[#f8f9fb] sticky top-0 z-10' : ''
      }`}
    >
      {isSelected && (
        <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#2563eb]" aria-hidden="true" />
      )}

      <button
        type="button"
        onClick={onSelect}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f8f9fb] transition-colors"
      >
        {isBbox ? BBOX_TYPE_ICON : WHOLE_TYPE_ICON}

        {isHuman && (
          <Check size={12} className="text-gray-500 flex-shrink-0" aria-label="Human-validated" />
        )}

        <span
          className={`text-sm flex-1 min-w-0 truncate ${
            observation.observationType === 'blank'
              ? 'italic text-gray-400'
              : 'text-[#030213] font-medium'
          }`}
        >
          {displayName}
        </span>

        {confidence && <span className="text-xs text-gray-400 flex-shrink-0">{confidence}</span>}

        {!isSelected && stageBadge && (
          <span className="text-[10px] px-1.5 py-px rounded bg-gray-100 text-gray-600">
            {stageBadge}
          </span>
        )}
        {!isSelected && sexBadge && (
          <span className="text-[10px] px-1.5 py-px rounded bg-gray-100 text-gray-600">
            {sexBadge}
          </span>
        )}

        {isSelected ? (
          <ChevronUp size={14} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
        )}
      </button>

      {isSelected && (
        <div className="px-3 pb-3 pt-1 space-y-3" onClick={(e) => e.stopPropagation()}>
          <SpeciesPicker
            studyId={studyId}
            currentScientificName={observation.scientificName}
            onSelect={handleSpeciesSelect}
            onMarkBlank={handleMarkBlank}
            allowMarkBlank={!isBbox}
            autoFocus={autoFocusPicker}
          />

          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
              Sex
            </div>
            <SexSelector
              value={observation.sex}
              onChange={(sex) => onUpdateClassification({ sex })}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
              Life stage
            </div>
            <LifeStageSelector
              value={observation.lifeStage}
              onChange={(lifeStage) => onUpdateClassification({ lifeStage })}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
              Behavior
            </div>
            <BehaviorSelector
              value={observation.behavior}
              onChange={(behavior) => onUpdateClassification({ behavior })}
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
              title="Delete observation"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
