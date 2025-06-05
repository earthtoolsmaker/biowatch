import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Combobox,
  ComboboxInput,
  ComboboxButton,
  ComboboxOptions,
  ComboboxOption
} from '@headlessui/react'
import { CheckIcon, CameraOff } from 'lucide-react'
import { useParams } from 'react-router'
import CircularTimeFilter, { DailyActivityRadar } from './ui/clock'
import SpeciesDistribution from './ui/speciesDistribution'
import TimelineChart from './ui/timeseries'

const palette = [
  'hsl(173 58% 39%)',
  'hsl(43 74% 66%)',
  'hsl(12 76% 61%)',
  'hsl(197 37% 24%)',
  'hsl(27 87% 67%)'
]

// Add the SpeciesFilter component
const SpeciesFilter = ({ speciesList, selectedSpecies, onChange }) => {
  const [query, setQuery] = useState('')

  const filteredSpecies =
    query === ''
      ? speciesList
      : speciesList.filter((item) =>
          item.scientificName.toLowerCase().includes(query.toLowerCase())
        )

  return (
    <div className="w-48 relative">
      <Combobox value={selectedSpecies} onChange={onChange} immediate>
        <div className="relative w-full cursor-default overflow-hidden rounded-lg bg-white text-left shadow-md border border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-opacity-75 focus-visible:ring-offset-2 sm:text-sm">
          <ComboboxInput
            className="w-full border-none py-2 pl-3 pr-10 text-sm leading-5 text-gray-900 focus:ring-0 outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by species"
            displayValue={(species) => (species ? species.scientificName : 'All Species')}
          />
          <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5 text-gray-400"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9"
              />
            </svg>
          </ComboboxButton>
        </div>
        <ComboboxOptions className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm z-10">
          {filteredSpecies.map((species) => (
            <ComboboxOption
              key={species.scientificName}
              value={species}
              className="group flex cursor-default items-center gap-2 rounded-lg py-1.5 px-3 select-none data-[focus]:bg-gray-100"
            >
              <div className="text-sm/6 text-gray-800">
                {species.scientificName} ({species.count})
              </div>
              <CheckIcon className="ml-4 invisible size-4 fill-white group-data-[selected]:visible" />
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </Combobox>
    </div>
  )
}

function Gallery({ species, dateRange, timeRange }) {
  const [mediaFiles, setMediaFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [imageErrors, setImageErrors] = useState({})
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)
  const loaderRef = useRef(null)
  const PAGE_SIZE = 15
  const debounceTimeoutRef = useRef(null)

  const { id } = useParams()
  const study = JSON.parse(localStorage.getItem('studies')).find((study) => study.id === id)

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
          setError(response.error)
        } else {
          if (isNewSearch) {
            setMediaFiles(response.data)
          } else {
            setMediaFiles((prev) => [...prev, ...response.data])
          }

          setHasMore(response.data.length === PAGE_SIZE)
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch media files')
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
    const filePathParts = fullFilePath.split('/')
    const filePath = filePathParts.slice(1).join('/')
    const fullPath = `${study.path}/${filePath}`
    const urlPath = fullPath.replace(/\\/g, '/')

    return `local-file://get?path=${encodeURIComponent(fullFilePath)}`
  }

  console.log('mediaFiles', mediaFiles)

  return (
    <div className="flex flex-wrap gap-[12px] h-full overflow-auto">
      {mediaFiles.map((media) => (
        <div
          key={media.mediaID}
          className="border border-gray-300 rounded-lg overflow-hidden min-w-[200px] w-[calc(33%-7px)] flex flex-col h-max"
        >
          <div className="bg-gray-100 flex items-center justify-center">
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
  )
}

export default function Activity({ studyData, studyId }) {
  const { id } = useParams()
  const actualStudyId = studyId || id // Use passed studyId or from params

  const [, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedSpecies, setSelectedSpecies] = useState([])
  const [dateRange, setDateRange] = useState([null, null])
  const [timeRange, setTimeRange] = useState({ start: 0, end: 24 })
  const [timeseriesData, setTimeseriesData] = useState(null)
  const [speciesDistributionData, setSpeciesDistributionData] = useState(null)
  const [dailyActivityData, setDailyActivityData] = useState(null)

  // Get taxonomic data from studyData
  const taxonomicData = studyData?.taxonomic || null

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true)

        const response = await window.api.getTopSpeciesTimeseries(actualStudyId)
        const speciesResponse = await window.api.getSpeciesDistribution(actualStudyId)

        if (response.error) {
          setError(response.error)
        } else {
          setTimeseriesData(response.data.timeseries)

          // Default select the top 2 species
          setSelectedSpecies(response.data.allSpecies.slice(0, 2))
        }

        if (speciesResponse.error) {
          console.error('Error fetching species distribution:', speciesResponse.error)
        } else {
          setSpeciesDistributionData(speciesResponse.data)
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch activity data')
      } finally {
        setLoading(false)
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
