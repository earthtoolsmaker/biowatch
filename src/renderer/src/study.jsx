import 'leaflet/dist/leaflet.css'
import {
  Cctv,
  Compass,
  Image,
  NotebookText,
  Play,
  Pause,
  Loader2,
  FolderOpen,
  Settings
} from 'lucide-react'
import { Route, Routes, useParams } from 'react-router'
import { ErrorBoundary } from 'react-error-boundary'
import { useQuery } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import Deployments from './deployments'
import Overview from './overview'
import Activity from './activity'
import Media from './media'
import Sources from './sources'
import StudySettings from './StudySettings'
import { useImportStatus } from '@renderer/hooks/import'
import { Tab } from './ui/Tab'

// Error fallback component
function ErrorFallback({ error, resetErrorBoundary }) {
  console.log('ErrorFallback', error.stack)

  const copyErrorToClipboard = () => {
    const errorDetails = `
      Error: ${error.message}
      Stack: ${error.stack}
      Time: ${new Date().toISOString()}
    `.trim()

    navigator.clipboard
      .writeText(errorDetails)

      .catch((err) => {
        console.error('Failed to copy error details:', err)
      })
  }

  return (
    <div className="p-4 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 rounded-md m-4">
      <h3 className="font-semibold mb-2">Something went wrong</h3>
      <p className="text-sm mb-2">There was an error loading this content.</p>
      <details className="text-xs bg-card p-2 rounded border border-red-200">
        <summary>Error details</summary>
        <pre className="mt-2 whitespace-pre-wrap">{error.message}</pre>
      </details>
      <div className="flex gap-2 mt-3">
        <button
          onClick={resetErrorBoundary}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm dark:bg-red-500/20 dark:hover:bg-red-500/30 dark:text-red-300"
        >
          Try again
        </button>
        <button
          onClick={copyErrorToClipboard}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm dark:bg-red-500/20 dark:hover:bg-red-500/30 dark:text-red-300"
        >
          Copy error
        </button>
      </div>
    </div>
  )
}

// Import status component to prevent unnecessary re-renders
function ImportStatus({ studyId, importerName }) {
  const { importStatus, resumeImport, pauseImport } = useImportStatus(studyId)

  console.log('ImportStatus', importStatus)

  const progress =
    importStatus && importStatus.total > 0 ? (importStatus.done / importStatus.total) * 100 : 0
  const showImportStatus =
    importerName?.startsWith('local/') &&
    importStatus &&
    importStatus.total > 0 &&
    importStatus.total > importStatus.done

  if (!showImportStatus) {
    return null
  }

  const etaMinutes = importStatus.estimatedMinutesRemaining
  const etaShort =
    !importStatus.isRunning || etaMinutes == null
      ? ''
      : etaMinutes < 1
        ? '<1 min'
        : etaMinutes >= 60
          ? `~${Math.round(etaMinutes / 60)}h`
          : `~${Math.round(etaMinutes)} min`

  const finishTime =
    importStatus.isRunning && etaMinutes != null && etaMinutes > 0
      ? new Date(
          // eslint-disable-next-line react-hooks/purity -- intentional: import polls re-render every second, refreshing the wall-clock finish time
          Date.now() + etaMinutes * 60_000
        ).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })
      : null

  const isStarting = importStatus.isRunning && importStatus.pausedCount + 1 > importStatus.done

  return (
    <div className="flex items-center gap-3 px-4 ml-auto">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            onClick={importStatus.isRunning ? pauseImport : resumeImport}
            className={`w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
              importStatus.isRunning
                ? 'bg-card hover:bg-accent border-border text-foreground'
                : 'bg-blue-50 hover:bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-500/15 dark:hover:bg-blue-500/25 dark:border-blue-500/40 dark:text-blue-300'
            }`}
            aria-label={
              isStarting
                ? 'Starting import'
                : importStatus.isRunning
                  ? 'Pause import'
                  : 'Resume import'
            }
          >
            {isStarting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : importStatus.isRunning ? (
              <Pause size={14} />
            ) : (
              <Play size={14} />
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={8}
            align="start"
            className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
          >
            <p className="font-medium mb-1 leading-snug">
              {isStarting ? 'Starting…' : importStatus.isRunning ? 'Pause import' : 'Resume import'}
            </p>
            <p className="text-muted-foreground leading-relaxed">
              {isStarting
                ? 'Waiting for the queue to pick up the next batch.'
                : importStatus.isRunning
                  ? 'Stop processing new media. Already-imported items are kept — click again to resume.'
                  : 'Continue processing from where it left off.'}
            </p>
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className="flex items-center gap-2 cursor-default">
            <div className="w-28 bg-muted rounded-full h-2">
              <div
                className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500 ease-in-out rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap min-w-[3.5rem]">
              {etaShort}
            </span>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={8}
            align="end"
            className="z-[10000] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
          >
            <ul className="space-y-1 tabular-nums leading-snug">
              <li className="flex gap-3">
                <span className="text-muted-foreground w-16">Progress</span>
                <span>{Math.round(progress)}%</span>
              </li>
              <li className="flex gap-3">
                <span className="text-muted-foreground w-16">Media</span>
                <span>
                  {importStatus.done.toLocaleString()} of {importStatus.total.toLocaleString()}
                </span>
              </li>
              {importStatus.isRunning && importStatus.speed > 0 && (
                <li className="flex gap-3">
                  <span className="text-muted-foreground w-16">Speed</span>
                  <span>{importStatus.speed} media/min</span>
                </li>
              )}
              {finishTime && (
                <li className="flex gap-3">
                  <span className="text-muted-foreground w-16">Finishes</span>
                  <span>≈ {finishTime}</span>
                </li>
              )}
            </ul>
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  )
}

export default function Study() {
  let { id } = useParams()

  const { data: study, error } = useQuery({
    queryKey: ['study', id],
    queryFn: async () => {
      const studies = await window.api.getStudies()
      const study = studies.find((s) => s.id === id)
      if (!study) {
        throw new Error(`Study with ID ${id} not found`)
      }
      return study
    },
    enabled: !!id
  })

  const { importStatus } = useImportStatus(id)
  const isImportActive =
    study?.importerName?.startsWith('local/') &&
    importStatus &&
    importStatus.total > 0 &&
    importStatus.total > importStatus.done

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500 dark:text-red-400">Error loading study: {error.message}</div>
      </div>
    )
  }

  if (!study) {
    return
  }

  return (
    <div className="flex gap-4 flex-col h-full">
      <header className="w-full border-b border-border sticky top-0 bg-card z-10">
        <div className="flex items-center">
          <nav aria-label="Tabs" className="-mb-px flex space-x-8 px-4">
            <Tab to={`/study/${id}`} icon={NotebookText} end compact={isImportActive}>
              Overview
            </Tab>
            <Tab to={`/study/${id}/activity`} icon={Compass} compact={isImportActive}>
              Explore
            </Tab>
            <Tab to={`/study/${id}/media`} icon={Image} compact={isImportActive}>
              Media
            </Tab>
            <Tab to={`/study/${id}/deployments`} icon={Cctv} compact={isImportActive}>
              Deployments
            </Tab>
            <Tab to={`/study/${id}/sources`} icon={FolderOpen} compact={isImportActive}>
              Sources
            </Tab>
            <Tab to={`/study/${id}/settings`} icon={Settings} compact={isImportActive}>
              Settings
            </Tab>
          </nav>
          <ImportStatus studyId={id} importerName={study?.importerName} />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto h-full pb-4">
        <Routes>
          <Route
            index
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'overview'}>
                <Overview data={study.data} studyId={id} studyName={study.name} />
              </ErrorBoundary>
            }
          />
          <Route
            path="activity"
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'activity'}>
                <Activity studyData={study.data} studyId={id} />
              </ErrorBoundary>
            }
          />
          <Route
            path="deployments"
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'deployments'}>
                <Deployments studyId={id} />
              </ErrorBoundary>
            }
          />
          <Route
            path="media"
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'media'}>
                <Media studyId={id} path={study.path} />
              </ErrorBoundary>
            }
          />
          <Route
            path="sources"
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'sources'}>
                <Sources studyId={id} importerName={study?.importerName} studyName={study?.name} />
              </ErrorBoundary>
            }
          />
          <Route
            path="settings"
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'settings'}>
                <StudySettings studyId={id} studyName={study.name} />
              </ErrorBoundary>
            }
          />
        </Routes>
      </div>
    </div>
  )
}
