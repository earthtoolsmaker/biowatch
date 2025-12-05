import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { LayersControl, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { useParams } from 'react-router'
import CircularTimeFilter, { DailyActivityRadar } from './ui/clock'
import PlaceholderMap from './ui/PlaceholderMap'
import SkeletonMap from './ui/SkeletonMap'
import SpeciesDistribution from './ui/speciesDistribution'
import TimelineChart from './ui/timeseries'
import { useImportStatus } from './hooks/import'

// SpeciesMap component
const SpeciesMap = ({ heatmapData, selectedSpecies, palette, geoKey }) => {
  // Function to create a pie chart icon
  const createPieChartIcon = (counts) => {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
    const size = Math.min(60, Math.max(10, Math.sqrt(total) * 3)) // Scale dot size based on count

    const createSVG = () => {
      // Create SVG for pie chart
      const svgNS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(svgNS, 'svg')
      svg.setAttribute('width', size)
      svg.setAttribute('height', size)
      svg.setAttribute('viewBox', `0 0 100 100`)

      // Add a circle background - only needed for multiple species
      if (Object.keys(counts).length > 1) {
        const circle = document.createElementNS(svgNS, 'circle')
        circle.setAttribute('cx', '50')
        circle.setAttribute('cy', '50')
        circle.setAttribute('r', '50')
        circle.setAttribute('fill', 'white')
        svg.appendChild(circle)
      }

      // Draw pie slices
      let startAngle = 0
      const colors = selectedSpecies.map((_, i) => palette[i % palette.length])

      // Use the same radius for pie slices as for the circle
      const radius = 50

      // Special case for single species - draw a full circle
      if (Object.keys(counts).length === 1) {
        const species = Object.keys(counts)[0]
        const index = selectedSpecies.findIndex((s) => s.scientificName === species)
        const colorIndex = index >= 0 ? index : 0
        const color = colors[colorIndex]

        const circle = document.createElementNS(svgNS, 'circle')
        circle.setAttribute('cx', '50')
        circle.setAttribute('cy', '50')
        circle.setAttribute('r', '50')
        circle.setAttribute('fill', color)
        svg.appendChild(circle)
      } else {
        // Multiple species - draw pie slices
        Object.entries(counts).forEach(([species, count]) => {
          const index = selectedSpecies.findIndex((s) => s.scientificName === species)
          if (index < 0) return // Skip if species not in selectedSpecies

          const portion = count / total
          const endAngle = startAngle + portion * 2 * Math.PI
          const color = colors[index]

          const largeArcFlag = portion > 0.5 ? 1 : 0

          const x1 = 50 + radius * Math.sin(startAngle)
          const y1 = 50 - radius * Math.cos(startAngle)
          const x2 = 50 + radius * Math.sin(endAngle)
          const y2 = 50 - radius * Math.cos(endAngle)

          const pathData = [
            `M 50 50`,
            `L ${x1} ${y1}`,
            `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
            `Z`
          ].join(' ')

          const path = document.createElementNS(svgNS, 'path')
          path.setAttribute('d', pathData)
          path.setAttribute('fill', color)
          path.setAttribute('stroke', color) // Match stroke color to fill color
          path.setAttribute('stroke-width', '0.5') // Very thin stroke just to smooth edges
          svg.appendChild(path)

          startAngle = endAngle
        })
      }

      return svg
    }

    const svgElement = createSVG()
    const svgString = new XMLSerializer().serializeToString(svgElement)
    const dataUrl = `data:image/svg+xml;base64,${btoa(svgString)}`

    return L.icon({
      iconUrl: dataUrl,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    })
  }

  // Process data points
  const processPointData = () => {
    const locations = {}

    // Combine data from all species
    selectedSpecies.forEach((species) => {
      const speciesName = species.scientificName
      const points = heatmapData?.[speciesName] || []

      points.forEach((point) => {
        const key = `${point.lat},${point.lng}`
        if (!locations[key]) {
          locations[key] = {
            lat: parseFloat(point.lat),
            lng: parseFloat(point.lng),
            counts: {}
          }
        }

        locations[key].counts[speciesName] = point.count
      })
    })

    return Object.values(locations)
  }

  const locationPoints = processPointData()

  // Calculate bounds if we have location points
  const bounds =
    locationPoints.length > 0
      ? locationPoints.reduce(
          (bounds, point) => {
            return [
              [Math.min(bounds[0][0], point.lat), Math.min(bounds[0][1], point.lng)],
              [Math.max(bounds[1][0], point.lat), Math.max(bounds[1][1], point.lng)]
            ]
          },
          [
            [90, 180],
            [-90, -180]
          ] // Initial bounds [min, max]
        )
      : null

  // Options for bounds
  const boundsOptions = {
    padding: [20, 20]
  }

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={boundsOptions}
      className="rounded w-full h-full border border-gray-200"
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer name="Street Map" checked={true}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </LayersControl.BaseLayer>

        <LayersControl.BaseLayer name="Satellite">
          <TileLayer
            attribution='&copy; <a href="https://www.esri.com">Esri</a>'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </LayersControl.BaseLayer>

        <LayersControl.Overlay name="Species Distribution" checked={true}>
          <MarkerClusterGroup
            key={geoKey}
            chunkedLoading
            showCoverageOnHover={false}
            spiderfyOnEveryZoom={false}
            maxClusterRadius={100}
            animateAddingMarkers={false}
            iconCreateFunction={(cluster) => {
              // Get all markers in this cluster
              const markers = cluster.getAllChildMarkers()

              // Combine counts from all markers
              const combinedCounts = {}

              // First, initialize counts for all selected species to ensure consistent ordering
              selectedSpecies.forEach((species) => {
                combinedCounts[species.scientificName] = 0
              })

              // Then add actual counts from markers
              markers.forEach((marker) => {
                Object.entries(marker.options.counts).forEach(([species, count]) => {
                  // Only add species that are in our selectedSpecies list
                  if (selectedSpecies.some((s) => s.scientificName === species)) {
                    combinedCounts[species] += count
                  }
                })
              })

              // Filter out species with zero counts to avoid empty slices
              const filteredCounts = Object.fromEntries(
                Object.entries(combinedCounts).filter(([, count]) => count > 0)
              )

              return createPieChartIcon(filteredCounts)
            }}
          >
            {locationPoints.map((point, index) => (
              <Marker
                key={index}
                position={[point.lat, point.lng]}
                icon={createPieChartIcon(point.counts)}
                counts={point.counts}
              >
                <Popup>
                  <div className="text-sm">
                    <h3 className="font-bold mb-1">Species Data</h3>
                    <ul>
                      {Object.entries(point.counts).map(([species, count], i) => (
                        <li key={i}>
                          <span className="italic">{species}</span>: {count} observations
                        </li>
                      ))}
                    </ul>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        </LayersControl.Overlay>

        {/* Add a legend */}
        <div className="absolute bottom-5 right-5 bg-white p-2 rounded shadow-md z-[1000]">
          {selectedSpecies.map((species, index) => (
            <div key={index} className="flex items-center space-x-2 space-y-1">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: palette[index % palette.length] }}
              ></div>
              <span className="text-xs">{species.scientificName}</span>
            </div>
          ))}
        </div>
      </LayersControl>
    </MapContainer>
  )
}

const palette = [
  'hsl(173 58% 39%)',
  'hsl(43 74% 66%)',
  'hsl(12 76% 61%)',
  'hsl(197 37% 24%)',
  'hsl(27 87% 67%)'
]

export default function Activity({ studyData, studyId }) {
  const { id } = useParams()
  const actualStudyId = studyId || id // Use passed studyId or from params

  const [error, setError] = useState(null)
  const [selectedSpecies, setSelectedSpecies] = useState([])
  const [dateRange, setDateRange] = useState([null, null])
  const [timeRange, setTimeRange] = useState({ start: 0, end: 24 })
  const [timeseriesData, setTimeseriesData] = useState(null)
  const [heatmapData, setHeatmapData] = useState(null)
  const [heatmapStatus, setHeatmapStatus] = useState('loading') // 'loading' | 'hasData' | 'noData'
  const [speciesDistributionData, setSpeciesDistributionData] = useState(null)
  const [dailyActivityData, setDailyActivityData] = useState(null)
  const { importStatus } = useImportStatus(actualStudyId, 5000)

  // Get taxonomic data from studyData
  const taxonomicData = studyData?.taxonomic || null

  useEffect(() => {
    async function fetchData() {
      try {
        const speciesResponse = await window.api.getSpeciesDistribution(actualStudyId)

        if (speciesResponse.error) {
          console.error('Error fetching species distribution:', speciesResponse.error)
        } else {
          setSpeciesDistributionData(speciesResponse.data)

          setSelectedSpecies(speciesResponse.data.slice(0, 2))
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch activity data')
      }
    }

    if (actualStudyId) {
      console.log('Fetching data for study:', actualStudyId)
      fetchData()
    }
    let intervalId
    if (importStatus.isRunning) {
      intervalId = setInterval(() => {
        console.log('Import is running, fetching data...')
        fetchData()
      }, 5000)
    }
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [actualStudyId, importStatus.isRunning])

  // console.log('selected', selectedSpecies)

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

        console.log('Timeseries response:', response.data)

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
      const startIndex = 0
      const endIndex = timeseriesData.length - 1

      setDateRange([
        new Date(timeseriesData[startIndex].date),
        new Date(timeseriesData[endIndex].date)
      ])
    }
  }, [timeseriesData, dateRange])

  useEffect(() => {
    async function fetchHeatmapData() {
      if (!selectedSpecies.length || !dateRange[0] || !dateRange[1]) return

      const speciesNames = selectedSpecies.map((s) => s.scientificName)
      const response = await window.api.getSpeciesHeatmapData(
        studyId,
        speciesNames,
        dateRange[0].toISOString(),
        dateRange[1].toISOString(),
        timeRange.start,
        timeRange.end
      )

      if (response.error) {
        console.error('Error fetching heatmap data:', response.error)
        return
      }

      setHeatmapData(response.data)

      // Determine status based on whether data has location points
      const hasPoints =
        response.data && Object.values(response.data).some((points) => points && points.length > 0)
      setHeatmapStatus(hasPoints ? 'hasData' : 'noData')
    }

    fetchHeatmapData()
  }, [dateRange, timeRange, selectedSpecies, actualStudyId, studyId])

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

  console.log('Selected species:', selectedSpecies.map((s) => s.scientificName).join(', '))

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
              {heatmapStatus === 'loading' ? (
                <SkeletonMap title="Loading Activity" message="Loading species distribution..." />
              ) : heatmapStatus === 'hasData' ? (
                <SpeciesMap
                  heatmapData={heatmapData}
                  selectedSpecies={selectedSpecies}
                  palette={palette}
                  geoKey={
                    selectedSpecies.map((s) => s.scientificName).join(', ') +
                    ' ' +
                    dateRange +
                    ' ' +
                    timeRange.start +
                    timeRange.end
                  }
                />
              ) : (
                <PlaceholderMap
                  title="No Species Location Data"
                  description="Select species from the list and set up deployment coordinates in the Deployments tab to view the species distribution map."
                  linkTo="/deployments"
                  linkText="Go to Deployments"
                  icon={MapPin}
                  studyId={actualStudyId}
                />
              )}
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
