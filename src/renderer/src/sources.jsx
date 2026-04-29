import { useState } from 'react'
import { useParams } from 'react-router'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useImportStatus } from '@renderer/hooks/import'
import { Folder, Globe, Package, ChevronDown, ChevronRight, Info, Check } from 'lucide-react'
import SkeletonSourcesList from './ui/SkeletonSourcesList'

function SourceIcon({ importerName }) {
  if (importerName === 'lila/coco') return <Globe size={20} className="text-gray-400" />
  if (importerName === 'camtrap/datapackage') return <Package size={20} className="text-gray-400" />
  return <Folder size={20} className="text-gray-400" />
}

function StatusCell({ row }) {
  if (row.activeRun) {
    const total = row.activeRun.total
    const pct = total > 0 ? Math.min((row.activeRun.processed / total) * 100, 100) : 0
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-gray-500 tabular-nums">
          {row.activeRun.processed.toLocaleString()} / {total.toLocaleString()}
        </span>
        <div className="w-[140px] h-1 bg-gray-200 rounded">
          <div className="h-full bg-blue-500 rounded transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  if (row.observationCount > 0) {
    return (
      <span
        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-emerald-500 text-white"
        title={`${row.observationCount.toLocaleString()} observations`}
      >
        <Check size={11} strokeWidth={3} />
      </span>
    )
  }
  return null
}

function MediaCounts({ imageCount, videoCount, deploymentCount }) {
  const parts = []
  if (imageCount > 0) {
    parts.push(
      <span key="img">
        <strong className="text-gray-900">{imageCount.toLocaleString()}</strong> images
      </span>
    )
  }
  if (videoCount > 0) {
    parts.push(
      <span key="vid">
        <strong className="text-gray-900">{videoCount.toLocaleString()}</strong> videos
      </span>
    )
  }
  if (deploymentCount > 0) {
    parts.push(
      <span key="dep">
        {deploymentCount} deployment{deploymentCount !== 1 ? 's' : ''}
      </span>
    )
  }
  return (
    <div className="text-xs text-gray-500 tabular-nums">
      {parts.flatMap((p, i) => (i === 0 ? [p] : [<span key={`sep${i}`}> · </span>, p]))}
    </div>
  )
}

function basenameOf(p) {
  if (!p) return ''
  const cleaned = p.replace(/[/\\]+$/, '')
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'))
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned
}

function SourceRow({ source, importerName, studyName, expanded, onToggle }) {
  const canExpand = source.deployments.length > 0
  const hasImportFolder = !!source.importFolder
  // Treat importFolder as a path/URL when it contains a separator. Local imports
  // and CamtrapDP package directories show their basename as the row label so
  // the unique part is visible without ellipsis truncation; the full path lives
  // on line 2 with RTL ellipsis. LILA-style importFolder (just a dataset name)
  // has no separator and renders unchanged on a single line.
  const isPathLike =
    hasImportFolder &&
    (source.importFolder.startsWith('/') ||
      source.importFolder.startsWith('http') ||
      source.importFolder.includes('\\'))
  const label = !hasImportFolder
    ? studyName || 'Imported dataset'
    : isPathLike
      ? basenameOf(source.importFolder) || source.importFolder
      : source.importFolder
  const showPathLine = isPathLike
  return (
    <>
      <div
        className="flex items-center gap-4 px-2 py-4 border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
        onClick={canExpand ? onToggle : undefined}
      >
        <div className="w-5 text-gray-500">
          {canExpand ? expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : null}
        </div>
        <div className="w-[22px] flex justify-center">
          <SourceIcon importerName={importerName} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <span className="truncate">{label}</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
              {source.isRemote ? 'Remote' : 'Local'}
            </span>
            {source.lastModelUsed && (
              <span
                title={`Last model: ${source.lastModelUsed.modelID} ${source.lastModelUsed.modelVersion}`}
                className="text-gray-400 flex-shrink-0"
              >
                <Info size={13} />
              </span>
            )}
          </div>
          {showPathLine && (
            <div
              className="text-xs text-gray-400 font-mono mt-0.5 truncate"
              style={{ direction: 'rtl', textAlign: 'left' }}
              title={source.importFolder}
            >
              {'‎' + source.importFolder}
            </div>
          )}
        </div>
        <MediaCounts
          imageCount={source.imageCount}
          videoCount={source.videoCount}
          deploymentCount={source.deploymentCount}
        />
        <div className="w-[200px] flex justify-end">
          <StatusCell row={source} />
        </div>
      </div>
      {expanded &&
        source.deployments.map((d) => (
          <div
            key={d.deploymentID}
            className="ml-14 flex items-center gap-4 px-2 py-3 border-b border-gray-100 hover:bg-gray-50"
          >
            <div className="flex-1 min-w-0 text-sm text-gray-700 truncate">{d.label}</div>
            <MediaCounts imageCount={d.imageCount} videoCount={d.videoCount} deploymentCount={0} />
            <div className="w-[200px] flex justify-end">
              <StatusCell row={d} />
            </div>
          </div>
        ))}
    </>
  )
}

export default function Sources({ studyId, importerName, studyName }) {
  const { id } = useParams()
  const actualStudyId = studyId || id
  const queryClient = useQueryClient()
  const { importStatus } = useImportStatus(actualStudyId)
  const [expanded, setExpanded] = useState({})

  const {
    data: sources = [],
    isLoading,
    error
  } = useQuery({
    queryKey: ['sourcesData', actualStudyId, importStatus?.isRunning],
    queryFn: async () => {
      const response = await window.api.getSourcesData(actualStudyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    refetchInterval: () => (importStatus?.isRunning ? 3000 : false),
    enabled: !!actualStudyId
  })

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Error: {error.message}</div>
      </div>
    )
  }

  const totalMedia = sources.reduce((s, r) => s + r.imageCount + r.videoCount, 0)
  const canAddSource =
    importerName?.startsWith('local/') ||
    importerName === 'wildlife/folder' ||
    importerName === 'camtrap/datapackage'

  const handleAddSource = async () => {
    await window.api.selectMoreImagesDirectory(actualStudyId)
    queryClient.invalidateQueries({ queryKey: ['importStatus', actualStudyId] })
    queryClient.invalidateQueries({ queryKey: ['sourcesData', actualStudyId] })
  }

  return (
    <div className="h-full overflow-y-auto py-3">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {isLoading ? (
          <SkeletonSourcesList />
        ) : (
          <>
            <header className="flex items-center justify-between pb-3">
              <div className="text-sm text-gray-500">
                {sources.length} source{sources.length !== 1 ? 's' : ''} ·{' '}
                {totalMedia.toLocaleString()} media files
              </div>
              <button
                onClick={handleAddSource}
                disabled={!canAddSource}
                className={`border border-gray-200 bg-white px-3 py-1.5 rounded-md text-sm ${
                  canAddSource ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed'
                }`}
              >
                + Add source
              </button>
            </header>
            {sources.length === 0 ? (
              <div className="text-gray-500 text-sm py-8 text-center">No sources</div>
            ) : (
              <div>
                {sources.map((source) => (
                  <SourceRow
                    key={source.importFolder || '__unnamed__'}
                    source={source}
                    importerName={importerName}
                    studyName={studyName}
                    expanded={!!expanded[source.importFolder]}
                    onToggle={() =>
                      setExpanded((e) => ({
                        ...e,
                        [source.importFolder]: !e[source.importFolder]
                      }))
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
