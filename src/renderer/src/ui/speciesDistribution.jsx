import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as HoverCard from '@radix-ui/react-hover-card'
import { sortSpeciesHumansLast, isBlank, BLANK_SENTINEL } from '../utils/speciesUtils'
import SpeciesTooltipContent from './SpeciesTooltipContent'
import { useCommonName } from '../utils/commonNames'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'

function SpeciesRow({
  species,
  index,
  isBlankEntry,
  storedCommonName,
  selectedSpecies,
  palette,
  totalCount,
  speciesImageMap,
  studyId,
  onToggle,
  scrollSignal
}) {
  const [hoverOpen, setHoverOpen] = useState(false)
  // Close any open card when the parent list scrolls — Radix HoverCard tracks
  // its trigger, so without this the card "rides along" with the row, which
  // feels jarring.
  useEffect(() => {
    if (scrollSignal > 0) setHoverOpen(false)
  }, [scrollSignal])
  // Hook must be called unconditionally — pass null for blank entries so it short-circuits.
  const resolved = useCommonName(isBlankEntry ? null : species.scientificName, { storedCommonName })
  const displayName = isBlankEntry ? 'Blank' : resolved || species.scientificName

  const isSelected = selectedSpecies.some((s) => s.scientificName === species.scientificName)
  const colorIndex = selectedSpecies.findIndex((s) => s.scientificName === species.scientificName)
  const color = colorIndex >= 0 ? palette[colorIndex % palette.length] : '#ccc'

  const showScientificInItalic =
    !isBlankEntry && species.scientificName && displayName !== species.scientificName
  // resolveSpeciesInfo is still used to surface a Wikipedia thumbnail when the
  // study has no best-media image. The inline IUCN badge is intentionally NOT
  // rendered on the media/activity sidebars — only inside the hover card.
  const info = isBlankEntry ? null : resolveSpeciesInfo(species.scientificName)
  const studyImage = isBlankEntry ? null : speciesImageMap[species.scientificName]
  const tooltipImageData =
    studyImage || (info?.imageUrl ? { scientificName: species.scientificName } : null)
  const enableTooltip = studyId && !!tooltipImageData

  const rowContent = (
    <div
      className="cursor-pointer group hover:bg-blue-50 transition-colors py-2 -mx-3 px-3 first:pt-3 last:pb-3"
      onClick={() => onToggle(species)}
    >
      <div className="flex justify-between mb-1 items-center cursor-pointer gap-2">
        <div className="flex items-center cursor-pointer min-w-0 flex-1">
          <div
            className={`w-2 h-2 rounded-full mr-2 flex-shrink-0 border cursor-pointer ${isSelected ? `border-transparent bg-[${color}]` : 'border-gray-300'} group-hover:bg-gray-800 `}
            style={{ backgroundColor: isSelected ? color : null }}
          ></div>
          <span
            className={`text-sm truncate ${isBlankEntry ? 'text-gray-500 italic' : 'capitalize'}`}
          >
            {displayName}
            {showScientificInItalic && (
              <span className="text-gray-500 italic ml-2 normal-case">
                {species.scientificName}
              </span>
            )}
          </span>
        </div>
        <span className="text-xs text-gray-500 flex-shrink-0">{species.count}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="h-2 rounded-full"
          style={{
            width: `${(species.count / totalCount) * 100}%`,
            backgroundColor: isSelected ? color : '#ccc'
          }}
        ></div>
      </div>
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
  studyId = null
}) {
  // Combine species data with blank entry if blankCount > 0
  const displayData = useMemo(() => {
    if (blankCount > 0) {
      return [...data, { scientificName: BLANK_SENTINEL, count: blankCount }]
    }
    return data
  }, [data, blankCount])

  const totalCount = displayData.reduce((sum, item) => sum + item.count, 0)

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
  const scientificToCommonMap = useMemo(() => {
    const map = {}
    if (taxonomicData && Array.isArray(taxonomicData)) {
      taxonomicData.forEach((taxon) => {
        if (taxon.scientificName && taxon?.vernacularNames?.eng) {
          map[taxon.scientificName] = taxon.vernacularNames.eng
        }
      })
    }
    return map
  }, [taxonomicData])

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
    return <div className="text-gray-500">No species data available</div>
  }

  const speciesCount = blankCount > 0 ? displayData.length - 1 : displayData.length

  return (
    <div className="w-full h-full bg-white rounded border border-gray-200 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 flex-shrink-0">
        <span className="text-sm font-medium text-gray-700">Species</span>
        <span className="text-xs text-gray-400">({speciesCount})</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 myscroll" onScroll={handleScroll}>
        <div>
          {sortSpeciesHumansLast(displayData).map((species, index) => {
            const isBlankEntry = isBlank(species.scientificName)
            const storedCommonName = isBlankEntry
              ? null
              : scientificToCommonMap[species.scientificName] || null
            return (
              <SpeciesRow
                key={species.scientificName || index}
                species={species}
                index={index}
                isBlankEntry={isBlankEntry}
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
          })}
        </div>
      </div>
    </div>
  )
}

export default SpeciesDistribution
