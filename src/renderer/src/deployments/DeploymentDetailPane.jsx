import { Check, Filter, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as HoverCard from '@radix-ui/react-hover-card'
import DeploymentMediaGallery from '../media/DeploymentMediaGallery'
import EditableLocationName from './EditableLocationName'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { BLANK_SENTINEL } from '../../../shared/constants.js'

/**
 * Bottom-pane container for the Deployments tab. Mounted only when a
 * deployment is selected. Header shows the inline-editable deployment
 * name, a species-filter popover, and a close button. Body for V1
 * contains DeploymentMediaGallery; later additions (timeline graph,
 * camera-days, species at location) slot in as siblings inside the
 * body.
 */
export default function DeploymentDetailPane({ studyId, deployment, onClose, onRenameLocation }) {
  // The pane is remounted via `key={deploymentID}` whenever the selection
  // changes, so plain useState([]) initializes correctly per deployment —
  // no useEffect reset, and Gallery's useInfiniteQuery only fires once per
  // switch instead of fetching with the stale selection first.
  const [selectedSpecies, setSelectedSpecies] = useState([])

  return (
    <div className="flex flex-col h-full bg-white min-h-0">
      <div className="flex items-center justify-between px-2 py-2 border-b border-gray-200 flex-shrink-0 gap-2">
        {/* isSelected=false keeps the header in the same neutral gray as
            the rest of the pane chrome — the blue "selected" treatment is
            for the list rows where it's a state indicator. */}
        <EditableLocationName
          locationID={deployment.locationID || deployment.deploymentID}
          locationName={deployment.locationName}
          isSelected={false}
          onRename={onRenameLocation}
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          <SpeciesFilterButton
            studyId={studyId}
            deploymentID={deployment.deploymentID}
            selectedSpecies={selectedSpecies}
            onChange={setSelectedSpecies}
          />
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
            title="Close (Esc)"
            aria-label="Close media pane"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <DeploymentMediaGallery deploymentID={deployment.deploymentID} species={selectedSpecies} />
      </div>
    </div>
  )
}

/**
 * Filter icon + popover with species pills. Pulls the species distribution
 * scoped to the current deployment; selection toggles pills, which thread
 * back into the gallery's species filter.
 */
function SpeciesFilterButton({ studyId, deploymentID, selectedSpecies, onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  // Bump on every scroll inside the popover so each row's HoverCard can
  // close itself — Radix HoverCard tracks its trigger, so without this
  // the card "rides along" with the scrolling row.
  const [scrollSignal, setScrollSignal] = useState(0)
  const popoverRef = useRef(null)
  const buttonRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [isOpen])

  // Species seen at this deployment, with media counts. Lazy-loaded on
  // first popover open; cached per (studyId, deploymentID).
  const { data: speciesList = [] } = useQuery({
    queryKey: ['deploymentSpecies', studyId, deploymentID],
    queryFn: async () => {
      const response = await window.api.getDeploymentSpecies(studyId, deploymentID)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: isOpen && !!studyId && !!deploymentID,
    staleTime: Infinity
  })

  const toggle = (name) => {
    onChange(
      selectedSpecies.includes(name)
        ? selectedSpecies.filter((s) => s !== name)
        : [...selectedSpecies, name]
    )
  }

  const clearAll = () => onChange([])

  const hasFilter = selectedSpecies.length > 0

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((v) => !v)}
        className={`p-1 rounded relative ${
          hasFilter
            ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        }`}
        title={hasFilter ? `Filter: ${selectedSpecies.length} species` : 'Filter species'}
        aria-label="Filter species"
      >
        <Filter size={16} />
        {hasFilter && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-500" />
        )}
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          onScroll={() => setScrollSignal((n) => n + 1)}
          className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-[1100]"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 sticky top-0 bg-white">
            <span className="text-xs font-medium text-gray-700">Filter by species</span>
            {hasFilter && (
              <button onClick={clearAll} className="text-xs text-blue-600 hover:underline">
                Clear
              </button>
            )}
          </div>
          {speciesList.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400">Loading…</div>
          ) : (
            <ul className="py-1">
              {speciesList.map((s) => (
                <SpeciesFilterRow
                  key={s.scientificName}
                  studyId={studyId}
                  scientificName={s.scientificName}
                  count={s.count}
                  isSelected={selectedSpecies.includes(s.scientificName)}
                  onToggle={() => toggle(s.scientificName)}
                  scrollSignal={scrollSignal}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function SpeciesFilterRow({ studyId, scientificName, count, isSelected, onToggle, scrollSignal }) {
  const isBlank = scientificName === BLANK_SENTINEL
  const commonName = isBlank ? null : resolveCommonName(scientificName)
  const [hoverOpen, setHoverOpen] = useState(false)
  // Close any open card when the popover scrolls.
  useEffect(() => {
    if (scrollSignal > 0) setHoverOpen(false)
  }, [scrollSignal])

  // Blanks (media with no observations) skip the species hover card —
  // there's no scientificName to look up.
  const rowButton = (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
        isSelected ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
      }`}
    >
      <span
        className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
          isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'
        }`}
      >
        {isSelected && <Check size={12} className="text-white" />}
      </span>
      <span className="flex-1 min-w-0">
        {isBlank ? (
          <span
            className={`block text-sm truncate italic ${
              isSelected ? 'text-blue-900 font-medium' : 'text-gray-600'
            }`}
          >
            No observations
          </span>
        ) : (
          <>
            <span
              className={`block text-sm truncate ${commonName ? 'capitalize' : ''} ${
                isSelected ? 'text-blue-900 font-medium' : 'text-gray-800'
              }`}
            >
              {commonName || scientificName}
            </span>
            {commonName && (
              <span className="block text-xs italic text-gray-500 truncate">{scientificName}</span>
            )}
          </>
        )}
      </span>
      <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">{count}</span>
    </button>
  )

  if (isBlank) {
    return <li>{rowButton}</li>
  }

  return (
    <li>
      <HoverCard.Root open={hoverOpen} onOpenChange={setHoverOpen} openDelay={250} closeDelay={120}>
        <HoverCard.Trigger asChild>{rowButton}</HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            side="left"
            sideOffset={8}
            align="start"
            avoidCollisions={true}
            collisionPadding={16}
            className="z-[10001]"
          >
            <SpeciesTooltipContent imageData={{ scientificName }} studyId={studyId} size="lg" />
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
    </li>
  )
}
