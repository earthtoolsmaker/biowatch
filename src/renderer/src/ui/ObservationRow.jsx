import { useEffect, useRef } from 'react'
import { Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import SexSelector from './SexSelector'
import LifeStageSelector from './LifeStageSelector'
import BehaviorSelector from './BehaviorSelector'
import SpeciesPicker from './SpeciesPicker'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { formatScientificName } from '../utils/scientificName'

const BBOX_TYPE_ICON = (
  <span
    className="inline-flex w-4 h-4 rounded-sm border-[1.5px] border-[#2563eb] flex-shrink-0"
    style={{ background: 'rgba(37,99,235,0.08)' }}
    aria-hidden="true"
  />
)

const WHOLE_TYPE_ICON = (
  <span
    className="inline-flex w-4 h-4 rounded-sm border-[1.5px] border-dashed border-border bg-muted flex-shrink-0"
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
  autoFocusPicker = true,
  initialBrowse = false,
  browseEpoch = 0
}) {
  const rowRef = useRef(null)

  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isSelected])

  const isBbox = observation.bboxX != null
  const isHuman = observation.classificationMethod === 'human'

  // Prefer the dictionary's curated common name over whatever the importer
  // dropped in observations.commonName (LILA stores the snake_case category
  // there, e.g. "yellow_baboon"). Falls through to the DB value, then to the
  // scientific name. Empty-species rows fall back to a label keyed by
  // observationType: "Vehicle" for vehicle, "Blank" for everything else
  // (blank/unclassified/unknown/null).
  const isPseudoSpecies = !observation.scientificName && !observation.commonName
  const pseudoLabel = observation.observationType === 'vehicle' ? 'Vehicle' : 'Blank'
  const resolvedCommon = resolveCommonName(observation.scientificName) || observation.commonName
  const showSci = !resolvedCommon && observation.scientificName
  const displayName =
    resolvedCommon || formatScientificName(observation.scientificName) || pseudoLabel

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

  return (
    <div
      ref={rowRef}
      className={`relative border-b border-border ${
        isSelected ? 'bg-[#f8f9fb] sticky top-0 z-10' : ''
      }`}
    >
      {isSelected && (
        <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#2563eb]" aria-hidden="true" />
      )}

      <button
        type="button"
        onClick={onSelect}
        aria-expanded={isSelected}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
      >
        {isBbox ? BBOX_TYPE_ICON : WHOLE_TYPE_ICON}

        {isHuman && (
          <Check
            size={12}
            className="text-muted-foreground flex-shrink-0"
            aria-label="Human-validated"
          />
        )}

        <span
          className={`text-sm flex-1 min-w-0 truncate ${
            isPseudoSpecies
              ? 'italic text-muted-foreground'
              : `text-foreground font-medium ${showSci ? 'italic' : 'capitalize'}`
          }`}
        >
          {displayName}
        </span>

        {confidence && (
          <span className="text-xs text-muted-foreground flex-shrink-0">{confidence}</span>
        )}

        {!isSelected && stageBadge && (
          <span className="text-[10px] px-1.5 py-px rounded bg-muted text-muted-foreground">
            {stageBadge}
          </span>
        )}
        {!isSelected && sexBadge && (
          <span className="text-[10px] px-1.5 py-px rounded bg-muted text-muted-foreground">
            {sexBadge}
          </span>
        )}

        {isSelected ? (
          <ChevronUp size={14} className="text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {isSelected && (
        <div className="px-3 pb-3 pt-1 space-y-3" onClick={(e) => e.stopPropagation()}>
          <SpeciesPicker
            // Remount on each label-click epoch when this row is the browse
            // target, so a re-click on the already-selected bbox re-triggers
            // browse mode (otherwise the picker's mount-time state ignores
            // updated props).
            key={initialBrowse ? `browse-${browseEpoch}` : 'normal'}
            studyId={studyId}
            currentScientificName={observation.scientificName}
            onSelect={handleSpeciesSelect}
            autoFocus={autoFocusPicker}
            initialBrowse={initialBrowse}
          />

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Sex
            </div>
            <SexSelector
              value={observation.sex}
              onChange={(sex) => onUpdateClassification({ sex })}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Life stage
            </div>
            <LifeStageSelector
              value={observation.lifeStage}
              onChange={(lifeStage) => onUpdateClassification({ lifeStage })}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
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
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors dark:text-red-400 dark:hover:text-red-400"
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
