import { useEffect, useState } from 'react'

// Create a module-level cache for common names that persists across component unmounts
const commonNamesCache = {}

function SpeciesDistribution({ data, taxonomicData, selectedSpecies, onSpeciesChange, palette }) {
  // Add a simple state to force re-renders when cache is updated
  const [, forceUpdate] = useState({})

  const totalCount = data.reduce((sum, item) => sum + item.count, 0)

  // Create a map of scientific names to common names from taxonomic data
  const scientificToCommonMap = {}
  if (taxonomicData && Array.isArray(taxonomicData)) {
    taxonomicData.forEach((taxon) => {
      if (taxon.scientificName && taxon?.vernacularNames?.eng) {
        scientificToCommonMap[taxon.scientificName] = taxon.vernacularNames.eng
      }
    })
  }

  // Function to fetch common names from Global Biodiversity Information Facility (GBIF)
  async function fetchCommonName(scientificName) {
    // Check cache first
    if (commonNamesCache[scientificName] !== undefined) {
      return commonNamesCache[scientificName]
    }

    try {
      // Step 1: Match the scientific name to get usageKey
      const matchResponse = await fetch(
        `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
      )
      const matchData = await matchResponse.json()

      // Check if we got a valid usageKey
      if (!matchData.usageKey) {
        // Cache the null result to avoid future requests
        commonNamesCache[scientificName] = null
        return null
      }

      // Step 2: Use the usageKey to fetch vernacular names
      const vernacularResponse = await fetch(
        `https://api.gbif.org/v1/species/${matchData.usageKey}/vernacularNames`
      )
      const vernacularData = await vernacularResponse.json()

      // Find English vernacular name if available
      if (vernacularData && vernacularData.results && vernacularData.results.length > 0) {
        // Prefer English names
        const englishName = vernacularData.results.find(
          (name) => name.language === 'eng' || name.language === 'en'
        )

        if (englishName) {
          // Cache the result
          commonNamesCache[scientificName] = englishName.vernacularName
          return englishName.vernacularName
        }

        // If no English name, return the first available name
        // Cache the result
        commonNamesCache[scientificName] = vernacularData.results[0].vernacularName
        return vernacularData.results[0].vernacularName
      }

      // Cache the null result
      commonNamesCache[scientificName] = null
      return null
    } catch (error) {
      console.error(`Error fetching common name for ${scientificName}:`, error)
      // Cache the error as null to prevent repeated failed requests
      commonNamesCache[scientificName] = null
      return null
    }
  }

  // Fetch missing common names
  useEffect(() => {
    const fetchMissingCommonNames = async () => {
      if (!data) return

      const missingCommonNames = data.filter(
        (species) =>
          species.scientificName &&
          !scientificToCommonMap[species.scientificName] &&
          commonNamesCache[species.scientificName] === undefined // Only fetch if not cached
      )

      if (missingCommonNames.length === 0) return

      // Fetch common names for species with missing common names
      await Promise.all(
        missingCommonNames.map(async (species) => {
          await fetchCommonName(species.scientificName)
        })
      )

      // Force re-render to pick up new cache entries
      forceUpdate({})
    }

    fetchMissingCommonNames()
  }, [data, taxonomicData])

  // Handle toggling species selection when clicking on the dot
  const handleSpeciesToggle = (species) => {
    // Find if this species is already selected
    const isSelected = selectedSpecies.some((s) => s.scientificName === species.scientificName)

    let newSelectedSpecies
    if (isSelected) {
      // Remove from selection
      newSelectedSpecies = selectedSpecies.filter(
        (s) => s.scientificName !== species.scientificName
      )
    } else {
      // Add to selection
      newSelectedSpecies = [...selectedSpecies, species]
    }

    // Make sure we always have at least one species selected
    if (newSelectedSpecies.length > 0) {
      onSpeciesChange(newSelectedSpecies)
    }
  }

  if (!data || data.length === 0) {
    return <div className="text-gray-500">No species data available</div>
  }

  return (
    <div className="w-full h-full bg-white rounded border border-gray-200 p-3 overflow-y-auto myscroll">
      <div className="space-y-4">
        {data.map((species, index) => {
          // Try to get the common name from the taxonomic data first, then from the cache
          const commonName =
            scientificToCommonMap[species.scientificName] ||
            commonNamesCache[species.scientificName]

          const isSelected = selectedSpecies.some(
            (s) => s.scientificName === species.scientificName
          )
          const colorIndex = selectedSpecies.findIndex(
            (s) => s.scientificName === species.scientificName
          )
          const color = colorIndex >= 0 ? palette[colorIndex % palette.length] : '#ccc'

          return (
            <div
              key={index}
              className="cursor-pointer group"
              onClick={() => handleSpeciesToggle(species)}
            >
              <div className="flex justify-between mb-1 items-center cursor-pointer">
                <div className="flex items-center cursor-pointer">
                  <div
                    className={`w-2 h-2 rounded-full mr-2 border cursor-pointer ${isSelected ? `border-transparent bg-[${color}]` : 'border-gray-300'} group-hover:bg-gray-800 `}
                    style={{
                      backgroundColor: isSelected ? color : null
                    }}
                  ></div>

                  <span className="capitalize text-sm">{commonName || species.scientificName}</span>
                  {species.scientificName && commonName !== undefined && (
                    <span className="text-gray-500 text-sm italic ml-2">
                      {species.scientificName}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500">{species.count}</span>
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
        })}
      </div>
    </div>
  )
}

export default SpeciesDistribution
