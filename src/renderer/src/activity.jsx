import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayersControl, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import CircularTimeFilter, { DailyActivityRadar } from './ui/clock'
import PlaceholderMap from './ui/PlaceholderMap'
import SpeciesDistribution from './ui/speciesDistribution'
import TimelineChart from './ui/timeseries'
import { useImportStatus } from './hooks/import'
import { getTopNonHumanSpecies } from './utils/speciesUtils'
import { useSequenceGap } from './hooks/useSequenceGap'

// Component to handle map layer change events for persistence
function LayerChangeHandler({ onLayerChange }) {
  const map = useMap()
  useEffect(() => {
    const handleBaseLayerChange = (e) => {
      onLayerChange(e.name)
    }
    map.on('baselayerchange', handleBaseLayerChange)
    return () => map.off('baselayerchange', handleBaseLayerChange)
  }, [map, onLayerChange])
  return null
}

// SpeciesMap component
const SpeciesMap = ({ heatmapData, selectedSpecies, palette, geoKey, studyId }) => {
  // Persist map layer selection per study
  const mapLayerKey = `mapLayer:${studyId}`
  const [selectedLayer, setSelectedLayer] = useState(() => {
    const saved = localStorage.getItem(mapLayerKey)
    return saved || 'Satellite'
  })

  useEffect(() => {
    localStorage.setItem(mapLayerKey, selectedLayer)
  }, [selectedLayer, mapLayerKey])
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

  // Create tooltip content for species counts
  const createTooltipContent = (counts) => {
    const entries = Object.entries(counts)
      .filter(([species]) => selectedSpecies.some((s) => s.scientificName === species))
      .sort((a, b) => b[1] - a[1])

    const total = entries.reduce((sum, [, count]) => sum + count, 0)

    const rows = entries
      .map(([species, count]) => {
        const index = selectedSpecies.findIndex((s) => s.scientificName === species)
        const color = palette[index % palette.length]
        return `
      <div style="display: flex; align-items: center; gap: 8px; padding: 2px 0;">
        <span style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background-color: ${color};"></span>
        <span style="font-size: 12px; font-style: italic; flex: 1;">${species}</span>
        <span style="font-size: 11px; color: #6b7280;">${count}</span>
      </div>
    `
      })
      .join('')

    return `
    <div style="padding: 8px; min-width: 160px;">
      <div style="font-size: 11px; font-weight: 500; color: #6b7280; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb;">
        ${total} observation${total !== 1 ? 's' : ''}
      </div>
      ${rows}
    </div>
  `
  }

  // PieChartMarker component with tooltip binding
  function PieChartMarker({ point, icon }) {
    const markerRef = useRef(null)

    useEffect(() => {
      const marker = markerRef.current
      if (!marker) return

      const tooltipHtml = createTooltipContent(point.counts)
      marker.unbindTooltip()
      marker.bindTooltip(tooltipHtml, {
        direction: 'top',
        offset: [0, -10],
        className: 'species-map-tooltip'
      })

      return () => marker.unbindTooltip()
    }, [point.counts])

    return (
      <Marker ref={markerRef} position={[point.lat, point.lng]} icon={icon} counts={point.counts} />
    )
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
        <LayersControl.BaseLayer name="Satellite" checked={selectedLayer === 'Satellite'}>
          <TileLayer
            attribution='&copy; <a href="https://www.esri.com">Esri</a>'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </LayersControl.BaseLayer>

        <LayersControl.BaseLayer name="Street Map" checked={selectedLayer === 'Street Map'}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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

              // Bind tooltip to cluster
              const tooltipHtml = createTooltipContent(filteredCounts)
              cluster.unbindTooltip()
              cluster.bindTooltip(tooltipHtml, {
                direction: 'top',
                offset: [0, -10],
                className: 'species-map-tooltip'
              })

              return createPieChartIcon(filteredCounts)
            }}
          >
            {locationPoints.map((point, index) => (
              <PieChartMarker key={index} point={point} icon={createPieChartIcon(point.counts)} />
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
      <LayerChangeHandler onLayerChange={setSelectedLayer} />
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

  const [selectedSpecies, setSelectedSpecies] = useState([])
  const [dateRange, setDateRange] = useState([null, null])
  const [fullExtent, setFullExtent] = useState([null, null])
  const [timeRange, setTimeRange] = useState({ start: 0, end: 24 })
  const { importStatus } = useImportStatus(actualStudyId, 5000)
  const { sequenceGap } = useSequenceGap(actualStudyId)

  // Get taxonomic data from studyData
  const taxonomicData = studyData?.taxonomic || null

  // Fetch sequence-aware species distribution data
  const { data: speciesDistributionData, error: speciesDistributionError } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', actualStudyId, sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(
        actualStudyId,
        sequenceGap
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    placeholderData: (prev) => prev
  })

  // Initialize selectedSpecies when speciesDistributionData loads
  // Excludes humans/vehicles from default selection
  useEffect(() => {
    if (speciesDistributionData && selectedSpecies.length === 0) {
      setSelectedSpecies(getTopNonHumanSpecies(speciesDistributionData, 2))
    }
  }, [speciesDistributionData, selectedSpecies.length])

  // Memoize speciesNames to avoid unnecessary re-renders
  const speciesNames = useMemo(
    () => selectedSpecies.map((s) => s.scientificName),
    [selectedSpecies]
  )

  // Memoize geoKey to prevent MarkerClusterGroup remounts on unrelated state changes
  // Uses primitive values as dependencies to avoid reference equality issues
  const geoKey = useMemo(
    () =>
      selectedSpecies.map((s) => s.scientificName).join(',') +
      (dateRange[0]?.toISOString() || '') +
      (dateRange[1]?.toISOString() || '') +
      timeRange.start +
      timeRange.end,
    [
      selectedSpecies,
      dateRange[0]?.toISOString(),
      dateRange[1]?.toISOString(),
      timeRange.start,
      timeRange.end
    ]
  )

  // Fetch sequence-aware timeseries data
  const { data: timeseriesQueryData } = useQuery({
    queryKey: ['sequenceAwareTimeseries', actualStudyId, [...speciesNames].sort(), sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareTimeseries(
        actualStudyId,
        speciesNames,
        sequenceGap
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId && speciesNames.length > 0,
    placeholderData: (prev) => prev
  })
  const timeseriesData = timeseriesQueryData?.timeseries ?? []

  // Check if dataset has temporal data
  const hasTemporalData = useMemo(() => {
    return timeseriesData && timeseriesData.length > 0
  }, [timeseriesData])

  // Initialize dateRange and fullExtent from timeseries data (side effect, keep as useEffect)
  useEffect(() => {
    if (hasTemporalData && dateRange[0] === null && dateRange[1] === null) {
      const startIndex = 0
      const endIndex = timeseriesData.length - 1

      const startDate = new Date(timeseriesData[startIndex].date)
      const endDate = new Date(timeseriesData[endIndex].date)

      setDateRange([startDate, endDate])
      setFullExtent([startDate, endDate])
    }
  }, [hasTemporalData, timeseriesData, dateRange])

  // Compute if user has selected full temporal range (with 1 day tolerance)
  // Also true when dataset has no temporal data (to include all null-timestamp media)
  const isFullRange = useMemo(() => {
    if (!hasTemporalData) return true
    if (!fullExtent[0] || !fullExtent[1] || !dateRange[0] || !dateRange[1]) {
      return false
    }
    const tolerance = 86400000 // 1 day in milliseconds
    const startMatch = Math.abs(fullExtent[0].getTime() - dateRange[0].getTime()) < tolerance
    const endMatch = Math.abs(fullExtent[1].getTime() - dateRange[1].getTime()) < tolerance
    return startMatch && endMatch
  }, [hasTemporalData, fullExtent, dateRange])

  // Fetch sequence-aware heatmap data
  // Enable when: we have study + species AND (no temporal data OR valid date range)
  const { data: heatmapData, isLoading: isHeatmapLoading } = useQuery({
    queryKey: [
      'sequenceAwareHeatmap',
      actualStudyId,
      [...speciesNames].sort(),
      dateRange[0]?.toISOString(),
      dateRange[1]?.toISOString(),
      timeRange.start,
      timeRange.end,
      isFullRange,
      sequenceGap
    ],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareHeatmap(
        actualStudyId,
        speciesNames,
        dateRange[0]?.toISOString(),
        dateRange[1]?.toISOString(),
        timeRange.start,
        timeRange.end,
        isFullRange,
        sequenceGap
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled:
      !!actualStudyId &&
      speciesNames.length > 0 &&
      (isFullRange || (!!dateRange[0] && !!dateRange[1])),
    placeholderData: (prev) => prev
  })

  // Derive heatmap status from query state and data
  const heatmapStatus = useMemo(() => {
    if (isHeatmapLoading || !heatmapData) return 'loading'
    const hasPoints = Object.values(heatmapData).some((points) => points && points.length > 0)
    return hasPoints ? 'hasData' : 'noData'
  }, [heatmapData, isHeatmapLoading])

  // Fetch sequence-aware daily activity data
  const { data: dailyActivityData } = useQuery({
    queryKey: [
      'sequenceAwareDailyActivity',
      actualStudyId,
      [...speciesNames].sort(),
      dateRange[0]?.toISOString(),
      dateRange[1]?.toISOString(),
      sequenceGap
    ],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareDailyActivity(
        actualStudyId,
        speciesNames,
        dateRange[0]?.toISOString(),
        dateRange[1]?.toISOString(),
        sequenceGap
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId && speciesNames.length > 0 && !!dateRange[0] && !!dateRange[1],
    placeholderData: (prev) => prev
  })

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
      {speciesDistributionError ? (
        <div className="text-red-500 py-4">Error: {speciesDistributionError.message}</div>
      ) : (
        <div className="flex flex-col h-full gap-4">
          {/* First row - takes remaining space */}
          <div className="flex flex-row gap-4 flex-1 min-h-0">
            {/* Species Distribution - left side */}

            {/* Map - right side */}
            <div className="h-full flex-1">
              {heatmapStatus === 'hasData' && (
                <SpeciesMap
                  heatmapData={heatmapData}
                  selectedSpecies={selectedSpecies}
                  palette={palette}
                  studyId={actualStudyId}
                  geoKey={geoKey}
                />
              )}
              {heatmapStatus === 'noData' && !isHeatmapLoading && (
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
                  studyId={actualStudyId}
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
