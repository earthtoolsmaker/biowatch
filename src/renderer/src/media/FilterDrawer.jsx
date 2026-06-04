import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as HoverCard from '@radix-ui/react-hover-card'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ArrowDownAZ, ArrowDownWideNarrow, Film, Image as ImageIcon, Search } from 'lucide-react'
import SpeciesDistribution from '../ui/speciesDistribution.jsx'
import DeploymentHoverMap from './DeploymentHoverMap.jsx'
import { resolveCommonName } from '../../../shared/commonNames/index.js'
import { isBlank, isVehicle } from '../utils/speciesUtils'

const MEDIA_TYPE_OPTIONS = [
  { value: 'image', label: 'Images', Icon: ImageIcon },
  { value: 'video', label: 'Videos', Icon: Film }
]

// Show a search box once a distribution list is long enough that scanning the
// count-sorted list for a specific entry gets tedious.
const SEARCH_THRESHOLD = 8

// Searchable text for a species row: pseudo-species by their label, otherwise
// the common name + scientific name (so either matches).
function speciesSearchText(scientificName) {
  if (isBlank(scientificName)) return 'blank'
  if (isVehicle(scientificName)) return 'vehicle'
  return `${resolveCommonName(scientificName) || ''} ${scientificName}`.toLowerCase()
}

// Compact search input revealed under a section header when its toggle is on.
// Autofocuses on open so the user can type immediately.
function ListSearch({ value, onChange, placeholder }) {
  return (
    <div className="relative mb-2">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus
        className="h-7 w-full rounded-md border border-border bg-input-background pl-7 pr-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </div>
  )
}

// Subtle magnifying-glass toggle shown on a section header row; reveals the
// section's search field when clicked. Highlights blue while open. Carries a
// title+description tooltip in the same style as the Table/Grid toggle.
function SearchToggle({ open, onClick, noun }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={open ? 'Close search' : `Search ${noun}`}
          className={`flex-shrink-0 rounded p-0.5 ${
            open
              ? 'text-blue-700 dark:text-blue-300'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={8}
          className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
        >
          <div className="font-medium mb-1">Search</div>
          <p className="text-muted-foreground leading-snug">Type to find a {noun} by name.</p>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

// Subtle sort toggle on a section header row: switches the list between
// by-count and A–Z ordering. The icon reflects the current mode; tooltip in the
// same style as the search toggle / Table-Grid control.
function SortToggle({ mode, onToggle }) {
  const alpha = mode === 'alpha'
  const Icon = alpha ? ArrowDownAZ : ArrowDownWideNarrow
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-label={alpha ? 'Sort by count' : 'Sort alphabetically'}
          className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={8}
          className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
        >
          <div className="font-medium mb-1">Sort</div>
          <p className="text-muted-foreground leading-snug">
            {alpha ? 'A–Z — click to sort by count.' : 'By count — click to sort A–Z.'}
          </p>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

// Single blue for selected species — consistent with the deployment filter and
// the blue selection accent used across the drawer (no rainbow palette here,
// since the drawer has no chart that needs per-species color matching).
const palette = ['#2563eb']

// Heatmap cell count for the deployment hover card — sized for the 320px card.
const HOVER_PERIOD_COUNT = 40

function Section({ title, count = 0, action = null, children }) {
  const active = count > 0
  return (
    <div className="border-b border-border/60 px-4 py-3.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-[11px] uppercase tracking-[0.05em] font-semibold ${
              active ? 'text-blue-700 dark:text-blue-300' : 'text-muted-foreground'
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
        {action}
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
  // Controlled hover card so we can force it shut on scroll — otherwise the card
  // "rides along" with its row as the list scrolls under the cursor. A capture-
  // phase scroll listener catches scrolling of any ancestor (inner list or the
  // outer drawer body), mirroring the species rail's scroll-close behaviour.
  const [openValue, setOpenValue] = useState(null)
  useEffect(() => {
    if (openValue == null) return
    const close = () => setOpenValue(null)
    document.addEventListener('scroll', close, true)
    return () => document.removeEventListener('scroll', close, true)
  }, [openValue])

  if (!items.length) {
    return <div className="text-[13px] text-muted-foreground">{emptyLabel}</div>
  }
  const maxCount = items.reduce((m, it) => Math.max(m, it.count || 0), 0)
  return (
    // -mx-4 cancels the Section's px-4 so the list spans the full pane width;
    // each row's -mx-3 px-3 then bleeds its hover/selected background to the
    // edges, exactly like SpeciesRow in ui/speciesDistribution.jsx.
    <div className="flex flex-col max-h-56 overflow-y-auto px-3 -mx-4">
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
          <HoverCard.Root
            key={it.value}
            openDelay={250}
            closeDelay={80}
            open={openValue === it.value}
            onOpenChange={(o) => setOpenValue(o ? it.value : null)}
          >
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

// Pulsing placeholder rows shown while a distribution (species/deployment) is
// still loading — mirrors a DistRow's shape (dot + label + count, then the
// composition bar) so the pane doesn't flash a misleading "No deployments" /
// empty state during the (sometimes multi-second) sequence-aware computation.
function DistributionSkeleton({ rows = 6 }) {
  return (
    <div className="px-3 -mx-4" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="py-2 first:pt-3 animate-pulse">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-1 items-center">
              <span className="mr-2 h-2 w-2 flex-shrink-0 rounded-full bg-muted" />
              <span
                className="h-3 rounded bg-muted"
                style={{ width: `${45 + ((i * 17) % 40)}%` }}
              />
            </span>
            <span className="h-3 w-5 flex-shrink-0 rounded bg-muted" />
          </div>
          <div className="h-2 w-full rounded-full bg-muted" />
        </div>
      ))}
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

  // Per-deployment activity over the whole survey window, for the hover card's
  // heatmap (same data the Deployments tab sparkline uses). A fixed period count
  // sized for the 320px card.
  const activityQuery = useQuery({
    queryKey: ['mediaFilterDeploymentActivity', studyId, HOVER_PERIOD_COUNT],
    queryFn: async () => {
      const res = await window.api.getDeploymentsActivity(studyId, HOVER_PERIOD_COUNT)
      if (res?.error) throw new Error(res.error)
      return res?.data ?? res
    },
    enabled: open && !!studyId,
    staleTime: 60000
  })

  const activity = activityQuery.data
  const periodsByDeployment = useMemo(() => {
    const m = {}
    for (const d of activity?.deployments ?? []) m[d.deploymentID] = d.periods
    return m
  }, [activity])

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
        imageCount: d.imageCount,
        videoCount: d.videoCount,
        lat: d.latitude,
        lon: d.longitude
      })),
    [deploymentsQuery.data]
  )

  const handleSpeciesChange = (next) => {
    onChange({ ...filters, species: next.map((s) => s.scientificName) })
  }

  // Type-to-filter for long lists. Species are matched on common + scientific
  // name; the Blank pseudo-row is hidden when the query doesn't match "blank".
  const [speciesSearch, setSpeciesSearch] = useState('')
  const [deploymentSearch, setDeploymentSearch] = useState('')
  const [speciesSearchOpen, setSpeciesSearchOpen] = useState(false)
  const [deploymentSearchOpen, setDeploymentSearchOpen] = useState(false)
  // Closing the search clears its query so a hidden filter never lingers.
  const toggleSpeciesSearch = () => {
    if (speciesSearchOpen) setSpeciesSearch('')
    setSpeciesSearchOpen((o) => !o)
  }
  const toggleDeploymentSearch = () => {
    if (deploymentSearchOpen) setDeploymentSearch('')
    setDeploymentSearchOpen((o) => !o)
  }
  const sq = speciesSearch.trim().toLowerCase()
  const filteredSpeciesData = useMemo(() => {
    const d = speciesQuery.data ?? []
    return sq ? d.filter((s) => speciesSearchText(s.scientificName).includes(sq)) : d
  }, [speciesQuery.data, sq])
  const blankMatchesSearch = !sq || 'blank'.includes(sq)
  const showSpeciesSearch = (speciesQuery.data?.length ?? 0) > SEARCH_THRESHOLD

  const dq = deploymentSearch.trim().toLowerCase()
  const filteredDeployments = useMemo(
    () =>
      dq
        ? deploymentItems.filter((it) => (it.label || '').toLowerCase().includes(dq))
        : deploymentItems,
    [deploymentItems, dq]
  )
  const showDeploymentSearch = deploymentItems.length > SEARCH_THRESHOLD

  // Sort order per list: 'count' (default) or 'alpha'. Species sort is applied
  // inside SpeciesDistribution via sortMode; deployments are sorted here (the
  // composition arrives count-sorted, so 'count' is a no-op).
  const [speciesSort, setSpeciesSort] = useState('count')
  const [deploymentSort, setDeploymentSort] = useState('count')
  const toggleSpeciesSort = () => setSpeciesSort((m) => (m === 'count' ? 'alpha' : 'count'))
  const toggleDeploymentSort = () => setDeploymentSort((m) => (m === 'count' ? 'alpha' : 'count'))
  const sortedDeployments = useMemo(
    () =>
      deploymentSort === 'alpha'
        ? [...filteredDeployments].sort((a, b) => (a.label || '').localeCompare(b.label || ''))
        : filteredDeployments,
    [filteredDeployments, deploymentSort]
  )

  return (
    // In-flow side panel: animating its width pushes the grid/table to the left
    // (like Explore's species rail) instead of overlaying it. The left margin
    // animates with the width so the gap between the table and the pane collapses
    // when closed. The inner panel keeps a fixed width so its content doesn't
    // reflow during the animation.
    <div
      aria-hidden={!open}
      className={`flex-shrink-0 h-full overflow-hidden transition-all duration-300 ease-in-out motion-reduce:transition-none ${
        open ? 'w-80 opacity-100 ml-3' : 'w-0 opacity-0 ml-0'
      }`}
    >
      {/* Separated, rounded card — matches Explore's species rail rather than a
          flush panel glued to the table. */}
      {/* No header title here — the toolbar's "Filters" toggle already labels
          the pane, so repeating it would be redundant; "Clear all" lives in the
          toolbar next to the active-filter chips. */}
      <div className="w-80 h-full bg-card border border-border rounded-lg overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto min-h-0">
          <Section
            title="Species"
            count={filters.species.length}
            action={
              showSpeciesSearch ? (
                <div className="flex items-center gap-0.5">
                  <SortToggle mode={speciesSort} onToggle={toggleSpeciesSort} />
                  <SearchToggle
                    open={speciesSearchOpen}
                    onClick={toggleSpeciesSearch}
                    noun="species"
                  />
                </div>
              ) : null
            }
          >
            {speciesQuery.data ? (
              <>
                {speciesSearchOpen && (
                  <ListSearch
                    value={speciesSearch}
                    onChange={setSpeciesSearch}
                    placeholder="Search species"
                  />
                )}
                <div className="max-h-56 overflow-y-auto -mx-4">
                  <SpeciesDistribution
                    data={filteredSpeciesData}
                    taxonomicData={null}
                    selectedSpecies={selectedSpecies}
                    onSpeciesChange={handleSpeciesChange}
                    palette={palette}
                    studyId={studyId}
                    showHeader={false}
                    blankCount={blankMatchesSearch ? blankCount : 0}
                    vehicleCount={0}
                    allowEmpty
                    bordered={false}
                    sortMode={speciesSort}
                  />
                </div>
              </>
            ) : speciesQuery.isError ? (
              <div className="text-[13px] text-muted-foreground">Couldn’t load species.</div>
            ) : (
              <DistributionSkeleton />
            )}
          </Section>

          <Section
            title="Deployment"
            count={filters.deployments.length}
            action={
              showDeploymentSearch ? (
                <div className="flex items-center gap-0.5">
                  <SortToggle mode={deploymentSort} onToggle={toggleDeploymentSort} />
                  <SearchToggle
                    open={deploymentSearchOpen}
                    onClick={toggleDeploymentSearch}
                    noun="deployment"
                  />
                </div>
              ) : null
            }
          >
            {!deploymentsQuery.data && !deploymentsQuery.isError ? (
              <DistributionSkeleton />
            ) : (
              <>
                {deploymentSearchOpen && (
                  <ListSearch
                    value={deploymentSearch}
                    onChange={setDeploymentSearch}
                    placeholder="Search deployments"
                  />
                )}
                <DistributionList
                  items={sortedDeployments}
                  selected={filters.deployments}
                  onToggle={(value) =>
                    onChange({ ...filters, deployments: toggleInArray(filters.deployments, value) })
                  }
                  emptyLabel={dq ? 'No matches' : 'No deployments'}
                  hoverContent={(it) => (
                    <DeploymentHoverMap
                      lat={it.lat}
                      lon={it.lon}
                      label={it.label}
                      currentId={it.value}
                      others={deploymentItems}
                      detectionCount={it.detectionCount}
                      blankCount={it.blankCount}
                      imageCount={it.imageCount}
                      videoCount={it.videoCount}
                      periods={periodsByDeployment[it.value]}
                      percentile90Count={activity?.percentile90Count}
                      surveyStart={activity?.startDate}
                      surveyEnd={activity?.endDate}
                    />
                  )}
                />
              </>
            )}
          </Section>

          <Section title="Media type" count={filters.mediaTypes.length}>
            <div className="flex gap-2">
              {MEDIA_TYPE_OPTIONS.map(({ value, label, Icon }) => {
                const active = filters.mediaTypes.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      onChange({ ...filters, mediaTypes: toggleInArray(filters.mediaTypes, value) })
                    }
                    className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] font-medium ${
                      active
                        ? 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
                        : 'bg-card border-border text-foreground hover:bg-input-background'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 opacity-80" />
                    {label}
                  </button>
                )
              })}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
