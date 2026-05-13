import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as HoverCard from '@radix-ui/react-hover-card'
import {
  sortSpeciesHumansLast,
  isBlank,
  isVehicle,
  BLANK_SENTINEL,
  VEHICLE_SENTINEL
} from '../utils/speciesUtils'
import SpeciesTooltipContent from './SpeciesTooltipContent'
import { buildScientificToCommonMap, useCommonName } from '../utils/commonNames'
import { formatScientificName } from '../utils/scientificName'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'

function SpeciesRow({
  species,
  index,
  isBlankEntry,
  isVehicleEntry,
  isFirstPseudo,
  storedCommonName,
  selectedSpecies,
  palette,
  totalCount,
  speciesImageMap,
  studyId,
  onToggle,
  scrollSignal
}) {
  const isPseudoEntry = isBlankEntry || isVehicleEntry
  const [hoverOpen, setHoverOpen] = useState(false)
  // Close any open card when the parent list scrolls — Radix HoverCard tracks
  // its trigger, so without this the card "rides along" with the row, which
  // feels jarring.
  useEffect(() => {
    if (scrollSignal > 0) setHoverOpen(false)
  }, [scrollSignal])
  // Hook must be called unconditionally — pass null for pseudo-species entries so it short-circuits.
  const resolved = useCommonName(isPseudoEntry ? null : species.scientificName, {
    storedCommonName
  })
  const displayName = isBlankEntry
    ? 'Blank'
    : isVehicleEntry
      ? 'Vehicle'
      : resolved || formatScientificName(species.scientificName)

  const isSelected = selectedSpecies.some((s) => s.scientificName === species.scientificName)
  const colorIndex = selectedSpecies.findIndex((s) => s.scientificName === species.scientificName)
  const color = colorIndex >= 0 ? palette[colorIndex % palette.length] : '#ccc'

  const showScientificInItalic =
    !isPseudoEntry && species.scientificName && resolved && resolved !== species.scientificName
  // resolveSpeciesInfo is still used to surface a Wikipedia thumbnail when the
  // study has no best-media image. The inline IUCN badge is intentionally NOT
  // rendered on the media/activity sidebars — only inside the hover card.
  const info = isPseudoEntry ? null : resolveSpeciesInfo(species.scientificName)
  const studyImage = isPseudoEntry ? null : speciesImageMap[species.scientificName]
  const tooltipImageData =
    studyImage || (info?.imageUrl ? { scientificName: species.scientificName } : null)
  const enableTooltip = studyId && !!tooltipImageData

  const rowContent = (
    <div
      className={`cursor-pointer group transition-colors py-2 -mx-3 px-3 first:pt-3 last:pb-3 ${
        isSelected
          ? 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
          : 'hover:bg-blue-50 dark:hover:bg-blue-500/15'
      } ${isFirstPseudo ? 'border-t border-border mt-1 pt-3' : ''}`}
      onClick={() => onToggle(species)}
    >
      <div className="flex justify-between mb-1 items-center cursor-pointer gap-2">
        <div className="flex items-center cursor-pointer min-w-0 flex-1">
          <div
            className={`w-2 h-2 rounded-full mr-2 flex-shrink-0 border cursor-pointer ${isSelected ? `border-transparent bg-[${color}]` : 'border-border'} group-hover:bg-gray-800 `}
            style={{ backgroundColor: isSelected ? color : null }}
          ></div>
          <span
            className={`text-sm truncate pr-1 ${
              isPseudoEntry
                ? 'text-muted-foreground italic'
                : showScientificInItalic
                  ? 'text-foreground capitalize'
                  : 'text-foreground italic'
            }`}
          >
            {displayName}
            {showScientificInItalic && (
              <span className="text-muted-foreground italic ml-2 normal-case">
                {formatScientificName(species.scientificName)}
              </span>
            )}
          </span>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">{species.count}</span>
      </div>
      {!isPseudoEntry && (
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className="h-2 rounded-full"
            style={{
              width: `${(species.count / totalCount) * 100}%`,
              backgroundColor: isSelected ? color : '#ccc'
            }}
          ></div>
        </div>
      )}
    </div>
  )

  if (enableTooltip) {
    return (
      <HoverCard.Root
        key={species.scientificName || index}
        open={hoverOpen}
        onOpenChange={setHoverOpen}
        openDelay={200}
        closeDelay={120}
      >
        <HoverCard.Trigger asChild>{rowContent}</HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            side="right"
            sideOffset={12}
            align="start"
            avoidCollisions={true}
            collisionPadding={16}
            className="z-[10000]"
          >
            <SpeciesTooltipContent imageData={tooltipImageData} studyId={studyId} />
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard.Root>
    )
  }

  return rowContent
}

function SpeciesDistribution({
  data,
  taxonomicData,
  selectedSpecies,
  onSpeciesChange,
  palette,
  blankCount = 0,
  vehicleCount = 0,
  studyId = null,
  showHeader = true
}) {
  // Append pseudo-species rows (Blank, Vehicle) when their counts are > 0.
  const displayData = useMemo(() => {
    let result = data
    if (vehicleCount > 0) {
      result = [...result, { scientificName: VEHICLE_SENTINEL, count: vehicleCount }]
    }
    if (blankCount > 0) {
      result = [...result, { scientificName: BLANK_SENTINEL, count: blankCount }]
    }
    return result
  }, [data, blankCount, vehicleCount])

  // Normalize bar widths against species-only counts so the bars match
  // between the Media and Activity tabs. Media adds pseudo-rows for
  // Blank/Vehicle which would otherwise inflate the denominator and shrink
  // the species bars relative to Activity. Pseudo-rows render no bar (see
  // SpeciesRow), so they don't need to participate in this sum.
  const totalCount = data.reduce((sum, item) => sum + item.count, 0)

  // Fetch best image per species for hover tooltips (only when studyId is provided)
  const { data: bestImagesData } = useQuery({
    queryKey: ['bestImagesPerSpecies', studyId],
    queryFn: async () => {
      const response = await window.api.getBestImagePerSpecies(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: 60000 // Cache for 1 minute
  })

  // Create lookup map: scientificName -> imageData
  const speciesImageMap = useMemo(() => {
    const map = {}
    if (bestImagesData) {
      bestImagesData.forEach((item) => {
        map[item.scientificName] = item
      })
    }
    return map
  }, [bestImagesData])

  // Map of scientific names -> authoritative vernacular names from CamtrapDP imports.
  const scientificToCommonMap = useMemo(
    () => buildScientificToCommonMap(taxonomicData),
    [taxonomicData]
  )

  // Handle toggling species selection when clicking on the dot
  const handleSpeciesToggle = (species) => {
    const isSelected = selectedSpecies.some((s) => s.scientificName === species.scientificName)

    let newSelectedSpecies
    if (isSelected) {
      newSelectedSpecies = selectedSpecies.filter(
        (s) => s.scientificName !== species.scientificName
      )
    } else {
      newSelectedSpecies = [...selectedSpecies, species]
    }

    if (newSelectedSpecies.length > 0) {
      onSpeciesChange(newSelectedSpecies)
    }
  }

  // Bumped on every scroll of the list container; child rows watch this and
  // close their HoverCard when it changes.
  const [scrollSignal, setScrollSignal] = useState(0)
  const handleScroll = useCallback(() => {
    setScrollSignal((s) => s + 1)
  }, [])

  if (!displayData || displayData.length === 0) {
    return <div className="text-muted-foreground">No species data available</div>
  }

  const pseudoEntries = (blankCount > 0 ? 1 : 0) + (vehicleCount > 0 ? 1 : 0)
  const speciesCount = displayData.length - pseudoEntries

  return (
    <div className="w-full h-full bg-card rounded border border-border flex flex-col overflow-hidden">
      {showHeader && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
          <span className="text-sm font-medium text-foreground">Species</span>
          <span className="text-xs text-muted-foreground">({speciesCount})</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 myscroll" onScroll={handleScroll}>
        <div>
          {(() => {
            const sorted = sortSpeciesHumansLast(displayData)
            // Index of the first pseudo-row in the sorted list; used to render a
            // divider between real species and Blank/Vehicle. Only show the
            // divider when there's at least one real species above it.
            const firstPseudoIndex = sorted.findIndex(
              (s) => isBlank(s.scientificName) || isVehicle(s.scientificName)
            )
            return sorted.map((species, index) => {
              const isBlankEntry = isBlank(species.scientificName)
              const isVehicleEntry = isVehicle(species.scientificName)
              const isPseudo = isBlankEntry || isVehicleEntry
              const isFirstPseudo = isPseudo && index === firstPseudoIndex && index > 0
              const storedCommonName = isPseudo
                ? null
                : scientificToCommonMap[species.scientificName] || null
              return (
                <SpeciesRow
                  key={species.scientificName || index}
                  species={species}
                  index={index}
                  isBlankEntry={isBlankEntry}
                  isVehicleEntry={isVehicleEntry}
                  isFirstPseudo={isFirstPseudo}
                  scrollSignal={scrollSignal}
                  storedCommonName={storedCommonName}
                  selectedSpecies={selectedSpecies}
                  palette={palette}
                  totalCount={totalCount}
                  speciesImageMap={speciesImageMap}
                  studyId={studyId}
                  onToggle={handleSpeciesToggle}
                />
              )
            })
          })()}
        </div>
      </div>
    </div>
  )
}

export default SpeciesDistribution
