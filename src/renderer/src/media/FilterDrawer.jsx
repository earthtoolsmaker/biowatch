import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as HoverCard from '@radix-ui/react-hover-card'
import SpeciesDistribution from '../ui/speciesDistribution.jsx'
import DeploymentHoverMap from './DeploymentHoverMap.jsx'

// Single blue for selected species — consistent with the deployment filter and
// the blue selection accent used across the drawer (no rainbow palette here,
// since the drawer has no chart that needs per-species color matching).
const palette = ['#2563eb']

function Section({ title, count = 0, children }) {
  const active = count > 0
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span
          className={`text-[11px] uppercase tracking-wide ${
            active ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-muted-foreground'
          }`}
        >
          {title}
        </span>
        {active && (
          <span className="text-[10px] font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/20 rounded-full px-1.5 leading-[1.4]">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

// Multi-select distribution list styled like the species panel: each row shows
// a label, its total count on the right, and a stacked composition bar
// underneath (detections in blue, blanks in grey). `selected` is an array of
// values; clicking a row toggles it (0..N).
function DistributionList({ items, selected, onToggle, emptyLabel, hoverContent }) {
  if (!items.length) {
    return <div className="text-[13px] text-muted-foreground">{emptyLabel}</div>
  }
  const maxCount = items.reduce((m, it) => Math.max(m, it.count || 0), 0)
  return (
    // Mirrors the species list's horizontal rhythm: -mx-1 + px-3 here, rows pull
    // back with -mx-3 px-3 so the hover/selected background bleeds to the edges,
    // exactly like SpeciesRow in ui/speciesDistribution.jsx.
    <div className="flex flex-col max-h-56 overflow-y-auto px-3 -mx-1">
      {items.map((it) => {
        const active = selected.includes(it.value)
        // Normalize each segment against the largest deployment total so bars
        // stay comparable across rows (like the species bars).
        const detPct = maxCount > 0 ? ((it.detectionCount || 0) / maxCount) * 100 : 0
        const blankPct = maxCount > 0 ? ((it.blankCount || 0) / maxCount) * 100 : 0
        // Blue is reserved for the selection accent: the detection segment only
        // goes blue when the row is selected, otherwise slate. Blanks stay a
        // lighter grey throughout, so the composition split reads in both states.
        const detColor = active ? '#2563eb' : '#64748b'
        const row = (
          <div
            onClick={() => onToggle(it.value)}
            className={`cursor-pointer group transition-colors py-2 -mx-3 px-3 first:pt-3 last:pb-3 ${
              active
                ? 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
                : 'hover:bg-blue-50 dark:hover:bg-blue-500/15'
            }`}
          >
            <div className="flex justify-between items-center gap-2 mb-1">
              <span className="flex items-center min-w-0 flex-1">
                <span
                  className={`w-2 h-2 rounded-full mr-2 flex-shrink-0 border ${
                    active
                      ? 'border-transparent bg-blue-600'
                      : 'border-border group-hover:bg-gray-800'
                  }`}
                />
                <span className="text-sm truncate pr-1 text-foreground">{it.label}</span>
              </span>
              <span className="text-xs text-muted-foreground flex-shrink-0">{it.count}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden flex">
              <div className="h-2" style={{ width: `${detPct}%`, backgroundColor: detColor }} />
              <div className="h-2" style={{ width: `${blankPct}%`, backgroundColor: '#cbd5e1' }} />
            </div>
          </div>
        )
        if (!hoverContent) return <div key={it.value}>{row}</div>
        return (
          <HoverCard.Root key={it.value} openDelay={250} closeDelay={80}>
            <HoverCard.Trigger asChild>{row}</HoverCard.Trigger>
            <HoverCard.Portal>
              <HoverCard.Content
                side="left"
                align="center"
                sideOffset={12}
                collisionPadding={12}
                className="species-hovercard z-[10001]"
              >
                {hoverContent(it)}
              </HoverCard.Content>
            </HoverCard.Portal>
          </HoverCard.Root>
        )
      })}
    </div>
  )
}

// Toggle a value in/out of an array filter field.
function toggleInArray(arr, value) {
  return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]
}

export default function FilterDrawer({ open, studyId, filters, onChange, blankCount = 0 }) {
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

  const deploymentItems = useMemo(
    () =>
      (deploymentsQuery.data ?? []).map((d) => ({
        value: d.deploymentID,
        label: d.locationName || d.deploymentID,
        count: d.count,
        detectionCount: d.detectionCount,
        blankCount: d.blankCount,
        lat: d.latitude,
        lon: d.longitude
      })),
    [deploymentsQuery.data]
  )

  const handleSpeciesChange = (next) => {
    onChange({ ...filters, species: next.map((s) => s.scientificName) })
  }

  const hasAny = filters.species.length || filters.deployments.length || filters.sources.length

  const clearAll = () =>
    onChange({
      ...filters,
      species: [],
      deployments: [],
      sources: [],
      dateRange: [null, null],
      timeRange: { ranges: [] }
    })

  return (
    // In-flow side panel: animating its width pushes the grid/table to the left
    // (like Explore's species rail) instead of overlaying it. The inner panel
    // keeps a fixed width so its content doesn't reflow during the animation.
    <div
      aria-hidden={!open}
      className={`flex-shrink-0 h-full overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
        open ? 'w-80' : 'w-0'
      }`}
    >
      <div className="w-80 h-full bg-card border-l border-border flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-sm font-medium">Filters</span>
          {hasAny ? (
            <button
              type="button"
              onClick={clearAll}
              className="text-[12px] font-medium text-blue-700 dark:text-blue-300 hover:underline"
            >
              Clear all
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <Section title="Species" count={filters.species.length}>
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
                  blankCount={blankCount}
                  vehicleCount={0}
                  allowEmpty
                  bordered={false}
                />
              </div>
            ) : (
              <div className="text-[13px] text-muted-foreground">Loading species…</div>
            )}
          </Section>

          <Section title="Deployment" count={filters.deployments.length}>
            <DistributionList
              items={deploymentItems}
              selected={filters.deployments}
              onToggle={(value) =>
                onChange({ ...filters, deployments: toggleInArray(filters.deployments, value) })
              }
              emptyLabel="No deployments"
              hoverContent={(it) => (
                <DeploymentHoverMap
                  lat={it.lat}
                  lon={it.lon}
                  label={it.label}
                  detectionCount={it.detectionCount}
                  blankCount={it.blankCount}
                />
              )}
            />
          </Section>
        </div>
      </div>
    </div>
  )
}
