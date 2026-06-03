import { Check, Filter, X, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import * as HoverCard from '@radix-ui/react-hover-card'
import DeploymentMediaGallery from '../media/DeploymentMediaGallery'
import EditableLocationName from './EditableLocationName'
import LocationPopover from './LocationPopover'
import DeploymentSettingsPopover from './DeploymentSettingsPopover'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { formatScientificName } from '../utils/scientificName'
import { isBlank, isVehicle } from '../utils/speciesUtils'

/**
 * Bottom-pane container for the Deployments tab. Mounted only when a
 * deployment is selected. Header shows the inline-editable deployment
 * name, a species-filter popover, and a close button. Body for V1
 * contains DeploymentMediaGallery; later additions (timeline graph,
 * camera-days, species at location) slot in as siblings inside the
 * body.
 */
export default function DeploymentDetailPane({
  studyId,
  deployment,
  onClose,
  onRenameLocation,
  onCommitLatLon,
  onEnterPlaceMode
}) {
  // The pane is remounted via `key={deploymentID}` whenever the selection
  // changes, so plain useState([]) initializes correctly per deployment —
  // no useEffect reset, and Gallery's useInfiniteQuery only fires once per
  // switch instead of fetching with the stale selection first.
  const [selectedSpecies, setSelectedSpecies] = useState([])
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full bg-card min-h-0">
      <div className="flex items-center justify-between px-2 py-2 border-b border-border flex-shrink-0 gap-2">
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
          <LocationPopover
            deployment={deployment}
            onCommitLatLon={onCommitLatLon}
            onEnterPlaceMode={onEnterPlaceMode}
          />
          <SpeciesFilterButton
            studyId={studyId}
            deploymentID={deployment.deploymentID}
            selectedSpecies={selectedSpecies}
            onChange={setSelectedSpecies}
          />
          <DeploymentSettingsPopover studyId={studyId} deployment={deployment} />
          <button
            onClick={() =>
              navigate(
                `/study/${studyId}/media?deployment=${encodeURIComponent(deployment.deploymentID)}`
              )
            }
            className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-medium rounded text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/15"
            title="Open this deployment in the Media tab"
          >
            Open in Media
            <ExternalLink size={13} />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
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
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/25'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
        title={hasFilter ? `Filter: ${selectedSpecies.length} species` : 'Filter species'}
        aria-label="Filter species"
      >
        <Filter size={16} />
        {hasFilter && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
        )}
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          onScroll={() => setScrollSignal((n) => n + 1)}
          className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-[1100]"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card">
            <span className="text-xs font-medium text-foreground">Filter by species</span>
            {hasFilter && (
              <button
                onClick={clearAll}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Clear
              </button>
            )}
          </div>
          {speciesList.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">Loading…</div>
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
  const isBlankEntry = isBlank(scientificName)
  const isVehicleEntry = isVehicle(scientificName)
  const isPseudo = isBlankEntry || isVehicleEntry

  const commonName = isPseudo ? null : resolveCommonName(scientificName)
  const pseudoLabel = isBlankEntry ? 'Blank' : isVehicleEntry ? 'Vehicle' : null

  const [hoverOpen, setHoverOpen] = useState(false)
  // Close any open card when the popover scrolls.
  useEffect(() => {
    if (scrollSignal > 0) setHoverOpen(false)
  }, [scrollSignal])

  const button = (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
        isSelected
          ? 'bg-blue-50 hover:bg-blue-100 dark:hover:bg-blue-500/25 dark:bg-blue-500/15'
          : 'hover:bg-accent'
      }`}
    >
      <span
        className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
          isSelected ? 'bg-blue-500 border-blue-500 dark:bg-blue-400' : 'border-border bg-card'
        }`}
      >
        {isSelected && <Check size={12} className="text-white" />}
      </span>
      <span className="flex-1 min-w-0">
        <span
          className={`block text-sm truncate ${
            isPseudo
              ? 'italic text-muted-foreground'
              : `${commonName ? 'capitalize' : 'italic'} ${
                  isSelected ? 'text-blue-900 dark:text-blue-300 font-medium' : 'text-foreground'
                }`
          }`}
        >
          {pseudoLabel || commonName || formatScientificName(scientificName)}
        </span>
        {!isPseudo && commonName && (
          <span className="block text-xs italic text-muted-foreground truncate">
            {formatScientificName(scientificName)}
          </span>
        )}
      </span>
      <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
    </button>
  )

  // Pseudo-species rows have no GBIF/IUCN tooltip — render the button bare.
  if (isPseudo) {
    return <li>{button}</li>
  }

  return (
    <li>
      <HoverCard.Root open={hoverOpen} onOpenChange={setHoverOpen} openDelay={250} closeDelay={120}>
        <HoverCard.Trigger asChild>{button}</HoverCard.Trigger>
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
