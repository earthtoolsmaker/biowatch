import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutGrid,
  Table2,
  Filter,
  PawPrint,
  MapPin,
  Calendar,
  Clock,
  Film,
  Image as ImageIcon
} from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as HoverCard from '@radix-ui/react-hover-card'
import ViewModeToggle from '../ui/ViewModeToggle.jsx'
import QuickViews from './QuickViews.jsx'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent.jsx'
import PseudoSpeciesTooltipContent from '../ui/PseudoSpeciesTooltipContent.jsx'
import DeploymentHoverMap from './DeploymentHoverMap.jsx'
import { hasActiveFilters } from './mediaFilters.js'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { formatScientificName } from '../utils/scientificName'
import { toTitleCase } from '../utils/textCase'
import { BLANK_SENTINEL, VEHICLE_SENTINEL } from '../utils/speciesUtils'
import { getPseudoSpeciesEntry } from '../../../shared/pseudoSpecies.js'

// Hover-card heatmap cell count — must match the FilterDrawer query so the
// cached activity data is shared.
const HOVER_PERIOD_COUNT = 40

// Human label for a species chip: pseudo-species sentinels → friendly name,
// otherwise the common name in Title Case, falling back to the formatted
// scientific name (left as-is — only the genus is capitalized).
function speciesChipLabel(name) {
  if (name === BLANK_SENTINEL) return 'Blank'
  if (name === VEHICLE_SENTINEL) return 'Vehicle'
  const common = resolveCommonName(name)
  if (common) return toTitleCase(common)
  return formatScientificName(name) || name
}

// Grid/Table metadata for the shared ViewModeToggle (same look as Explore's
// Map | Gallery | Both segmented control).
const VIEW_META = {
  grid: {
    label: 'Grid',
    icon: LayoutGrid,
    description: 'Browse media as a grid of sequence thumbnails.'
  },
  table: {
    label: 'Table',
    icon: Table2,
    description: 'Inspect sequences as sortable rows with metadata.'
  }
}
const VIEW_MODES = ['table', 'grid']

// Format a [fromISO, toISO] pair into a compact human label.
function formatDateChip([from, to]) {
  if (!from && !to) return null
  const fmt = (s) => {
    const d = new Date(s)
    return Number.isNaN(d.getTime())
      ? s
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (from && to) return `${fmt(from)} → ${fmt(to)}`
  return from ? `From ${fmt(from)}` : `Until ${fmt(to)}`
}

// Derive the removable active-filter chips from filter state. Quick view is
// surfaced in the QuickViews row, so it is intentionally not duplicated here.
// Each chip carries a leading icon naming its facet (species/deployment/…) so
// the pills are self-describing and same-facet pills read as a group. Chips are
// pushed facet-by-facet, so same-type pills are already contiguous.
function deriveChips(filters, deploymentNames = {}) {
  const chips = []
  for (const name of filters.species) {
    chips.push({
      id: `species:${name}`,
      icon: PawPrint,
      type: 'Species',
      value: name,
      label: speciesChipLabel(name),
      clear: (f) => ({
        ...f,
        species: f.species.filter((s) => s !== name)
      })
    })
  }
  for (const d of filters.deployments) {
    chips.push({
      id: `deployment:${d}`,
      icon: MapPin,
      type: 'Deployment',
      value: d,
      label: deploymentNames[d] || d,
      clear: (f) => ({
        ...f,
        deployments: f.deployments.filter((x) => x !== d)
      })
    })
  }
  for (const t of filters.mediaTypes || []) {
    chips.push({
      id: `mediaType:${t}`,
      icon: t === 'video' ? Film : ImageIcon,
      type: 'Media type',
      label: t === 'video' ? 'Videos' : 'Images',
      clear: (f) => ({
        ...f,
        mediaTypes: f.mediaTypes.filter((x) => x !== t)
      })
    })
  }
  const dateLabel = formatDateChip(filters.dateRange)
  if (dateLabel) {
    chips.push({
      id: 'date',
      icon: Calendar,
      type: 'Date',
      label: dateLabel,
      clear: (f) => ({ ...f, dateRange: [null, null] })
    })
  }
  if (filters.timeRange.ranges.length) {
    chips.push({
      id: 'time',
      icon: Clock,
      type: 'Time',
      label: 'Time of day',
      clear: (f) => ({ ...f, timeRange: { ranges: [] } })
    })
  }
  return chips
}

// Show/hide toggle for the filter panel. A labelled button (icon + "Filters")
// rather than a bare icon, so it's discoverable; active-tinted while open or
// when facets are set, with a dot when facets are active. Mirrors the Quick
// views button style for toolbar consistency.
function FilterPanelToggle({ open, active, onToggle }) {
  const label = open ? 'Hide filters' : 'Show filters'
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-label={label}
          aria-pressed={open}
          className={`relative inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] font-medium transition-colors ${
            open || active
              ? 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
              : 'bg-card border-border hover:bg-input-background'
          }`}
        >
          <Filter className="w-3.5 h-3.5 opacity-80" />
          Filters
          {active && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400" />
          )}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={8}
          className="z-[10000] max-w-[15rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
        >
          <div className="font-medium mb-1">{label}</div>
          <p className="text-muted-foreground leading-snug">
            Narrow sequences by species and deployment.
          </p>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export default function MediaToolbar({
  filters,
  filterOpen,
  onToggleFilter,
  onChange,
  sequenceCount,
  quickViewCounts,
  deploymentNames,
  studyId
}) {
  const chips = useMemo(() => deriveChips(filters, deploymentNames), [filters, deploymentNames])
  // The Filter button reflects the drawer facets (species/deployment/etc.), not
  // the quick view (which has its own button).
  const filterActive = hasActiveFilters({ ...filters, quickView: null })

  // Same hover-card content as the filter pane, reused on the active chips.
  // The queries share react-query keys with the drawer, so when the drawer has
  // already loaded them this is a cache hit; gated on having a matching chip.
  const hasDeploymentChips = chips.some((c) => c.type === 'Deployment')
  const hasSpeciesChips = chips.some((c) => c.type === 'Species' && !getPseudoSpeciesEntry(c.value))

  const { data: deploymentDist } = useQuery({
    queryKey: ['mediaFilterDeploymentDistribution', studyId],
    queryFn: async () => {
      const res = await window.api.getDeploymentDistribution(studyId)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: !!studyId && hasDeploymentChips,
    staleTime: 60000
  })
  const { data: activity } = useQuery({
    queryKey: ['mediaFilterDeploymentActivity', studyId, HOVER_PERIOD_COUNT],
    queryFn: async () => {
      const res = await window.api.getDeploymentsActivity(studyId, HOVER_PERIOD_COUNT)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: !!studyId && hasDeploymentChips,
    staleTime: 60000
  })
  const { data: bestImages } = useQuery({
    queryKey: ['bestImagesPerSpecies', studyId],
    queryFn: async () => {
      const res = await window.api.getBestImagePerSpecies(studyId)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: !!studyId && hasSpeciesChips,
    staleTime: 60000
  })
  // Per-species counts, so the hover card can gate its activity charts (and
  // skeleton) the same way the rail does. Shares the drawer's cache key.
  const { data: speciesDist } = useQuery({
    queryKey: ['mediaFilterSpeciesDistribution', studyId],
    queryFn: async () => {
      const res = await window.api.getSequenceAwareSpeciesDistribution(studyId)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: !!studyId && hasSpeciesChips,
    staleTime: 60000
  })
  const speciesCountMap = useMemo(() => {
    const m = {}
    for (const it of speciesDist ?? []) m[it.scientificName] = it.count
    return m
  }, [speciesDist])

  const deploymentItems = useMemo(
    () =>
      (deploymentDist ?? []).map((d) => ({
        value: d.deploymentID,
        label: d.locationName || d.deploymentID,
        lat: d.latitude,
        lon: d.longitude,
        detectionCount: d.detectionCount,
        blankCount: d.blankCount,
        imageCount: d.imageCount,
        videoCount: d.videoCount
      })),
    [deploymentDist]
  )
  const deploymentById = useMemo(() => {
    const m = {}
    for (const it of deploymentItems) m[it.value] = it
    return m
  }, [deploymentItems])
  const periodsByDeployment = useMemo(() => {
    const m = {}
    for (const d of activity?.deployments ?? []) m[d.deploymentID] = d.periods
    return m
  }, [activity])
  const speciesImageMap = useMemo(() => {
    const m = {}
    for (const it of bestImages ?? []) m[it.scientificName] = it
    return m
  }, [bestImages])

  // The rich hover card for a chip, or null for facets without one (media
  // type / date / time keep their plain title tooltip).
  const chipHoverCard = (chip) => {
    if (chip.type === 'Species') {
      const pseudo = getPseudoSpeciesEntry(chip.value)
      return pseudo ? (
        <PseudoSpeciesTooltipContent entry={pseudo} />
      ) : (
        <SpeciesTooltipContent
          imageData={speciesImageMap[chip.value] || { scientificName: chip.value }}
          studyId={studyId}
          showActivity
          detectionCount={speciesCountMap[chip.value] ?? 0}
        />
      )
    }
    if (chip.type === 'Deployment') {
      const dep = deploymentById[chip.value]
      if (!dep) return null
      return (
        <DeploymentHoverMap
          lat={dep.lat}
          lon={dep.lon}
          label={dep.label}
          currentId={chip.value}
          others={deploymentItems}
          detectionCount={dep.detectionCount}
          blankCount={dep.blankCount}
          imageCount={dep.imageCount}
          videoCount={dep.videoCount}
          periods={periodsByDeployment[chip.value]}
          percentile90Count={activity?.percentile90Count}
          surveyStart={activity?.startDate}
          surveyEnd={activity?.endDate}
        />
      )
    }
    return null
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <ViewModeToggle
        value={filters.view}
        modes={VIEW_MODES}
        meta={VIEW_META}
        onChange={(view) => onChange({ ...filters, view })}
      />

      <div className="w-px h-6 bg-border mx-0.5" />

      <QuickViews
        active={filters.quickView}
        counts={quickViewCounts}
        onSelect={(key) =>
          onChange(
            key
              ? {
                  // A quick view is a fresh preset: selecting one resets the
                  // facet filters (species/deployment/media-type/date/time) so
                  // the view shows exactly its category. View mode and sort persist.
                  ...filters,
                  species: [],
                  deployments: [],
                  mediaTypes: [],
                  dateRange: [null, null],
                  timeRange: { ranges: [] },
                  quickView: key
                }
              : { ...filters, quickView: null }
          )
        }
      />

      {chips.map((chip) => {
        const Icon = chip.icon
        const hovercard = chipHoverCard(chip)
        const pill = (
          <span
            key={chip.id}
            title={hovercard ? undefined : `${chip.type}: ${chip.label}`}
            className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full text-[12.5px] font-medium bg-blue-50 text-blue-700 border border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30 cursor-default select-none"
          >
            {Icon && <Icon className="w-3.5 h-3.5 opacity-60" />}
            {chip.label}
            <button
              type="button"
              aria-label={`Remove ${chip.type} filter ${chip.label}`}
              className="cursor-pointer opacity-60 hover:opacity-100 leading-none"
              onClick={() => onChange(chip.clear(filters))}
            >
              ✕
            </button>
          </span>
        )
        if (!hovercard) return pill
        return (
          <HoverCard.Root key={chip.id} openDelay={400} closeDelay={120}>
            <HoverCard.Trigger asChild>{pill}</HoverCard.Trigger>
            <HoverCard.Portal>
              <HoverCard.Content
                side="bottom"
                align="start"
                sideOffset={8}
                collisionPadding={12}
                className="species-hovercard z-[10002]"
              >
                {hovercard}
              </HoverCard.Content>
            </HoverCard.Portal>
          </HoverCard.Root>
        )
      })}

      {chips.length > 1 && (
        <button
          type="button"
          onClick={() =>
            onChange({
              ...filters,
              species: [],
              deployments: [],
              mediaTypes: [],
              dateRange: [null, null],
              timeRange: { ranges: [] }
            })
          }
          className="text-[12.5px] font-medium text-blue-700 hover:underline dark:text-blue-300 px-1"
        >
          Clear all
        </button>
      )}

      <div className="flex-1" />

      {typeof sequenceCount === 'number' && (
        <span className="text-[12.5px] text-muted-foreground">
          {sequenceCount.toLocaleString()} sequences
        </span>
      )}

      <FilterPanelToggle open={filterOpen} active={filterActive} onToggle={onToggleFilter} />
    </div>
  )
}
