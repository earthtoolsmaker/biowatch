import { useEffect, useState, useRef } from 'react'
import ReactDOMServer from 'react-dom/server'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import { Camera, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'

function DeploymentMap({ deployments }) {
  if (!deployments || deployments.length === 0) {
    return <div className="text-gray-500">No location data available for map</div>
  }

  // Filter to include only deployments with valid coordinates
  const validDeployments = deployments.filter(
    (deployment) => deployment.latitude && deployment.longitude
  )

  if (validDeployments.length === 0) {
    return (
      <div className="text-gray-500">No valid geographic coordinates found for deployments</div>
    )
  }

  // Create bounds from all valid deployment coordinates
  const positions = validDeployments.map((deployment) => [
    parseFloat(deployment.latitude),
    parseFloat(deployment.longitude)
  ])

  // Create a bounds object that encompasses all markers
  const bounds = L.latLngBounds(positions)

  // Format date for popup display
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  // Create camera icon as a custom marker
  const createCameraIcon = () => {
    const cameraIcon = ReactDOMServer.renderToString(
      <div className="camera-marker">
        <Camera color="#1E40AF" fill="#93C5FD" size={28} />
      </div>
    )

    return L.divIcon({
      html: cameraIcon,
      className: 'custom-camera-icon',
      iconSize: [18, 18],
      iconAnchor: [14, 14]
    })
  }

  // Create the camera icon outside of the map loop for better performance
  const cameraIcon = createCameraIcon()

  return (
    <div className="w-full h-full bg-white rounded border border-gray-200">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [50, 50] }}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {validDeployments.map((deployment) => (
          <Marker
            key={deployment.deploymentID}
            position={[parseFloat(deployment.latitude), parseFloat(deployment.longitude)]}
            icon={cameraIcon}
          >
            <Popup>
              <div>
                <h3 className="font-medium">{deployment.locationName || 'Unnamed Location'}</h3>
                <p className="text-sm">
                  {formatDate(deployment.deploymentStart)} - {formatDate(deployment.deploymentEnd)}
                </p>
                <p className="text-xs text-gray-500">
                  Coordinates: {deployment.latitude}, {deployment.longitude}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

// Export SpeciesDistribution so it can be imported in activity.jsx
function SpeciesDistribution({ data, taxonomicData }) {
  const [commonNames, setCommonNames] = useState({})

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
    try {
      // Step 1: Match the scientific name to get usageKey
      const matchResponse = await fetch(
        `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`
      )
      const matchData = await matchResponse.json()

      // Check if we got a valid usageKey
      if (!matchData.usageKey) {
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
          return englishName.vernacularName
        }

        // If no English name, return the first available name
        return vernacularData.results[0].vernacularName
      }

      return null
    } catch (error) {
      console.error(`Error fetching common name for ${scientificName}:`, error)
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
          !commonNames[species.scientificName]
      )

      if (missingCommonNames.length === 0) return

      const newCommonNames = { ...commonNames }

      // Fetch common names for species with missing common names
      await Promise.all(
        missingCommonNames.map(async (species) => {
          const commonName = await fetchCommonName(species.scientificName)
          if (commonName) {
            newCommonNames[species.scientificName] = commonName
          }
        })
      )

      setCommonNames(newCommonNames)
    }

    fetchMissingCommonNames()
  }, [data, taxonomicData])

  if (!data || data.length === 0) {
    return <div className="text-gray-500">No species data available</div>
  }

  return (
    <div className="w-1/2 bg-white rounded border border-gray-200 p-3 overflow-y-auto">
      <div className="space-y-4">
        {data.map((species, index) => {
          // Try to get the common name from the taxonomic data first, then from fetched data
          const commonName =
            scientificToCommonMap[species.scientificName] || commonNames[species.scientificName]

          return (
            <div key={index} className="">
              <div className="flex justify-between mb-1 items-center">
                <div>
                  <span className="capitalize text-sm">{commonName || species.scientificName}</span>
                  {species.scientificName && commonName !== undefined && (
                    <span className="text-gray-500 text-sm italic ml-2">
                      ({species.scientificName})
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500">{species.count}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${(species.count / totalCount) * 100}%` }}
                ></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Overview({ data, studyId }) {
  const [speciesData, setSpeciesData] = useState(null)
  const [deploymentsData, setDeploymentsData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [importStatus, setImportStatus] = useState({ isRunning: false, pausedCount: 0, done: 0 })
  const contributorsRef = useRef(null)

  // Check import status periodically if this is an imported study
  useEffect(() => {
    let intervalId

    const checkImportStatus = async () => {
      try {
        console.log('Checking import status for study:', studyId)
        const status = await window.api.getImportStatus(studyId)
        setImportStatus((prev) => ({ ...prev, ...status }))
      } catch (err) {
        console.error('Failed to get import status:', err)
      }
    }

    if (!importStatus.isRunning) {
      // If import is not running, no need to check status
      clearInterval(intervalId)
      return
    }

    intervalId = setInterval(checkImportStatus, 1000)

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [importStatus.isRunning, studyId])

  useEffect(() => {
    const fetchImportStatus = async () => {
      const status = await window.api.getImportStatus(studyId)
      setImportStatus((prev) => ({ ...prev, ...status }))
    }

    fetchImportStatus()
  }, [studyId])

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true)

        // Fetch both species and deployments data in parallel
        const [speciesResponse, deploymentsResponse] = await Promise.all([
          window.api.getSpeciesDistribution(studyId),
          window.api.getDeployments(studyId)
        ])

        // Check for errors
        if (speciesResponse.error) {
          setError(speciesResponse.error)
        } else {
          setSpeciesData(speciesResponse.data)
        }

        if (deploymentsResponse.error) {
          console.error('Deployments error:', deploymentsResponse.error)
          // Don't set main error if species data was successful
        } else {
          console.log('Deployments response:', deploymentsResponse)
          setDeploymentsData(deploymentsResponse.data)
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [studyId])

  // Check scroll possibility
  useEffect(() => {
    if (!contributorsRef.current) return

    const checkScroll = () => {
      const container = contributorsRef.current
      setCanScrollLeft(container.scrollLeft > 0)
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 5)
    }

    const container = contributorsRef.current
    container.addEventListener('scroll', checkScroll)
    // Initial check
    checkScroll()

    // Check again if window resizes
    window.addEventListener('resize', checkScroll)

    return () => {
      container?.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [data.contributors])

  const scrollContributors = (direction) => {
    if (!contributorsRef.current) return

    const container = contributorsRef.current
    const scrollAmount = container.clientWidth * 0.75 // Scroll by 75% of visible width

    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    })
  }

  const toggleDescription = () => {
    setIsDescriptionExpanded(!isDescriptionExpanded)
  }

  const taxonomicData = data.taxonomic || null

  // Render import progress when an import is in progress
  const renderImportProgress = () => {
    if (!importStatus || importStatus.total <= 0 || importStatus.total === importStatus.done)
      return null

    const progress = (importStatus.done / importStatus.total) * 100

    const handlePause = async () => {
      try {
        setImportStatus((prev) => ({
          ...prev,
          isRunning: false
        }))
        window.api.stopImport(studyId)
      } catch (err) {
        console.error('Failed to pause import:', err)
      }
    }

    const handleResume = async () => {
      try {
        console.log('Resuming import for study:', studyId)
        setImportStatus((prev) => ({
          ...prev,
          isRunning: true,
          pausedCount: prev.done
        }))
        window.api.resumeImport(studyId)
      } catch (err) {
        console.error('Failed to resume import:', err)
      }
    }

    return (
      <div className="text-gray-500 text-sm mt-2 max-w-xl">
        <div className="bg-blue-50 rounded-lg p-4 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 rounded-full p-2">
              <svg
                className={`w-6 h-6 text-blue-600 ${importStatus.isRunning ? 'animate-pulse' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                ></path>
              </svg>
            </div>
            <div className="flex-grow">
              <div className="text-gray-700 font-medium">Importing study data</div>
              <div className="text-xs text-gray-500">
                {importStatus.done} of {importStatus.total} images processed
              </div>
            </div>
            {importStatus.isRunning ? (
              importStatus.pausedCount + 1 > importStatus.done ? (
                <button
                  onClick={handlePause}
                  className="text-xs px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 rounded border border-gray-300 font-medium "
                >
                  Starting...
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="text-xs px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 rounded border border-gray-300 font-medium "
                >
                  Pause
                </button>
              )
            ) : (
              <button
                onClick={handleResume}
                className="text-xs px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded font-medium "
              >
                Resume
              </button>
            )}
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-500 ease-in-out"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      </div>
    )
  }

  // Temporal data is always shown when available
  const renderTemporalData = () => {
    if (!importStatus || !data.temporal) return null
    if (importStatus.done === importStatus.total && data.temporal) {
      return (
        <div className="text-gray-500 text-sm max-w-prose mb-2">
          {data.temporal.start} to {data.temporal.end}
          {importStatus && importStatus.total > 0 && importStatus.done < importStatus.total && (
            <span className="text-xs italic ml-2">(May be incomplete until import finishes)</span>
          )}
        </div>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col px-4 gap-4 h-full">
      <header className="flex flex-col">
        <div className="flex gap-2">
          <a
            target="_blank"
            rel="noopener noreferrer"
            href={data.homepage}
            className="max-w-prose text-balance font-medium"
          >
            {data.title || data?.project?.title}
          </a>
        </div>
        {renderTemporalData()}
        {renderImportProgress()}
        {data.description && (
          <div className="relative">
            <div
              className={`text-gray-800 text-sm max-w-prose ${
                !isDescriptionExpanded ? 'line-clamp-5 overflow-hidden' : ''
              }`}
            >
              {data.description}
            </div>
            <button
              onClick={toggleDescription}
              className="text-gray-500 text-xs flex items-center hover:text-blue-700 transition-colors"
            >
              {isDescriptionExpanded ? (
                <>
                  <span>Show less</span>
                  <ChevronUp size={16} className="ml-1" />
                </>
              ) : (
                <>
                  <span>Show more</span>
                  <ChevronDown size={16} className="ml-1" />
                </>
              )}
            </button>
          </div>
        )}
      </header>

      {data.contributors && data.contributors.length > 0 && (
        <div className="relative">
          {/* Left scroll button */}
          {canScrollLeft && (
            <button
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 rounded-full p-1 shadow-md border border-gray-200"
              onClick={() => scrollContributors('left')}
              aria-label="Scroll left"
            >
              <ChevronLeft size={20} />
            </button>
          )}

          {/* Right scroll button */}
          {canScrollRight && (
            <button
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 rounded-full p-1 shadow-md border border-gray-200"
              onClick={() => scrollContributors('right')}
              aria-label="Scroll right"
            >
              <ChevronRight size={20} />
            </button>
          )}

          {/* Left fade effect */}
          {canScrollLeft && (
            <div className="absolute left-0 top-0 h-full w-12 bg-gradient-to-r from-white to-transparent z-[1] pointer-events-none"></div>
          )}

          {/* Right fade effect */}
          {canScrollRight && (
            <div className="absolute right-0 top-0 h-full w-12 bg-gradient-to-l from-white to-transparent z-[1] pointer-events-none"></div>
          )}

          <div
            ref={contributorsRef}
            className="flex overflow-x-auto gap-4 scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {data.contributors.map((contributor, index) => (
              <div
                key={index}
                className="flex flex-col flex-shrink-0 w-64 p-4 border border-gray-200 rounded-md shadow-sm bg-white"
              >
                <div className="">
                  {contributor.title || `${contributor.firstName} ${contributor.lastName}`}
                </div>
                <div className="text-sm text-gray-600">
                  {contributor.role &&
                    contributor.role
                      .replace(/([A-Z])/g, ' $1')
                      .replace(/^./, (str) => str.toUpperCase())}
                </div>
                {contributor.organization && (
                  <div className="text-sm text-gray-500 mt-2 mb-2 line-clamp-2 overflow-hidden relative">
                    {contributor.organization}
                    <div className="absolute bottom-0 right-0 bg-gradient-to-l from-white to-transparent w-8 h-4"></div>
                  </div>
                )}
                {contributor.email && (
                  <div className="text-sm text-blue-500 mt-2 truncate mt-auto">
                    <a
                      target="_blank"
                      rel="noopener noreferrer"
                      href={`mailto:${contributor.email}`}
                    >
                      {contributor.email}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-4">Loading data...</div>
      ) : error ? (
        <div className="text-red-500 py-4">Error: {error}</div>
      ) : (
        <>
          <div className="flex flex-row gap-4 flex-1 min-h-0 mt-2">
            <SpeciesDistribution data={speciesData} taxonomicData={taxonomicData} />
            <DeploymentMap deployments={deploymentsData} />
          </div>
        </>
      )}
    </div>
  )
}
