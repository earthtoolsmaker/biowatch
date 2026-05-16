import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Trash2 } from 'lucide-react'
import ModelCard from './ModelCard'
import SpeciesPanel from './SpeciesPanel'
import CustomModelCard from './CustomModelCard'

function orderModels(modelZoo) {
  const worldwide = modelZoo.filter((m) => m.region === 'worldwide')
  const regional = modelZoo
    .filter((m) => m.region !== 'worldwide')
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...worldwide, ...regional]
}

export default function ModelListPane({
  modelZoo,
  selectedId,
  openSpeciesId,
  onSelect,
  onToggleSpecies,
  refreshKey,
  downloadedCount,
  onDownloadStatusChange,
  onClearAll
}) {
  const ordered = useMemo(() => orderModels(modelZoo), [modelZoo])

  const location = useLocation()
  const navigate = useNavigate()
  const cardRefs = useRef(new Map())
  const [highlightedKey, setHighlightedKey] = useState(null)

  useEffect(() => {
    const target = location.state?.highlightModel
    if (!target) return
    const key = `${target.id}-${target.version}`
    const el = cardRefs.current.get(key)
    if (!el) return

    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedKey(key)
    const t = setTimeout(() => setHighlightedKey(null), 1500)

    // Clear the route state so back/forward navigation doesn't re-trigger.
    navigate(location.pathname, { replace: true, state: null })

    return () => clearTimeout(t)
  }, [location.state, location.pathname, navigate])

  return (
    <div className="min-w-0">
      <div className="flex justify-between items-center mb-2 px-1">
        <span className="text-xs font-semibold text-foreground">
          {modelZoo.length} models · {downloadedCount} downloaded
        </span>
        {downloadedCount > 0 && (
          <button
            onClick={onClearAll}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <Trash2 size={12} />
            Clear all
          </button>
        )}
      </div>

      {ordered.map((model) => {
        const key = `${model.reference.id}-${model.reference.version}`
        const isHighlighted = highlightedKey === key
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) cardRefs.current.set(key, el)
              else cardRefs.current.delete(key)
            }}
            className={
              isHighlighted
                ? 'rounded-lg ring-2 ring-blue-400 ring-offset-2 ring-offset-background transition-shadow duration-700'
                : 'transition-shadow duration-700'
            }
          >
            <ModelCard
              model={model}
              selected={selectedId === model.reference.id}
              speciesOpen={openSpeciesId === model.reference.id}
              onSelect={onSelect}
              onToggleSpecies={onToggleSpecies}
              speciesPanel={<SpeciesPanel model={model} />}
              refreshKey={refreshKey}
              onDownloadStatusChange={onDownloadStatusChange}
            />
          </div>
        )
      })}

      <CustomModelCard />
    </div>
  )
}
