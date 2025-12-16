import { Download, Search, Database, Check, Loader2, AlertCircle, X } from 'lucide-react'

const stages = [
  { key: 'downloading', label: 'Downloading metadata', icon: Download },
  { key: 'parsing', label: 'Parsing COCO format', icon: Search },
  { key: 'importing', label: 'Importing data', icon: Database }
]

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function StageRow({
  stage,
  currentStageIndex,
  stageIndex,
  downloadProgress,
  importProgress,
  parsingProgress
}) {
  const isComplete = currentStageIndex > stageIndex
  const isCurrent = currentStageIndex === stageIndex

  const Icon = stage.icon

  return (
    <div className="flex items-center gap-3 py-3">
      {/* Status icon */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isComplete
            ? 'bg-green-100 text-green-600'
            : isCurrent
              ? 'bg-blue-100 text-blue-600'
              : 'bg-gray-100 text-gray-400'
        }`}
      >
        {isComplete ? (
          <Check size={16} strokeWidth={3} />
        ) : isCurrent ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Icon size={16} />
        )}
      </div>

      {/* Label and progress */}
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm font-medium ${
            isComplete ? 'text-green-600' : isCurrent ? 'text-blue-600' : 'text-gray-400'
          }`}
        >
          {stage.label}
        </div>

        {/* Download progress bar */}
        {isCurrent && stage.key === 'downloading' && downloadProgress && (
          <div className="mt-2">
            {downloadProgress.totalBytes > 0 ? (
              <>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>
                    {formatBytes(downloadProgress.downloadedBytes)} of{' '}
                    {formatBytes(downloadProgress.totalBytes)}
                  </span>
                  <span>{Math.round(downloadProgress.percent)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300 animate-pulse"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-gray-500 mb-1">
                  {formatBytes(downloadProgress.downloadedBytes)} downloaded
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60" />
                </div>
              </>
            )}
          </div>
        )}

        {/* Import progress */}
        {isCurrent && stage.key === 'importing' && importProgress && (
          <div className="mt-2">
            <div className="text-xs text-gray-500 mb-1">
              <span className="font-medium">{importProgress.table}</span>
              {importProgress.totalRows > 0 && (
                <span>
                  {' '}
                  — {importProgress.insertedRows.toLocaleString()} /{' '}
                  {importProgress.totalRows.toLocaleString()} rows
                </span>
              )}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              {importProgress.totalRows > 0 ? (
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-150"
                  style={{
                    width: `${(importProgress.insertedRows / importProgress.totalRows) * 100}%`
                  }}
                />
              ) : (
                <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60" />
              )}
            </div>
          </div>
        )}

        {/* Parsing progress */}
        {isCurrent && stage.key === 'parsing' && parsingProgress && (
          <div className="mt-2">
            <div className="text-xs text-gray-500 mb-1">
              <span className="font-medium">{parsingProgress.phaseLabel}</span>
              {parsingProgress.total > 0 && (
                <span>
                  {' '}
                  — {parsingProgress.processed.toLocaleString()} /{' '}
                  {parsingProgress.total.toLocaleString()}
                </span>
              )}
              {!parsingProgress.total && parsingProgress.processed > 0 && (
                <span> — {parsingProgress.processed.toLocaleString()} counted</span>
              )}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              {parsingProgress.percent > 0 ? (
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-150"
                  style={{ width: `${Math.min(parsingProgress.percent, 100)}%` }}
                />
              ) : (
                <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60" />
              )}
            </div>
          </div>
        )}

        {/* Parsing stage pulsing indicator (when no parsingProgress yet) */}
        {isCurrent && stage.key === 'parsing' && !parsingProgress && (
          <div className="mt-2">
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60" />
            </div>
          </div>
        )}

        {/* Show pulsing indicator for importing when no importProgress yet */}
        {isCurrent && stage.key === 'importing' && !importProgress && (
          <div className="mt-2">
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LilaImportProgress({ isOpen, progress, onCancel }) {
  if (!isOpen) return null

  const {
    stage,
    stageIndex,
    datasetTitle,
    downloadProgress,
    importProgress,
    parsingProgress,
    error
  } = progress || {}

  const isError = stage === 'error'
  const isComplete = stage === 'complete'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {isError
                ? 'Import Failed'
                : isComplete
                  ? 'Import Complete'
                  : 'Importing LILA Dataset'}
            </h2>
            {!isComplete && !isError && (
              <button
                onClick={onCancel}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title="Cancel import"
              >
                <X size={20} />
              </button>
            )}
          </div>
          {datasetTitle && (
            <p className="text-sm text-gray-500 mt-1 truncate" title={datasetTitle}>
              {datasetTitle}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {isError ? (
            /* Error state */
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-600 mb-2">
                <AlertCircle size={20} />
                <span className="font-medium">Import Failed</span>
              </div>
              <p className="text-sm text-red-600 mb-4">
                {error?.message || 'Unknown error occurred'}
              </p>
            </div>
          ) : isComplete ? (
            /* Complete state */
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-600">
                <Check size={20} strokeWidth={3} />
                <span className="font-medium">Dataset imported successfully!</span>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Images will be loaded remotely as you browse the dataset.
              </p>
            </div>
          ) : (
            /* Progress stages */
            <div className="divide-y divide-gray-100">
              {stages.map((s, idx) => (
                <StageRow
                  key={s.key}
                  stage={s}
                  stageIndex={idx}
                  currentStageIndex={stageIndex}
                  downloadProgress={s.key === 'downloading' ? downloadProgress : null}
                  importProgress={s.key === 'importing' ? importProgress : null}
                  parsingProgress={s.key === 'parsing' ? parsingProgress : null}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200">
          {isError ? (
            <button
              onClick={onCancel}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 rounded-md transition-colors"
            >
              Close
            </button>
          ) : isComplete ? (
            <div className="text-center text-sm text-gray-500">Redirecting to study...</div>
          ) : (
            <button
              onClick={onCancel}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Cancel Import
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default LilaImportProgress
