import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router'
import CircularTimeFilter, { DailyActivityRadar, DailyActivityLine } from './ui/clock'
import DayPeriodChips from './ui/dayPeriodChips'
import ChartShapeToggle from './ui/chartShapeToggle'
import {
  ALL_CHIPS_SELECTED,
  arcToRanges,
  chipsToRanges,
  DAY_PERIOD_ORDER,
  DAY_PERIOD_PRESETS,
  mergeChipRanges
} from './utils/dayPeriods'
import SpeciesDistribution from './ui/speciesDistribution'
import TimelineChart from './ui/timeseries'
import { getTopNonHumanSpecies } from './utils/speciesUtils'
import { useSequenceGap } from './hooks/useSequenceGap'
import { useShowFilterCharts } from './hooks/useShowFilterCharts'
import { useDateRange } from './hooks/useDateRange'
import { useImportStatus } from './hooks/import'
import Gallery from './media/Gallery'
import GalleryDisplayStrip from './media/GalleryDisplayStrip'

// Color palette used to tint species across the Activity tab's distribution
// pill, daily-activity radar, and timeline chart.
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
  const [searchParams, setSearchParams] = useSearchParams()

  const [selectedSpecies, setSelectedSpecies] = useState([])
  // Flips true after selectedSpecies has been initialised from the
  // speciesDistributionData effect, so downstream components (Gallery,
  // Timeline, Radar) only mount once their queryKey inputs are stable
  // rather than fetching on every cascading state update.
  const [speciesInitialized, setSpeciesInitialized] = useState(false)
  const { dateRange, setDateRange } = useDateRange(actualStudyId)
  const [fullExtent, setFullExtent] = useState([null, null])
  const [chipSelection, setChipSelection] = useState(() => new Set(ALL_CHIPS_SELECTED))
  const [arc, setArc] = useState({ start: 0, end: 24 })
  const [chartShape, setChartShape] = useState('polar')

  // Derive the timeRange payload sent to the backend. Chip selections drive
  // the filter; selecting all four (the default) is treated as "no filter"
  // so null-timestamp media still shows, mirroring the timeline default.
  // With zero chips selected, the freeform drag-arc supplies the range.
  const timeRange = useMemo(() => {
    if (chipSelection.size === DAY_PERIOD_ORDER.length) return { ranges: [] }
    const ranges = chipSelection.size > 0 ? chipsToRanges(chipSelection) : arcToRanges(arc)
    return { ranges }
  }, [chipSelection, arc])

  // Merged ranges for VISUAL highlighting in the polar/x-y chart. Chips
  // collapse to merged contiguous arcs; with no chips, the freeform
  // drag-arc selection is mirrored into the x-y view too (same underlying
  // filter). All four chips collapses to a single full-day arc.
  const visualRanges = useMemo(() => {
    if (chipSelection.size > 0) return mergeChipRanges(chipsToRanges(chipSelection))
    return arcToRanges(arc)
  }, [chipSelection, arc])

  // Indicator dot on the filter-charts toggle: true when any time-of-day
  // filter is active (chips or partial drag-arc) OR a date-range filter
  // is set (timeline brush narrowed below the full extent).
  const hasDateFilter = useMemo(() => !!(dateRange[0] && dateRange[1]), [dateRange])
  const isFiltering = useMemo(
    () => timeRange.ranges.length > 0 || hasDateFilter,
    [timeRange, hasDateFilter]
  )

  // Human-readable labels for the filter-toggle tooltip. Day filter is
  // either chip names (e.g. "Dawn, Dusk") or an hour range from the
  // freeform drag-arc ("18:00 → 21:00"). Date filter is the calendar range.
  const dayFilterLabel = useMemo(() => {
    if (timeRange.ranges.length === 0) return null
    if (chipSelection.size > 0) {
      return DAY_PERIOD_ORDER.filter((k) => chipSelection.has(k))
        .map((k) => DAY_PERIOD_PRESETS[k].label)
        .join(', ')
    }
    const fmt = (h) => `${String(Math.floor(h)).padStart(2, '0')}:00`
    return `${fmt(arc.start)} → ${fmt(arc.end)}`
  }, [timeRange, chipSelection, arc])
  const dateFilterLabel = useMemo(() => {
    if (!hasDateFilter) return null
    const fmt = (d) =>
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${fmt(dateRange[0])} → ${fmt(dateRange[1])}`
  }, [hasDateFilter, dateRange])
  const handleResetFilters = useCallback(() => {
    setChipSelection(new Set(ALL_CHIPS_SELECTED))
    setArc({ start: 0, end: 24 })
    setDateRange([null, null])
  }, [setDateRange])
  const { importStatus } = useImportStatus(actualStudyId, 5000)

  // Sequence gap - uses React Query for sync across components
  const { sequenceGap } = useSequenceGap(actualStudyId)
  const { showFilterCharts } = useShowFilterCharts(actualStudyId)

  const taxonomicData = studyData?.taxonomic || null

  // Fetch sequence-aware species distribution data
  // sequenceGap in queryKey ensures refetch when slider changes (backend fetches from metadata)
  const { data: speciesDistributionData, error: speciesDistributionError } = useQuery({
    queryKey: ['sequenceAwareSpeciesDistribution', actualStudyId, sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareSpeciesDistribution(actualStudyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId && sequenceGap !== undefined,
    placeholderData: (prev) => prev,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    staleTime: Infinity
  })

  // Fetch blank media count (media without observations)
  const { data: blankCount = 0 } = useQuery({
    queryKey: ['blankMediaCount', actualStudyId],
    queryFn: async () => {
      const response = await window.api.getBlankMediaCount(actualStudyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    staleTime: Infinity
  })

  // Fetch vehicle media count (media with at least one vehicle observation)
  const { data: vehicleCount = 0 } = useQuery({
    queryKey: ['vehicleMediaCount', actualStudyId],
    queryFn: async () => {
      const response = await window.api.getVehicleMediaCount(actualStudyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId,
    refetchInterval: importStatus?.isRunning ? 5000 : false,
    staleTime: Infinity
  })

  // Initialize selectedSpecies when speciesDistributionData loads
  // Check URL params first (from overview click), then default to top species
  useEffect(() => {
    if (!speciesDistributionData) return

    const preSelectedSpecies = searchParams.get('species')

    if (preSelectedSpecies) {
      // Find the species in distribution data to get full object with count
      const speciesData = speciesDistributionData.find(
        (s) => s.scientificName === preSelectedSpecies
      )
      if (speciesData) {
        setSelectedSpecies([speciesData])
        // Clear the URL param after applying
        setSearchParams({}, { replace: true })
        setSpeciesInitialized(true)
        return
      }
    }

    // Default: select top 2 non-human species if no selection yet
    if (selectedSpecies.length === 0) {
      setSelectedSpecies(getTopNonHumanSpecies(speciesDistributionData, 2))
    }
    // Signal to downstream components (Gallery, Timeline, Radar) that species
    // inputs have settled so their queryKey stabilises and they fetch once.
    setSpeciesInitialized(true)
  }, [speciesDistributionData, searchParams, setSearchParams, selectedSpecies.length])

  // Drop filter entries whose species no longer exists (e.g. after a rename
  // or mark-as-blank). Preserve identity when nothing changes.
  useEffect(() => {
    if (!speciesDistributionData) return
    const validNames = new Set(speciesDistributionData.map((s) => s.scientificName))
    setSelectedSpecies((prev) => {
      const filtered = prev.filter((s) => validNames.has(s.scientificName))
      return filtered.length === prev.length ? prev : filtered
    })
  }, [speciesDistributionData])

  // Memoize speciesNames to avoid unnecessary re-renders
  const speciesNames = useMemo(
    () => selectedSpecies.map((s) => s.scientificName),
    [selectedSpecies]
  )

  // Fetch sequence-aware timeseries data
  // sequenceGap in queryKey ensures refetch when slider changes (backend fetches from metadata)
  const { data: timeseriesQueryData } = useQuery({
    queryKey: ['sequenceAwareTimeseries', actualStudyId, [...speciesNames].sort(), sequenceGap],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareTimeseries(actualStudyId, speciesNames)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!actualStudyId && speciesNames.length > 0 && sequenceGap !== undefined,
    placeholderData: (prev) => prev,
    refetchInterval: importStatus?.isRunning ? 5000 : false
  })
  const timeseriesData = timeseriesQueryData?.timeseries ?? []

  // Check if dataset has temporal data
  const hasTemporalData = useMemo(() => {
    return timeseriesData && timeseriesData.length > 0
  }, [timeseriesData])

  // Initialize fullExtent from timeseries data for timeline display
  // Note: We intentionally do NOT auto-set dateRange here.
  // Keeping dateRange as [null, null] means "select all" (no date filtering),
  // which fixes bugs where week-start boundaries exclude same-day media with later timestamps.
  // dateRange only changes when user explicitly brushes the timeline.
  useEffect(() => {
    if (hasTemporalData && fullExtent[0] === null && fullExtent[1] === null) {
      const startIndex = 0
      const endIndex = timeseriesData.length - 1

      const startDate = new Date(timeseriesData[startIndex].date)
      const endDate = new Date(timeseriesData[endIndex].date)

      setFullExtent([startDate, endDate])
    }
  }, [hasTemporalData, timeseriesData, fullExtent])

  // Compute if user has selected full temporal range (with 1 day tolerance)
  // Also true when dataset has no temporal data (to include all null-timestamp media)
  // Also true when dateRange is [null, null] (no explicit selection = include all)
  const isFullRange = useMemo(() => {
    // If dateRange is null/null, treat as full range (include all including null timestamps)
    if (!dateRange[0] && !dateRange[1]) return true

    if (!hasTemporalData) return true
    if (!fullExtent[0] || !fullExtent[1]) return false

    const tolerance = 86400000 // 1 day in milliseconds
    const startMatch = Math.abs(fullExtent[0].getTime() - dateRange[0].getTime()) < tolerance
    const endMatch = Math.abs(fullExtent[1].getTime() - dateRange[1].getTime()) < tolerance
    return startMatch && endMatch
  }, [hasTemporalData, fullExtent, dateRange])

  // Fetch sequence-aware daily activity data.
  // Effective dateRange falls back to fullExtent so the radar can render
  // before the user has brushed a custom range. Gallery keeps its
  // dateRange-null = "select all" semantic untouched; this fallback is
  // local to the daily-activity query.
  const dailyActivityStart = dateRange[0] ?? fullExtent[0]
  const dailyActivityEnd = dateRange[1] ?? fullExtent[1]
  const { data: dailyActivityData } = useQuery({
    queryKey: [
      'sequenceAwareDailyActivity',
      actualStudyId,
      [...speciesNames].sort(),
      dailyActivityStart?.toISOString(),
      dailyActivityEnd?.toISOString(),
      sequenceGap
    ],
    queryFn: async () => {
      const response = await window.api.getSequenceAwareDailyActivity(
        actualStudyId,
        speciesNames,
        dailyActivityStart?.toISOString(),
        dailyActivityEnd?.toISOString()
      )
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled:
      !!actualStudyId &&
      speciesNames.length > 0 &&
      !!dailyActivityStart &&
      !!dailyActivityEnd &&
      sequenceGap !== undefined,
    placeholderData: (prev) => prev,
    refetchInterval: importStatus?.isRunning ? 5000 : false
  })

  const handleArcChange = useCallback((newArc) => {
    setArc(newArc)
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
        <div className="text-red-500 py-4 dark:text-red-400">
          Error: {speciesDistributionError.message}
        </div>
      ) : (
        <div className="flex flex-col h-full">
          {/* First row - takes remaining space */}
          <div className="flex flex-row gap-4 flex-1 min-h-0">
            {/* Species Distribution - left side */}

            {/* Map - right side */}
            <div className="h-full flex-1">
              {speciesInitialized && sequenceGap !== undefined && (
                <Gallery
                  species={selectedSpecies.map((s) => s.scientificName)}
                  dateRange={dateRange}
                  timeRange={timeRange}
                  includeNullTimestamps={isFullRange}
                  speciesReady={speciesInitialized}
                />
              )}
            </div>
            <div className="h-full w-xs flex flex-col gap-2 min-h-0">
              {speciesInitialized && sequenceGap !== undefined && (
                <GalleryDisplayStrip
                  studyId={actualStudyId}
                  // Stay optimistic while the timeseries query is still in
                  // flight so the toggle doesn't briefly disappear on mount
                  // for studies that DO have timestamps; only hide it once
                  // we've confirmed the study has none.
                  hasTemporalData={hasTemporalData || timeseriesQueryData === undefined}
                  isFiltering={isFiltering}
                  dayFilterLabel={dayFilterLabel}
                  dateFilterLabel={dateFilterLabel}
                  onResetFilters={handleResetFilters}
                />
              )}
              {speciesDistributionData && (
                <div className="flex-1 min-h-0">
                  <SpeciesDistribution
                    data={speciesDistributionData}
                    taxonomicData={taxonomicData}
                    selectedSpecies={selectedSpecies}
                    onSpeciesChange={handleSpeciesChange}
                    palette={palette}
                    blankCount={blankCount}
                    vehicleCount={vehicleCount}
                    studyId={actualStudyId}
                    showHeader={false}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Second row - timeline + clock. Wrapper is always mounted so
              the height/opacity/margin transition can run in both directions
              when the filter-charts toggle flips. Inner contents still gated
              on species + sequenceGap so the bordered boxes don't flash empty
              during initial load. Default OFF; when off, the row collapses
              and the gallery reclaims the 130px. */}
          <div
            className={`w-full flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${
              showFilterCharts && hasTemporalData
                ? 'h-[180px] opacity-100 mt-4'
                : 'h-0 opacity-0 mt-0'
            }`}
            aria-hidden={!(showFilterCharts && hasTemporalData)}
          >
            {speciesInitialized && sequenceGap !== undefined && (
              <div className="w-full flex h-[180px] gap-3">
                <div className="w-[180px] h-full rounded border border-border flex flex-col relative">
                  <div className="absolute top-1.5 right-2 z-10">
                    <ChartShapeToggle value={chartShape} onChange={setChartShape} />
                  </div>
                  <div className="flex-1 relative">
                    {chartShape === 'polar' ? (
                      <>
                        <DailyActivityRadar
                          activityData={dailyActivityData}
                          selectedSpecies={selectedSpecies}
                          palette={palette}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <CircularTimeFilter
                            onChange={handleArcChange}
                            startTime={arc.start}
                            endTime={arc.end}
                            mode={chipSelection.size > 0 ? 'chips' : 'drag'}
                            chipSectors={visualRanges}
                          />
                        </div>
                      </>
                    ) : (
                      <DailyActivityLine
                        activityData={dailyActivityData}
                        selectedSpecies={selectedSpecies}
                        palette={palette}
                        selectedRanges={visualRanges}
                        onArcChange={chipSelection.size === 0 ? handleArcChange : undefined}
                      />
                    )}
                  </div>
                  <div className="flex justify-center px-2 pb-1.5">
                    <DayPeriodChips selection={chipSelection} onChange={setChipSelection} />
                  </div>
                </div>
                <div className="flex-grow rounded px-2 border border-border">
                  <TimelineChart
                    timeseriesData={timeseriesData}
                    selectedSpecies={selectedSpecies}
                    dateRange={dateRange}
                    setDateRange={setDateRange}
                    palette={palette}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
