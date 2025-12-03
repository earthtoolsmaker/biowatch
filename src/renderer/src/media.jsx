import { CameraOff, X, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import CircularTimeFilter, { DailyActivityRadar } from './ui/clock'
import SpeciesDistribution from './ui/speciesDistribution'
import TimelineChart from './ui/timeseries'

function ImageModal({
  isOpen,
  onClose,
  media,
  constructImageUrl,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  studyId
}) {
  const [showBboxes, setShowBboxes] = useState(true)

  const { data: bboxes = [] } = useQuery({
    queryKey: ['mediaBboxes', studyId, media?.mediaID],
    queryFn: async () => {
      const response = await window.api.getMediaBboxes(studyId, media.mediaID)
      if (response.data) {
        return response.data
      }
      return []
    },
    enabled: isOpen && !!media?.mediaID && !!studyId
  })

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft' && hasPrevious) {
        onPrevious()
      } else if (e.key === 'ArrowRight' && hasNext) {
        onNext()
      } else if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'b' || e.key === 'B') {
        // Toggle bboxes with 'b' key
        setShowBboxes((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onNext, onPrevious, onClose, hasNext, hasPrevious])

  if (!isOpen || !media) return null

  const hasBboxes = bboxes.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div className="relative max-w-7xl w-full h-full flex items-center justify-center">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-0 right-0 z-10 bg-white rounded-full p-2 hover:bg-gray-100 transition-colors"
          aria-label="Close modal"
        >
          <X size={24} />
        </button>

        {/* Bbox toggle button */}
        {hasBboxes && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowBboxes((prev) => !prev)
            }}
            className={`absolute top-0 right-12 z-10 rounded-full p-2 transition-colors ${showBboxes ? 'bg-lime-500 text-white hover:bg-lime-600' : 'bg-white hover:bg-gray-100'}`}
            aria-label={showBboxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
            title={`${showBboxes ? 'Hide' : 'Show'} bounding boxes (B)`}
          >
            <Square size={24} />
          </button>
        )}

        <div
          className="bg-white rounded-lg overflow-hidden shadow-2xl max-h-[90vh] flex flex-col max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-center bg-gray-100 overflow-hidden relative">
            <img
              src={constructImageUrl(media.filePath)}
              alt={media.fileName || `Media ${media.mediaID}`}
              className="max-w-full max-h-[calc(90vh-120px)] w-auto h-auto object-contain"
            />
            {/* Bbox overlay */}
            {showBboxes && hasBboxes && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
              >
                {bboxes.map((bbox, index) => (
                  <rect
                    key={bbox.observationID || index}
                    x={`${bbox.bboxX * 100}%`}
                    y={`${bbox.bboxY * 100}%`}
                    width={`${bbox.bboxWidth * 100}%`}
                    height={`${bbox.bboxHeight * 100}%`}
                    stroke="#84cc16"
                    strokeWidth="3"
                    fill="none"
                  />
                ))}
              </svg>
            )}
          </div>
          <div className="p-4 bg-white flex-shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{media.scientificName}</h3>
              {hasBboxes && (
                <span className="text-xs text-gray-400">
                  {bboxes.length} detection{bboxes.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {new Date(media.timestamp).toLocaleString()}
            </p>
            {media.fileName && (
              <p className="text-xs text-gray-400 mt-1 truncate">{media.fileName}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const palette = [
  'hsl(173 58% 39%)',
  'hsl(43 74% 66%)',
  'hsl(12 76% 61%)',
  'hsl(197 37% 24%)',
  'hsl(27 87% 67%)'
]

function Gallery({ species, dateRange, timeRange }) {
  const [mediaFiles, setMediaFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [imageErrors, setImageErrors] = useState({})
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)
  const [selectedMedia, setSelectedMedia] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const loaderRef = useRef(null)
  const PAGE_SIZE = 15
  const debounceTimeoutRef = useRef(null)

  const { id } = useParams()

  // Debounce function
  const debounce = (func, delay) => {
    return (...args) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      debounceTimeoutRef.current = setTimeout(() => {
        func(...args)
      }, delay)
    }
  }

  // Set up Intersection Observer for infinite scrolling
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !initialLoad) {
          loadMoreMedia()
        }
      },
      { threshold: 0.1 }
    )

    if (loaderRef.current) {
      observer.observe(loaderRef.current)
    }

    return () => {
      if (loaderRef.current) {
        observer.unobserve(loaderRef.current)
      }
    }
  }, [hasMore, loading, initialLoad, loaderRef])

  // Create a memoized version of loadMedia to avoid recreating on each render
  const loadMedia = useCallback(
    async (pageNum, isNewSearch = false) => {
      try {
        setLoading(true)

        console.log(
          'Fetching media files for species:',
          species,
          dateRange,
          timeRange,
          'page:',
          pageNum
        )
        const response = await window.api.getMedia(id, {
          species,
          dateRange: { start: dateRange[0], end: dateRange[1] },
          timeRange,
          limit: PAGE_SIZE,
          offset: (pageNum - 1) * PAGE_SIZE
        })

        if (response.error) {
          console.warn('Error fetching media files:', response.error)
        } else {
          if (isNewSearch) {
            setMediaFiles(response.data)
          } else {
            setMediaFiles((prev) => [...prev, ...response.data])
          }

          setHasMore(response.data.length === PAGE_SIZE)
        }
      } catch (err) {
        console.warn(err)
      } finally {
        setLoading(false)
        setInitialLoad(false)
      }
    },
    [id, species, dateRange, timeRange]
  )

  // Create a debounced version of loadMedia
  const debouncedLoadMedia = useMemo(
    () => debounce((pageNum, isNewSearch) => loadMedia(pageNum, isNewSearch), 100),
    [loadMedia]
  )

  useEffect(() => {
    // Reset pagination when filters change
    // setMediaFiles([])
    setPage(1)
    setHasMore(true)
    setInitialLoad(true)

    if (!dateRange[0] || !dateRange[1]) return

    debouncedLoadMedia(1, true)
  }, [species, dateRange, timeRange, id, debouncedLoadMedia])

  const loadMoreMedia = () => {
    if (!loading && hasMore) {
      const nextPage = page + 1
      setPage(nextPage)
      loadMedia(nextPage, false)
    }
  }

  const constructImageUrl = (fullFilePath) => {
    if (fullFilePath.startsWith('http')) {
      return fullFilePath
    }

    return `local-file://get?path=${encodeURIComponent(fullFilePath)}`
  }

  const handleImageClick = (media) => {
    setSelectedMedia(media)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedMedia(null)
  }

  const handleNextImage = () => {
    if (!selectedMedia) return
    const currentIndex = mediaFiles.findIndex((m) => m.mediaID === selectedMedia.mediaID)
    if (currentIndex < mediaFiles.length - 1) {
      setSelectedMedia(mediaFiles[currentIndex + 1])
    }
  }

  const handlePreviousImage = () => {
    if (!selectedMedia) return
    const currentIndex = mediaFiles.findIndex((m) => m.mediaID === selectedMedia.mediaID)
    if (currentIndex > 0) {
      setSelectedMedia(mediaFiles[currentIndex - 1])
    }
  }

  const currentIndex = selectedMedia
    ? mediaFiles.findIndex((m) => m.mediaID === selectedMedia.mediaID)
    : -1
  const hasNext = currentIndex >= 0 && currentIndex < mediaFiles.length - 1
  const hasPrevious = currentIndex > 0

  return (
    <>
      <ImageModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        media={selectedMedia}
        constructImageUrl={constructImageUrl}
        onNext={handleNextImage}
        onPrevious={handlePreviousImage}
        hasNext={hasNext}
        hasPrevious={hasPrevious}
        studyId={id}
      />
      <div className="flex flex-wrap gap-[12px] h-full overflow-auto">
        {mediaFiles.map((media) => (
          <div
            key={media.mediaID}
            className="border border-gray-300 rounded-lg overflow-hidden min-w-[200px] w-[calc(33%-7px)] flex flex-col h-max"
          >
            <div
              className="bg-gray-100 flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors"
              onClick={() => handleImageClick(media)}
            >
              <img
                src={constructImageUrl(media.filePath)}
                alt={media.fileName || `Media ${media.mediaID}`}
                data-image={media.filePath}
                className={`object-contain w-full h-auto min-h-20 ${imageErrors[media.mediaID] ? 'hidden' : ''}`}
                onError={() => {
                  setImageErrors((prev) => ({ ...prev, [media.mediaID]: true }))
                }}
                loading="lazy"
              />
              {imageErrors[media.mediaID] && (
                <div
                  className="flex items-center justify-center w-full h-full bg-gray-100 text-gray-400 flex-1"
                  title={`Image not available or failed to load because it's not public or has been deleted/moved locally ${media.filePath}`}
                >
                  <CameraOff size={32} />
                </div>
              )}
            </div>
            <div className="p-2">
              <h3 className="text-sm font-semibold truncate">{media.scientificName}</h3>
              <p className="text-xs text-gray-500">{new Date(media.timestamp).toLocaleString()}</p>
            </div>
          </div>
        ))}

        {/* Loading indicator and intersection target */}
        <div ref={loaderRef} className="w-full flex justify-center p-4">
          {loading && !initialLoad && (
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
              <span className="ml-2">Loading more...</span>
            </div>
          )}
          {!hasMore && mediaFiles.length > 0 && (
            <p className="text-gray-500 text-sm">No more images to load</p>
          )}
          {!hasMore && mediaFiles.length === 0 && !loading && (
            <p className="text-gray-500">No media files match the selected filters</p>
          )}
        </div>
      </div>
    </>
  )
}

export default function Activity({ studyData, studyId }) {
  const { id } = useParams()
  const actualStudyId = studyId || id // Use passed studyId or from params

  const [error, setError] = useState(null)
  const [selectedSpecies, setSelectedSpecies] = useState([])
  const [dateRange, setDateRange] = useState([null, null])
  const [timeRange, setTimeRange] = useState({ start: 0, end: 24 })
  const [timeseriesData, setTimeseriesData] = useState(null)
  const [speciesDistributionData, setSpeciesDistributionData] = useState(null)
  const [dailyActivityData, setDailyActivityData] = useState(null)

  const taxonomicData = studyData?.taxonomic || null

  useEffect(() => {
    async function fetchData() {
      try {
        const speciesResponse = await window.api.getSpeciesDistribution(actualStudyId)

        if (speciesResponse.error) {
          setError(speciesResponse.error)
        } else {
          setSpeciesDistributionData(speciesResponse.data)
          setSelectedSpecies(speciesResponse.data.slice(0, 2))
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch activity data')
      }
    }

    if (actualStudyId) {
      fetchData()
    }
  }, [actualStudyId])

  useEffect(() => {
    async function fetchTimeseriesData() {
      if (!selectedSpecies.length || !actualStudyId) return

      try {
        const speciesNames = selectedSpecies.map((s) => s.scientificName)
        const response = await window.api.getSpeciesTimeseries(actualStudyId, speciesNames)

        if (response.error) {
          console.error('Error fetching species timeseries:', response.error)
          return
        }

        setTimeseriesData(response.data.timeseries)
      } catch (err) {
        console.error('Failed to fetch species timeseries:', err)
      }
    }

    fetchTimeseriesData()
  }, [selectedSpecies, actualStudyId])

  useEffect(() => {
    if (
      timeseriesData &&
      timeseriesData.length > 0 &&
      dateRange[0] === null &&
      dateRange[1] === null
    ) {
      const totalPeriods = timeseriesData.length
      const startIndex = Math.max(totalPeriods - Math.max(Math.ceil(totalPeriods * 0.3), 2), 0)
      const endIndex = totalPeriods - 1

      let startDate = new Date(timeseriesData[startIndex].date)
      let endDate = new Date(timeseriesData[endIndex].date)

      // Ensure a minimum range of 1 day if dates are the same
      // if (startDate.getTime() === endDate.getTime()) {
      //   endDate = new Date(startDate)
      //   endDate.setDate(endDate.getDate() + 1) // Add one day to end date
      // }

      setDateRange([startDate, endDate])
    }
  }, [timeseriesData])

  console.log('dateRange', dateRange)

  useEffect(() => {
    async function fetchDailyActivityData() {
      if (!selectedSpecies.length || !dateRange[0] || !dateRange[1]) return

      try {
        const speciesNames = selectedSpecies.map((s) => s.scientificName)
        const response = await window.api.getSpeciesDailyActivity(
          actualStudyId,
          speciesNames,
          dateRange[0].toISOString(),
          dateRange[1].toISOString()
        )

        if (response.error) {
          console.error('Error fetching daily activity data:', response.error)
          return
        }

        setDailyActivityData(response.data)
      } catch (err) {
        console.error('Failed to fetch daily activity data:', err)
      }
    }

    fetchDailyActivityData()
  }, [dateRange, selectedSpecies, actualStudyId])

  // Handle time range changes
  const handleTimeRangeChange = useCallback((newTimeRange) => {
    setTimeRange(newTimeRange)
  }, [])

  // Handle species selection changes
  const handleSpeciesChange = useCallback((newSelectedSpecies) => {
    // Ensure we have at least one species selected
    if (newSelectedSpecies.length === 0) {
      return
    }
    setSelectedSpecies(newSelectedSpecies)
  }, [])

  return (
    <div className="px-4 flex flex-col h-full">
      {error ? (
        <div className="text-red-500 py-4">Error: {error}</div>
      ) : (
        <div className="flex flex-col h-full gap-4">
          {/* First row - takes remaining space */}
          <div className="flex flex-row gap-4 flex-1 min-h-0">
            {/* Species Distribution - left side */}

            {/* Map - right side */}
            <div className="h-full flex-1">
              <Gallery
                species={selectedSpecies.map((s) => s.scientificName)}
                dateRange={dateRange}
                timeRange={timeRange}
              />
            </div>
            <div className="h-full overflow-auto w-xs">
              {speciesDistributionData && (
                <SpeciesDistribution
                  data={speciesDistributionData}
                  taxonomicData={taxonomicData}
                  selectedSpecies={selectedSpecies}
                  onSpeciesChange={handleSpeciesChange}
                  palette={palette}
                />
              )}
            </div>
          </div>

          {/* Second row - fixed height with timeline and clock */}
          <div className="w-full flex h-[130px] flex-shrink-0 gap-3">
            <div className="w-[140px] h-full rounded border border-gray-200 flex items-center justify-center relative">
              <DailyActivityRadar
                activityData={dailyActivityData}
                selectedSpecies={selectedSpecies}
                palette={palette}
              />
              <div className="absolute w-full h-full flex items-center justify-center">
                <CircularTimeFilter
                  onChange={handleTimeRangeChange}
                  startTime={timeRange.start}
                  endTime={timeRange.end}
                />
              </div>
            </div>
            <div className="flex-grow rounded px-2 border border-gray-200">
              <TimelineChart
                timeseriesData={timeseriesData}
                selectedSpecies={selectedSpecies}
                dateRange={dateRange}
                setDateRange={setDateRange}
                palette={palette}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
