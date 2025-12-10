import { useEffect, useState, useRef, useMemo } from 'react'
import ReactDOMServer from 'react-dom/server'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import {
  Camera,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Check,
  X,
  Plus,
  Trash2,
  MapPin
} from 'lucide-react'
import PlaceholderMap from './ui/PlaceholderMap'
import { useImportStatus } from '@renderer/hooks/import'
import { useQueryClient, useQuery, useQueries } from '@tanstack/react-query'
import DateTimePicker from './ui/DateTimePicker'

// Contributor roles per camtrap-dp spec
const CONTRIBUTOR_ROLES = [
  { value: 'contact', label: 'Contact' },
  { value: 'principalInvestigator', label: 'Principal Investigator' },
  { value: 'rightsHolder', label: 'Rights Holder' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'author', label: 'Author' }
]

function DeploymentMap({ deployments, studyId }) {
  if (!deployments || deployments.length === 0) {
    return (
      <PlaceholderMap
        title="No Deployment Data"
        description="Deployment data will appear here once image classification begins. This may take up to 30 seconds after starting a run."
        icon={MapPin}
        studyId={studyId}
      />
    )
  }

  // Filter to include only deployments with valid coordinates
  const validDeployments = deployments.filter(
    (deployment) => deployment.latitude && deployment.longitude
  )

  if (validDeployments.length === 0) {
    return (
      <PlaceholderMap
        title="No Geographic Coordinates"
        description="Set up deployment coordinates in the Deployments tab to see camera trap locations on this map."
        linkTo="/deployments"
        linkText="Go to Deployments"
        icon={MapPin}
        studyId={studyId}
      />
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
        key={studyId}
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

// Helper function to fetch common name from GBIF API
async function fetchGbifCommonName(scientificName) {
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

// Export SpeciesDistribution so it can be imported in activity.jsx
function SpeciesDistribution({ data, taxonomicData }) {
  const totalCount = data.reduce((sum, item) => sum + item.count, 0)

  // Create a map of scientific names to common names from taxonomic data
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

  // Find species that need GBIF lookup (not in taxonomic data)
  const speciesNeedingLookup = useMemo(() => {
    if (!data) return []
    return data
      .filter((species) => species.scientificName && !scientificToCommonMap[species.scientificName])
      .map((species) => species.scientificName)
  }, [data, scientificToCommonMap])

  // Use useQueries to fetch common names for all species that need lookup
  const gbifQueries = useQueries({
    queries: speciesNeedingLookup.map((scientificName) => ({
      queryKey: ['gbifCommonName', scientificName],
      queryFn: () => fetchGbifCommonName(scientificName),
      staleTime: 1000 * 60 * 60 * 24, // 24 hours - common names rarely change
      retry: 1
    }))
  })

  // Build a map of GBIF common names from query results
  const gbifCommonNames = useMemo(() => {
    const map = {}
    speciesNeedingLookup.forEach((name, index) => {
      const query = gbifQueries[index]
      if (query.data) {
        map[name] = query.data
      }
    })
    return map
  }, [speciesNeedingLookup, gbifQueries])

  if (!data || data.length === 0) {
    return <div className="text-gray-500">No species data available</div>
  }

  return (
    <div className="w-1/2 bg-white rounded border border-gray-200 p-3 overflow-y-auto">
      <div className="space-y-4">
        {data.map((species) => {
          // Try to get the common name from the taxonomic data first, then from GBIF query results
          const commonName =
            scientificToCommonMap[species.scientificName] || gbifCommonNames[species.scientificName]

          return (
            <div key={species.scientificName} className="">
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

export default function Overview({ data, studyId, studyName }) {
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const { importStatus } = useImportStatus(studyId)

  // Use useQuery for deployments data - automatically handles caching per studyId
  const { data: deploymentsData, error: deploymentsError } = useQuery({
    queryKey: ['deployments', studyId],
    queryFn: async () => {
      const response = await window.api.getDeployments(studyId)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    enabled: !!studyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false
  })

  // Use useQuery for species data - automatically handles caching per studyId
  const { data: speciesData, error: speciesError } = useQuery({
    queryKey: ['species', studyId],
    queryFn: async () => {
      const response = await window.api.getSpeciesDistribution(studyId)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    enabled: !!studyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false
  })

  const error = speciesError?.message || deploymentsError?.message || null

  // Description editing state
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [editedDescription, setEditedDescription] = useState('')

  // Temporal dates editing state
  const [showStartDatePicker, setShowStartDatePicker] = useState(false)
  const [showEndDatePicker, setShowEndDatePicker] = useState(false)

  // Contributors editing state
  const [editingContributorIndex, setEditingContributorIndex] = useState(null)
  const [editedContributor, setEditedContributor] = useState(null)
  const [isAddingContributor, setIsAddingContributor] = useState(false)
  const [deletingContributorIndex, setDeletingContributorIndex] = useState(null)
  const [newContributor, setNewContributor] = useState({
    title: '',
    role: '',
    organization: '',
    email: ''
  })

  const contributorsRef = useRef(null)
  const addContributorRef = useRef(null)
  const editingContributorRef = useRef(null)
  const descriptionRef = useRef(null)
  const titleEditRef = useRef(null)
  const descriptionEditRef = useRef(null)
  const [isDescriptionTruncated, setIsDescriptionTruncated] = useState(false)
  const queryClient = useQueryClient()

  // Compute min/max dates from deployments for pre-populating date pickers
  // Excludes timestamps within last 24 hours (likely media without EXIF data defaulting to "now")
  const { minDeploymentDate, maxDeploymentDate } = useMemo(() => {
    if (!deploymentsData || deploymentsData.length === 0) {
      return { minDeploymentDate: null, maxDeploymentDate: null }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    let minDate = null
    let maxDate = null

    deploymentsData.forEach((deployment) => {
      if (deployment.deploymentStart) {
        const startDate = new Date(deployment.deploymentStart)
        if (startDate < oneDayAgo && (!minDate || startDate < minDate)) {
          minDate = startDate
        }
      }
      if (deployment.deploymentEnd) {
        const endDate = new Date(deployment.deploymentEnd)
        if (endDate < oneDayAgo && (!maxDate || endDate > maxDate)) {
          maxDate = endDate
        }
      }
    })

    return {
      minDeploymentDate: minDate ? minDate.toISOString().split('T')[0] : null,
      maxDeploymentDate: maxDate ? maxDate.toISOString().split('T')[0] : null
    }
  }, [deploymentsData])

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
  }, [data?.contributors])

  // Check if description is truncated (overflow hidden with line-clamp)
  useEffect(() => {
    if (!descriptionRef.current || isEditingDescription) {
      setIsDescriptionTruncated(false)
      return
    }

    const checkTruncation = () => {
      const element = descriptionRef.current
      if (element) {
        setIsDescriptionTruncated(element.scrollHeight > element.clientHeight)
      }
    }

    checkTruncation()
    window.addEventListener('resize', checkTruncation)
    return () => window.removeEventListener('resize', checkTruncation)
  }, [data?.description, isDescriptionExpanded, isEditingDescription])

  // Handle click outside to close add contributor form
  useEffect(() => {
    if (!isAddingContributor) return

    const handleClickOutside = (e) => {
      if (addContributorRef.current && !addContributorRef.current.contains(e.target)) {
        cancelAddingContributor()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isAddingContributor])

  // Handle click outside to close editing contributor form
  useEffect(() => {
    if (editingContributorIndex === null) return

    const handleClickOutside = (e) => {
      if (editingContributorRef.current && !editingContributorRef.current.contains(e.target)) {
        cancelEditingContributor()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [editingContributorIndex])

  // Handle click outside to save and close title editing
  useEffect(() => {
    if (!isEditingTitle) return

    const handleClickOutside = (e) => {
      if (titleEditRef.current && !titleEditRef.current.contains(e.target)) {
        saveTitle()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isEditingTitle, editedTitle, studyName])

  // Handle click outside to save and Escape key to cancel description editing
  useEffect(() => {
    if (!isEditingDescription) return

    const handleClickOutside = (e) => {
      if (descriptionEditRef.current && !descriptionEditRef.current.contains(e.target)) {
        saveDescription()
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        cancelEditingDescription()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isEditingDescription, editedDescription, data, studyId])

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

  const startEditingTitle = () => {
    setEditedTitle(studyName)
    setIsEditingTitle(true)
  }

  const cancelEditingTitle = () => {
    setIsEditingTitle(false)
    setEditedTitle('')
  }

  const saveTitle = async () => {
    if (editedTitle.trim() && editedTitle !== studyName) {
      await window.api.updateStudy(studyId, { name: editedTitle.trim() })

      // Invalidate both study and studies cache to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['study'] })
      queryClient.invalidateQueries({ queryKey: ['studies'] })
    }
    setIsEditingTitle(false)
    setEditedTitle('')
  }

  const handleTitleKeyPress = (e) => {
    if (e.key === 'Enter') {
      saveTitle()
    } else if (e.key === 'Escape') {
      cancelEditingTitle()
    }
  }

  // Description editing handlers
  const startEditingDescription = () => {
    setEditedDescription(data?.description || '')
    setIsEditingDescription(true)
  }

  const cancelEditingDescription = () => {
    setIsEditingDescription(false)
    setEditedDescription('')
  }

  const saveDescription = async () => {
    try {
      await window.api.updateStudy(studyId, {
        data: { ...data, description: editedDescription.trim() }
      })
      queryClient.invalidateQueries({ queryKey: ['study'] })
    } catch (error) {
      console.error('Error saving description:', error)
    } finally {
      setIsEditingDescription(false)
      setEditedDescription('')
    }
  }

  const handleDescriptionKeyPress = (e) => {
    if (e.key === 'Escape') {
      cancelEditingDescription()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      saveDescription()
    }
  }

  // Temporal dates editing handlers
  const handleDateSave = async (type, isoTimestamp) => {
    try {
      const dateOnly = isoTimestamp.split('T')[0]
      const newTemporal = { ...(data?.temporal || {}) }
      if (type === 'start') {
        newTemporal.start = dateOnly
        setShowStartDatePicker(false)
      } else {
        newTemporal.end = dateOnly
        setShowEndDatePicker(false)
      }

      await window.api.updateStudy(studyId, {
        data: { ...data, temporal: newTemporal }
      })
      queryClient.invalidateQueries({ queryKey: ['study'] })
    } catch (error) {
      console.error('Error saving date:', error)
    }
  }

  // Contributors editing handlers
  const startEditingContributor = (index) => {
    setEditingContributorIndex(index)
    setEditedContributor({ ...data.contributors[index] })
  }

  const cancelEditingContributor = () => {
    setEditingContributorIndex(null)
    setEditedContributor(null)
  }

  const saveContributor = async (index) => {
    if (!editedContributor?.title?.trim()) {
      return
    }

    try {
      const updatedContributors = [...data.contributors]
      updatedContributors[index] = {
        ...editedContributor,
        title: editedContributor.title.trim(),
        organization: editedContributor.organization?.trim() || undefined,
        email: editedContributor.email?.trim() || undefined
      }

      await window.api.updateStudy(studyId, {
        data: { ...data, contributors: updatedContributors }
      })
      queryClient.invalidateQueries({ queryKey: ['study'] })
    } catch (error) {
      console.error('Error saving contributor:', error)
    } finally {
      cancelEditingContributor()
    }
  }

  const deleteContributor = async (index) => {
    try {
      const updatedContributors = data.contributors.filter((_, i) => i !== index)

      await window.api.updateStudy(studyId, {
        data: { ...data, contributors: updatedContributors }
      })
      queryClient.invalidateQueries({ queryKey: ['study'] })
    } catch (error) {
      console.error('Error deleting contributor:', error)
    }
  }

  const cancelAddingContributor = () => {
    setIsAddingContributor(false)
    setNewContributor({ title: '', role: '', organization: '', email: '' })
  }

  const addContributor = async () => {
    if (!newContributor?.title?.trim()) {
      return
    }

    try {
      const contributorToAdd = {
        title: newContributor.title.trim(),
        role: newContributor.role || undefined,
        organization: newContributor.organization?.trim() || undefined,
        email: newContributor.email?.trim() || undefined
      }

      const updatedContributors = [...(data?.contributors || []), contributorToAdd]

      await window.api.updateStudy(studyId, {
        data: { ...data, contributors: updatedContributors }
      })
      queryClient.invalidateQueries({ queryKey: ['study'] })
    } catch (error) {
      console.error('Error adding contributor:', error)
    } finally {
      cancelAddingContributor()
    }
  }

  const taxonomicData = data?.taxonomic || null

  // Temporal data is always shown, with DateTimePicker for editing
  const renderTemporalData = () => {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm max-w-prose mb-2">
        {/* Start Date */}
        <div className="relative group flex items-center gap-1">
          <span
            className="cursor-pointer hover:text-gray-700 hover:underline"
            onClick={() => setShowStartDatePicker(true)}
          >
            {data?.temporal?.start || 'Start date'}
          </span>
          <button
            onClick={() => setShowStartDatePicker(true)}
            className="hidden group-hover:inline-flex p-0.5 hover:bg-gray-100 rounded text-gray-500"
            title="Edit start date"
          >
            <Pencil size={10} />
          </button>
          {showStartDatePicker && (
            <div className="absolute left-0 top-full mt-2 z-50">
              <DateTimePicker
                value={
                  data?.temporal?.start
                    ? `${data.temporal.start}T00:00:00`
                    : minDeploymentDate
                      ? `${minDeploymentDate}T00:00:00`
                      : new Date().toISOString()
                }
                onChange={(isoTimestamp) => handleDateSave('start', isoTimestamp)}
                onCancel={() => setShowStartDatePicker(false)}
                dateOnly
              />
            </div>
          )}
        </div>

        <span>to</span>

        {/* End Date */}
        <div className="relative group flex items-center gap-1">
          <span
            className="cursor-pointer hover:text-gray-700 hover:underline"
            onClick={() => setShowEndDatePicker(true)}
          >
            {data?.temporal?.end || 'End date'}
          </span>
          <button
            onClick={() => setShowEndDatePicker(true)}
            className="hidden group-hover:inline-flex p-0.5 hover:bg-gray-100 rounded text-gray-500"
            title="Edit end date"
          >
            <Pencil size={10} />
          </button>
          {showEndDatePicker && (
            <div className="absolute left-0 top-full mt-2 z-50">
              <DateTimePicker
                value={
                  data?.temporal?.end
                    ? `${data.temporal.end}T00:00:00`
                    : maxDeploymentDate
                      ? `${maxDeploymentDate}T00:00:00`
                      : new Date().toISOString()
                }
                onChange={(isoTimestamp) => handleDateSave('end', isoTimestamp)}
                onCancel={() => setShowEndDatePicker(false)}
                dateOnly
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col px-4 gap-4 h-full">
      <header className="flex flex-col">
        <div className="flex gap-2 items-center group">
          {isEditingTitle ? (
            <div ref={titleEditRef} className="flex items-center gap-1 flex-1">
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={handleTitleKeyPress}
                className="max-w-prose text-balance font-medium capitalize bg-transparent border-b-2 border-blue-500 focus:outline-none"
                autoFocus
              />
            </div>
          ) : (
            <>
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={data?.homepage}
                className="max-w-prose text-balance font-medium capitalize"
              >
                {studyName}
              </a>
              <button
                onClick={startEditingTitle}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-100 rounded text-gray-500 transition-opacity focus:opacity-100"
                title="Edit title"
                aria-label="Edit title"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>
        {/* Description with inline editing */}
        <div className="relative group">
          {isEditingDescription ? (
            <div ref={descriptionEditRef} className="flex flex-col gap-2">
              <textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onKeyDown={handleDescriptionKeyPress}
                className="text-gray-800 text-sm max-w-prose w-full border-2 border-blue-500 rounded p-2 focus:outline-none resize-y min-h-[100px]"
                autoFocus
                placeholder="Camera trap dataset containing deployment information, media files metadata, and species observations collected during wildlife monitoring."
              />
              <div className="flex gap-1">
                <button
                  onClick={cancelEditingDescription}
                  className="p-1 hover:bg-red-100 rounded text-red-600"
                  title="Cancel (Escape)"
                >
                  <X size={16} />
                </button>
                <button
                  onClick={saveDescription}
                  className="p-1 hover:bg-green-100 rounded text-green-600"
                  title="Save (Cmd+Enter)"
                >
                  <Check size={16} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                ref={descriptionRef}
                className={`text-gray-800 text-sm max-w-prose ${
                  !isDescriptionExpanded ? 'line-clamp-5 overflow-hidden' : ''
                }`}
              >
                {data?.description || (
                  <span className="text-gray-400 italic">
                    Camera trap dataset containing deployment information, media files metadata, and
                    species observations collected during wildlife monitoring.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {data?.description && (isDescriptionTruncated || isDescriptionExpanded) && (
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
                )}
                <button
                  onClick={startEditingDescription}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-100 rounded text-gray-500 transition-opacity focus:opacity-100"
                  title="Edit description"
                >
                  <Pencil size={12} />
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Contributors section with CRUD */}
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
          {/* Existing contributors */}
          {data?.contributors?.map((contributor, index) => (
            <div
              key={index}
              ref={editingContributorIndex === index ? editingContributorRef : null}
              className="flex flex-col flex-shrink-0 w-64 p-4 border border-gray-200 rounded-md shadow-sm bg-white group relative"
              onKeyDown={
                editingContributorIndex === index
                  ? (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveContributor(index)
                      }
                    }
                  : undefined
              }
            >
              {editingContributorIndex === index ? (
                // Edit mode
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={editedContributor?.title || ''}
                    onChange={(e) =>
                      setEditedContributor({ ...editedContributor, title: e.target.value })
                    }
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                    placeholder="Name *"
                    autoFocus
                  />
                  <select
                    value={editedContributor?.role || ''}
                    onChange={(e) =>
                      setEditedContributor({ ...editedContributor, role: e.target.value })
                    }
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                  >
                    <option value="">Select role...</option>
                    {CONTRIBUTOR_ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={editedContributor?.organization || ''}
                    onChange={(e) =>
                      setEditedContributor({ ...editedContributor, organization: e.target.value })
                    }
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                    placeholder="Organization"
                  />
                  <input
                    type="email"
                    value={editedContributor?.email || ''}
                    onChange={(e) =>
                      setEditedContributor({ ...editedContributor, email: e.target.value })
                    }
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                    placeholder="Email"
                  />
                  <div className="flex gap-1 mt-1 justify-end">
                    <button
                      onClick={cancelEditingContributor}
                      className="p-1 hover:bg-red-100 rounded text-red-600"
                      title="Cancel"
                    >
                      <X size={16} />
                    </button>
                    <button
                      onClick={() => saveContributor(index)}
                      className="p-1 hover:bg-green-100 rounded text-green-600"
                      title="Save"
                    >
                      <Check size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                // View mode
                <>
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                    <button
                      onClick={() => startEditingContributor(index)}
                      className="p-1 hover:bg-gray-100 rounded text-gray-500"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => setDeletingContributorIndex(index)}
                      className="p-1 hover:bg-red-100 rounded text-red-500"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
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
                </>
              )}
            </div>
          ))}

          {/* Add contributor card */}
          {isAddingContributor ? (
            <div
              ref={addContributorRef}
              className="flex flex-col flex-shrink-0 w-64 p-4 border border-gray-200 rounded-md shadow-sm bg-white"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addContributor()
                } else if (e.key === 'Escape') {
                  cancelAddingContributor()
                }
              }}
            >
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  value={newContributor.title}
                  onChange={(e) => setNewContributor({ ...newContributor, title: e.target.value })}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                  placeholder="Name *"
                  autoFocus
                />
                <select
                  value={newContributor.role}
                  onChange={(e) => setNewContributor({ ...newContributor, role: e.target.value })}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">Select role...</option>
                  {CONTRIBUTOR_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newContributor.organization}
                  onChange={(e) =>
                    setNewContributor({ ...newContributor, organization: e.target.value })
                  }
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                  placeholder="Organization"
                />
                <input
                  type="email"
                  value={newContributor.email}
                  onChange={(e) => setNewContributor({ ...newContributor, email: e.target.value })}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                  placeholder="Email"
                />
                <div className="flex gap-1 mt-1 justify-end">
                  <button
                    onClick={cancelAddingContributor}
                    className="p-1 hover:bg-red-100 rounded text-red-600"
                    title="Cancel"
                  >
                    <X size={16} />
                  </button>
                  <button
                    onClick={addContributor}
                    className="p-1 hover:bg-green-100 rounded text-green-600"
                    title="Add"
                  >
                    <Check size={16} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingContributor(true)}
              className="flex flex-col items-center justify-center flex-shrink-0 w-64 p-4 border border-dashed border-gray-300 rounded-md bg-gray-50 hover:bg-gray-100 hover:border-gray-400 transition-colors"
            >
              <Plus size={24} className="text-gray-400" />
              <span className="text-sm text-gray-500 mt-1">Add contributor</span>
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="text-red-500 py-4">Error: {error}</div>
      ) : importStatus?.isRunning && importStatus?.done === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600"></div>
            <span>Loading model...</span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-row gap-4 flex-1 min-h-0 mt-2">
            {speciesData && speciesData.length > 0 && (
              <SpeciesDistribution data={speciesData} taxonomicData={taxonomicData} />
            )}
            <DeploymentMap deployments={deploymentsData} studyId={studyId} />
          </div>
        </>
      )}

      {/* Delete contributor confirmation modal */}
      {deletingContributorIndex !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
          onClick={() => setDeletingContributorIndex(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDeletingContributorIndex(null)
          }}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium mb-2">Delete Contributor</h3>
            <p className="text-gray-600 text-sm mb-4">
              Are you sure you want to delete this contributor?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeletingContributorIndex(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteContributor(deletingContributorIndex)
                  setDeletingContributorIndex(null)
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700 rounded"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
