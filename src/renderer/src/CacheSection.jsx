import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

import { formatBytes } from './utils/formatBytes.js'

const BREAKDOWN_LABELS = {
  transcodes: 'Transcoded videos',
  thumbnails: 'Video thumbnails',
  images: 'Remote images',
  videos: 'Source videos'
}

function formatRow(entry) {
  if (!entry) return '— · — files'
  return `${formatBytes(entry.bytes)} · ${entry.files.toLocaleString()} files`
}

export default function CacheSection({ studyId }) {
  const [clearing, setClearing] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const [expanded, setExpanded] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['study-cache-stats', studyId],
    queryFn: () => window.api.getStudyCacheStats(studyId)
  })

  const total = data?.total ?? { bytes: 0, files: 0 }
  const breakdown = data?.breakdown
  const isEmpty = !isLoading && total.bytes === 0 && total.files === 0

  const handleClear = async () => {
    setClearing(true)
    setLastResult(null)
    try {
      const result = await window.api.clearStudyCache(studyId)
      setLastResult(result)
      await refetch()
    } catch (e) {
      setLastResult({ error: e.message })
    } finally {
      setClearing(false)
    }
  }

  return (
    <section className="py-6">
      <h2 className="text-base font-medium text-foreground mb-1">Cache</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Cached transcoded videos, thumbnails, and remote images. Cleared files are regenerated
        automatically when needed.
      </p>

      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-foreground">Total used</span>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-foreground">
            {isLoading ? '…' : formatRow(total)}
          </span>
          <button
            onClick={handleClear}
            disabled={isLoading || isEmpty || clearing}
            className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {clearing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Clearing…
              </>
            ) : (
              'Clear'
            )}
          </button>
        </div>
      </div>

      {lastResult?.error && (
        <p className="text-sm text-red-600 mt-1 dark:text-red-400">
          Failed to clear cache: {lastResult.error}
        </p>
      )}
      {lastResult && !lastResult.error && (
        <p className="text-sm text-green-700 mt-1 dark:text-green-400">
          Cleared {formatBytes(lastResult.freedBytes)} · {lastResult.clearedFiles.toLocaleString()}{' '}
          files
        </p>
      )}

      {!isEmpty && !isLoading && (
        <button
          onClick={() => setExpanded((v) => !v)}
          disabled={clearing}
          className="cursor-pointer flex items-center gap-1 mt-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {expanded ? 'Hide breakdown' : 'Show breakdown'}
        </button>
      )}

      {expanded && breakdown && (
        <div className="mt-2 pl-5 divide-y divide-gray-100">
          {Object.keys(BREAKDOWN_LABELS).map((key) => (
            <div key={key} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground">{BREAKDOWN_LABELS[key]}</span>
              <span className="text-sm tabular-nums text-foreground">
                {formatRow(breakdown[key])}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
