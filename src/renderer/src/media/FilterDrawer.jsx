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

// Multi-select distribution list styled like the species panel: each row shows
// a label, its count on the right, and a proportional bar underneath. `selected`
// is an array of values; clicking a row toggles it (0..N).
function DistributionList({ items, selected, onToggle, emptyLabel }) {
  if (!items.length) {
    return <div className="text-[13px] text-muted-foreground">{emptyLabel}</div>
  }
  const maxCount = items.reduce((m, it) => Math.max(m, it.count || 0), 0)
  return (
    <div className="flex flex-col max-h-56 overflow-y-auto -mx-1">
      {items.map((it) => {
        const active = selected.includes(it.value)
        const pct = maxCount > 0 ? ((it.count || 0) / maxCount) * 100 : 0
        return (
          <div
            key={it.value}
            onClick={() => onToggle(it.value)}
            className={`cursor-pointer px-3 py-2 transition-colors ${
              active
                ? 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
                : 'hover:bg-blue-50 dark:hover:bg-blue-500/15'
            }`}
          >
            <div className="flex justify-between items-center gap-2 mb-1">
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-block w-3 h-3 rounded-sm border flex-shrink-0 ${
                    active ? 'bg-blue-600 border-blue-600' : 'border-border'
                  }`}
                />
                <span className="text-sm truncate text-foreground">{it.label}</span>
              </span>
              <span className="text-xs text-muted-foreground flex-shrink-0">{it.count}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="h-2 rounded-full"
                style={{ width: `${pct}%`, backgroundColor: active ? '#2563eb' : '#cbd5e1' }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Toggle a value in/out of an array filter field.
function toggleInArray(arr, value) {
  return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]
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

  const deploymentsQuery = useQuery({
    queryKey: ['mediaFilterDeploymentDistribution', studyId],
    queryFn: async () => {
      const res = await window.api.getDeploymentDistribution(studyId)
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

  const deploymentItems = useMemo(
    () =>
      (deploymentsQuery.data ?? []).map((d) => ({
        value: d.deploymentID,
        label: d.locationName || d.deploymentID,
        count: d.count
      })),
    [deploymentsQuery.data]
  )

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
    <div
      className={`fixed inset-0 z-[1000] ${open ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
    >
      {/* Backdrop fades in/out */}
      <div
        className={`absolute inset-0 bg-black/20 transition-opacity duration-300 ease-out motion-reduce:transition-none ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      {/* Panel slides in from the right */}
      <div
        className={`absolute right-0 top-0 h-full w-80 bg-card border-l border-border shadow-xl flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
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
                  allowEmpty
                />
              </div>
            ) : (
              <div className="text-[13px] text-muted-foreground">Loading species…</div>
            )}
          </Section>

          <Section title="Deployment">
            <DistributionList
              items={deploymentItems}
              selected={filters.deployments}
              onToggle={(value) =>
                onChange({ ...filters, deployments: toggleInArray(filters.deployments, value) })
              }
              emptyLabel="No deployments"
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
