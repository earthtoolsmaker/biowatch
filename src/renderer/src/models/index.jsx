import { useState, useCallback } from 'react'
import MapPane from './MapPane'
import ModelListPane from './ModelListPane'

export default function MlZoo({ modelZoo }) {
  const [selectedId, setSelectedId] = useState(
    () => modelZoo.find((m) => m.region === 'worldwide')?.reference.id ?? null
  )
  const [openSpeciesId, setOpenSpeciesId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [downloadedSet, setDownloadedSet] = useState(new Set())

  const handleSelect = useCallback((id) => setSelectedId(id), [])
  const handleToggleSpecies = useCallback(
    (id) => setOpenSpeciesId((cur) => (cur === id ? null : id)),
    []
  )
  const handleDownloadStatusChange = useCallback((modelId, isDownloaded) => {
    setDownloadedSet((prev) => {
      const next = new Set(prev)
      if (isDownloaded) next.add(modelId)
      else next.delete(modelId)
      return next
    })
  }, [])
  const handleClearAll = useCallback(async () => {
    try {
      const result = await window.api.clearAllLocalMLModel()
      if (result?.success) setRefreshKey((k) => k + 1)
    } catch (err) {
      console.error('Clear all failed', err)
    }
  }, [])

  return (
    <div className="max-w-[1950px] mx-auto w-full px-6 py-4 space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        <span className="text-foreground font-medium">
          Choose the model whose coverage best matches your study sites.
        </span>{' '}
        Regional models (Europe, Himalayas) are usually more accurate within their range. The
        Worldwide model is a flexible baseline that works anywhere but with broader, less
        specialized coverage.
      </p>
      <MapPane modelZoo={modelZoo} selectedId={selectedId} onSelect={handleSelect} />
      <ModelListPane
        modelZoo={modelZoo}
        selectedId={selectedId}
        openSpeciesId={openSpeciesId}
        onSelect={handleSelect}
        onToggleSpecies={handleToggleSpecies}
        refreshKey={refreshKey}
        downloadedCount={downloadedSet.size}
        onDownloadStatusChange={handleDownloadStatusChange}
        onClearAll={handleClearAll}
      />
    </div>
  )
}
