import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import SpeciesDistribution from '../ui/speciesDistribution.jsx'
import DayPeriodChips from '../ui/dayPeriodChips.jsx'
import {
  ALL_CHIPS_SELECTED,
  DAY_PERIOD_ORDER,
  DAY_PERIOD_PRESETS,
  chipsToRanges
} from '../utils/dayPeriods.js'

// Species tint palette — mirrors the Explore/Media distribution colors.
const palette = [
  'hsl(173 58% 39%)',
  'hsl(43 74% 66%)',
  'hsl(12 76% 61%)',
  'hsl(197 37% 24%)',
  'hsl(27 87% 67%)'
]

// Recover the day-period chip selection from the stored ranges. chipsToRanges
// emits one preset range per chip (no merging), so an exact start/end match is
// lossless. Empty ranges = no time filter = all chips selected.
function rangesToChipSelection(ranges) {
  if (!ranges || !ranges.length) return new Set(ALL_CHIPS_SELECTED)
  const sel = new Set()
  for (const key of DAY_PERIOD_ORDER) {
    const { start, end } = DAY_PERIOD_PRESETS[key].range
    if (ranges.some((r) => r.start === start && r.end === end)) sel.add(key)
  }
  return sel.size ? sel : new Set(ALL_CHIPS_SELECTED)
}

function Section({ title, children }) {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  )
}

// Single-select list row used for deployment & source facets (the gallery query
// filters by one of each; multi-select is a later enhancement).
function PickList({ items, selected, onPick, emptyLabel }) {
  if (!items.length) {
    return <div className="text-[13px] text-muted-foreground">{emptyLabel}</div>
  }
  return (
    <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
      {items.map((it) => {
        const active = selected === it.value
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onPick(active ? null : it.value)}
            className={`flex items-center justify-between rounded px-2 py-1.5 text-[13px] text-left ${
              active
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                : 'hover:bg-input-background'
            }`}
          >
            <span className="truncate pr-2">{it.label}</span>
            {typeof it.count === 'number' && (
              <span className="text-xs text-muted-foreground flex-shrink-0">{it.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function FilterDrawer({ open, onClose, studyId, filters, onChange }) {
  const speciesQuery = useQuery({
    queryKey: ['mediaFilterSpeciesDistribution', studyId],
    queryFn: async () => {
      const res = await window.api.getSequenceAwareSpeciesDistribution(studyId)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: open && !!studyId,
    staleTime: 60000
  })

  const sourcesQuery = useQuery({
    queryKey: ['mediaFilterSources', studyId],
    queryFn: async () => {
      const res = await window.api.getSourceDistribution(studyId)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: open && !!studyId,
    staleTime: 60000
  })

  const deploymentsQuery = useQuery({
    queryKey: ['mediaFilterDeployments', studyId],
    queryFn: async () => {
      const res = await window.api.getDeploymentLocations(studyId)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: open && !!studyId,
    staleTime: 60000
  })

  const selectedSpecies = useMemo(
    () => filters.species.map((scientificName) => ({ scientificName })),
    [filters.species]
  )

  const chipSelection = useMemo(
    () => rangesToChipSelection(filters.timeRange.ranges),
    [filters.timeRange.ranges]
  )

  const sourceItems = useMemo(
    () =>
      (sourcesQuery.data ?? []).map((s) => ({ value: s.source, label: s.source, count: s.count })),
    [sourcesQuery.data]
  )

  const deploymentItems = useMemo(
    () =>
      (deploymentsQuery.data ?? []).map((d) => ({
        value: d.deploymentID,
        label: d.locationName || d.locationID || d.deploymentID
      })),
    [deploymentsQuery.data]
  )

  if (!open) return null

  const handleSpeciesChange = (next) => {
    onChange({ ...filters, species: next.map((s) => s.scientificName) })
  }

  const handleChips = (nextSet) => {
    const ranges = nextSet.size === DAY_PERIOD_ORDER.length ? [] : chipsToRanges(nextSet)
    onChange({ ...filters, timeRange: { ranges } })
  }

  const hasAny =
    filters.species.length ||
    filters.deployments.length ||
    filters.sources.length ||
    filters.dateRange[0] ||
    filters.dateRange[1] ||
    filters.timeRange.ranges.length

  return (
    <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-80 bg-card border-l border-border shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-sm font-medium">Filters</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="opacity-70 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <Section title="Species">
            {speciesQuery.data ? (
              <div className="max-h-56 overflow-y-auto -mx-1">
                <SpeciesDistribution
                  data={speciesQuery.data}
                  taxonomicData={null}
                  selectedSpecies={selectedSpecies}
                  onSpeciesChange={handleSpeciesChange}
                  palette={palette}
                  studyId={studyId}
                  showHeader={false}
                  hidePseudoSpecies
                />
              </div>
            ) : (
              <div className="text-[13px] text-muted-foreground">Loading species…</div>
            )}
          </Section>

          <Section title="Deployment">
            <PickList
              items={deploymentItems}
              selected={filters.deployments[0] ?? null}
              onPick={(value) => onChange({ ...filters, deployments: value ? [value] : [] })}
              emptyLabel="No deployments"
            />
          </Section>

          <Section title="Source">
            <PickList
              items={sourceItems}
              selected={filters.sources[0] ?? null}
              onPick={(value) => onChange({ ...filters, sources: value ? [value] : [] })}
              emptyLabel="No import sources"
            />
          </Section>

          <Section title="Date range">
            <div className="flex items-center gap-2 text-[13px]">
              <input
                type="date"
                value={filters.dateRange[0] || ''}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    dateRange: [e.target.value || null, filters.dateRange[1]]
                  })
                }
                className="flex-1 rounded border border-border bg-input-background px-2 py-1"
              />
              <span className="text-muted-foreground">→</span>
              <input
                type="date"
                value={filters.dateRange[1] || ''}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    dateRange: [filters.dateRange[0], e.target.value || null]
                  })
                }
                className="flex-1 rounded border border-border bg-input-background px-2 py-1"
              />
            </div>
          </Section>

          <Section title="Time of day">
            <DayPeriodChips selection={chipSelection} onChange={handleChips} />
          </Section>
        </div>

        {hasAny ? (
          <div className="px-4 py-3 border-t border-border flex-shrink-0">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...filters,
                  species: [],
                  deployments: [],
                  sources: [],
                  dateRange: [null, null],
                  timeRange: { ranges: [] }
                })
              }
              className="text-[13px] font-medium text-blue-700 dark:text-blue-300 hover:underline"
            >
              Clear all filters
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
