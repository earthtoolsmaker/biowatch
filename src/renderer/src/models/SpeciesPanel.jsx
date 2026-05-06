import { useEffect, useMemo, useState } from 'react'
import * as HoverCard from '@radix-ui/react-hover-card'
import { filterSpecies, classSummary } from './speciesPanelHelpers'
import SpeciesTooltipContent from '../ui/SpeciesTooltipContent'
import { resolveSpeciesInfo } from '../../../shared/speciesInfo/index.js'

function SpeciesChip({ species }) {
  const info = resolveSpeciesInfo(species.scientific)
  const hasContent = !!(info?.imageUrl || info?.blurb || info?.iucn)

  const chip = (
    <span className="text-[10px] bg-card border border-border rounded-full px-2 py-0.5 text-foreground cursor-default">
      {species.common}
    </span>
  )

  if (!hasContent) return chip

  return (
    <HoverCard.Root openDelay={200} closeDelay={120}>
      <HoverCard.Trigger asChild>{chip}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          sideOffset={6}
          align="center"
          avoidCollisions
          collisionPadding={16}
          className="z-[10001]"
        >
          <SpeciesTooltipContent imageData={{ scientificName: species.scientific }} size="md" />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}

const SMALL_LIST_THRESHOLD = 50

const speciesCache = new Map()

async function loadSpecies(name) {
  if (speciesCache.has(name)) return speciesCache.get(name)
  const mod = await import(`../../../shared/species/${name}.json`)
  const data = mod.default
  speciesCache.set(name, data)
  return data
}

export default function SpeciesPanel({ model }) {
  const [data, setData] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    loadSpecies(model.species_data).then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [model.species_data])

  if (!data) {
    return (
      <div className="mt-2 p-2 bg-muted rounded border border-border text-xs text-muted-foreground">
        Loading species…
      </div>
    )
  }

  const total = data.summary?.total ?? data.species.length
  const isLarge = total > SMALL_LIST_THRESHOLD
  const searchable = data.species && data.species.length > 0

  return (
    <div
      className="mt-2 p-2 bg-muted rounded border border-border cursor-default"
      onClick={(e) => e.stopPropagation()}
    >
      {searchable && (
        <input
          type="text"
          placeholder={isLarge ? 'Search any species…' : 'Filter species…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-2 py-1 text-xs border border-border rounded mb-2 bg-card"
        />
      )}
      {isLarge ? (
        <LargeView data={data} query={query} searchable={searchable} />
      ) : (
        <SmallView data={data} query={query} />
      )}
    </div>
  )
}

function SmallView({ data, query }) {
  const filtered = useMemo(() => filterSpecies(data.species, query), [data.species, query])
  if (filtered.length === 0) {
    return <div className="text-xs text-muted-foreground italic">No matches.</div>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {filtered.map((s) => (
        <SpeciesChip key={s.scientific || s.common} species={s} />
      ))}
    </div>
  )
}

function LargeView({ data, query, searchable }) {
  const summary = useMemo(() => classSummary(data), [data])
  const filtered = useMemo(() => filterSpecies(data.species || [], query), [data.species, query])

  if (searchable && query.trim()) {
    if (filtered.length === 0) {
      return <div className="text-xs text-muted-foreground italic">No matches.</div>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {filtered.slice(0, 50).map((s) => (
          <SpeciesChip key={s.scientific || s.common} species={s} />
        ))}
        {filtered.length > 50 && (
          <span className="text-[10px] text-muted-foreground italic px-2 py-0.5">
            …and {filtered.length - 50} more
          </span>
        )}
      </div>
    )
  }

  if (!summary.classes) {
    return <div className="text-xs text-muted-foreground italic">No taxonomic data available.</div>
  }

  return (
    <div className="flex flex-col gap-1">
      {summary.classes.map((c) => (
        <div key={c.id} className="flex justify-between items-center px-2 py-1 text-xs">
          <span>
            {c.icon} {c.label}
          </span>
          <span className="text-muted-foreground text-[10px]">
            {c.approximate ? '~' : ''}
            {c.count}
          </span>
        </div>
      ))}
      {!searchable && (
        <div className="text-[10px] text-muted-foreground italic px-2 pt-2">
          Per-species search coming soon.
        </div>
      )}
    </div>
  )
}
