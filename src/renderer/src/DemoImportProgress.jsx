import { Download, FolderOpen, Database, Check, Loader2, AlertCircle } from 'lucide-react'

const stages = [
  { key: 'downloading', label: 'Downloading', icon: Download },
  { key: 'extracting', label: 'Extracting', icon: FolderOpen },
  { key: 'importing_csvs', label: 'Importing data', icon: Database }
]

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function StageRow({ stage, currentStageIndex, stageIndex, downloadProgress, csvProgress }) {
  const isComplete = currentStageIndex > stageIndex
  const isCurrent = currentStageIndex === stageIndex

  const Icon = stage.icon

  return (
    <div className="flex items-center gap-3 py-3">
      {/* Status icon */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isComplete
            ? 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400'
            : isCurrent
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
              : 'bg-muted text-muted-foreground'
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
            isComplete
              ? 'text-green-600 dark:text-green-400'
              : isCurrent
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-muted-foreground'
          }`}
        >
          {stage.label}
        </div>

        {/* Download progress bar */}
        {isCurrent && stage.key === 'downloading' && downloadProgress && (
          <div className="mt-2">
            {downloadProgress.totalBytes > 0 ? (
              <>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>
                    {formatBytes(downloadProgress.downloadedBytes)} of{' '}
                    {formatBytes(downloadProgress.totalBytes)}
                  </span>
                  <span>{Math.round(downloadProgress.percent)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300 animate-pulse dark:bg-blue-500"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-muted-foreground mb-1">
                  {formatBytes(downloadProgress.downloadedBytes)} downloaded
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60 dark:bg-blue-500" />
                </div>
              </>
            )}
          </div>
        )}

        {/* CSV import progress */}
        {isCurrent && stage.key === 'importing_csvs' && csvProgress && (
          <div className="mt-2">
            <div className="text-xs text-muted-foreground mb-1">
              <span className="font-medium">{csvProgress.currentFile}</span>
              {csvProgress.totalRows > 0 && (
                <span>
                  {' '}
                  — {csvProgress.insertedRows.toLocaleString()} /{' '}
                  {csvProgress.totalRows.toLocaleString()} rows
                </span>
              )}
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              {csvProgress.totalRows > 0 ? (
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-150 dark:bg-blue-500"
                  style={{ width: `${(csvProgress.insertedRows / csvProgress.totalRows) * 100}%` }}
                />
              ) : (
                <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60 dark:bg-blue-500" />
              )}
            </div>
          </div>
        )}

        {/* Extracting stage - always indeterminate */}
        {isCurrent && stage.key === 'extracting' && (
          <div className="mt-2">
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60 dark:bg-blue-500" />
            </div>
          </div>
        )}

        {/* Show pulsing indicator for importing_csvs when no csvProgress yet */}
        {isCurrent && stage.key === 'importing_csvs' && !csvProgress && (
          <div className="mt-2">
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60 dark:bg-blue-500" />
            </div>
          </div>
        )}

        {/* Show pulsing indicator for downloading when no downloadProgress yet */}
        {isCurrent && stage.key === 'downloading' && !downloadProgress && (
          <div className="mt-2">
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full opacity-60 dark:bg-blue-500" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DemoImportProgress({ isOpen, progress, onClose }) {
  if (!isOpen) return null

  const { stage, stageIndex, datasetTitle, downloadProgress, csvProgress, error } = progress || {}

  const isError = stage === 'error'
  const isComplete = stage === 'complete'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        data-testid="demo-progress-modal"
        className="bg-card rounded-lg shadow-xl max-w-md w-full mx-4"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {isError
                ? 'Import Failed'
                : isComplete
                  ? 'Import Complete'
                  : 'Importing Demo Dataset'}
            </h2>
          </div>
          {datasetTitle && (
            <p className="text-sm text-muted-foreground mt-1 truncate" title={datasetTitle}>
              {datasetTitle}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {isError ? (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-4 dark:bg-red-500/15">
              <div className="flex items-center gap-2 text-red-600 mb-2 dark:text-red-400">
                <AlertCircle size={20} />
                <span className="font-medium">Import Failed</span>
              </div>
              <p className="text-sm text-red-600 mb-4 dark:text-red-400">
                {error?.message || 'Unknown error occurred'}
              </p>
            </div>
          ) : isComplete ? (
            <div
              data-testid="demo-import-complete"
              className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-lg p-4 dark:bg-green-500/15"
            >
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <Check size={20} strokeWidth={3} />
                <span className="font-medium">Demo dataset imported successfully!</span>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {stages.map((s, idx) => (
                <StageRow
                  key={s.key}
                  stage={s}
                  stageIndex={idx}
                  currentStageIndex={stageIndex}
                  downloadProgress={s.key === 'downloading' ? downloadProgress : null}
                  csvProgress={s.key === 'importing_csvs' ? csvProgress : null}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border">
          {isError ? (
            <button
              onClick={onClose}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md transition-colors"
            >
              Close
            </button>
          ) : isComplete ? (
            <div className="text-center text-sm text-muted-foreground">Redirecting to study...</div>
          ) : (
            <div className="text-center text-sm text-muted-foreground">Please wait...</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default DemoImportProgress
