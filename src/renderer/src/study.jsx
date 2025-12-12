import 'leaflet/dist/leaflet.css'
import {
  Cctv,
  ChartBar,
  Image,
  NotebookText,
  Download,
  Pause,
  FolderOpen,
  Settings
} from 'lucide-react'
import { NavLink, Route, Routes, useParams } from 'react-router'
import { ErrorBoundary } from 'react-error-boundary'
import { useQuery } from '@tanstack/react-query'
import Deployments from './deployments'
import Overview from './overview'
import Activity from './activity'
import Media from './media'
import Files from './files'
import StudySettings from './StudySettings'
import { useImportStatus } from '@renderer/hooks/import'
import { Tab } from './components/Tab'

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
    <div className="p-4 bg-red-50 text-red-700 rounded-md m-4">
      <h3 className="font-semibold mb-2">Something went wrong</h3>
      <p className="text-sm mb-2">There was an error loading this content.</p>
      <details className="text-xs bg-white p-2 rounded border border-red-200">
        <summary>Error details</summary>
        <pre className="mt-2 whitespace-pre-wrap">{error.message}</pre>
      </details>
      <div className="flex gap-2 mt-3">
        <button
          onClick={resetErrorBoundary}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm"
        >
          Try again
        </button>
        <button
          onClick={copyErrorToClipboard}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm"
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

  // Calculate progress for display
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

  // Calculate width based on number of digits in total (accounting for both done and total)
  const totalDigits = importStatus.total.toString().length
  const spanWidth = `${totalDigits * 2 + 2}ch` // Minimum width with scaling

  return (
    <div className="flex items-center gap-3 px-4 ml-auto">
      <button
        onClick={importStatus.isRunning ? pauseImport : resumeImport}
        className="px-2 py-0.5 bg-white hover:bg-gray-50 border border-gray-300 rounded text-sm font-medium text-gray-700 transition-colors flex items-center gap-1"
        title={importStatus.isRunning ? 'Pause import' : 'Resume import'}
      >
        {importStatus.isRunning ? (
          <Pause size={14} color="black" />
        ) : (
          <Download size={14} color="black" />
        )}
        {importStatus.isRunning
          ? importStatus.pausedCount + 1 > importStatus.done
            ? 'Starting'
            : 'Pause'
          : 'Resume'}
      </button>

      <span className="text-gray-600 tabular-nums text-xs" style={{ width: spanWidth }}>
        {importStatus.done} / {importStatus.total}
      </span>

      <div className={`w-20 bg-gray-200 rounded-full h-2`}>
        <div
          className={`h-full bg-blue-600 transition-all duration-500 ease-in-out rounded-full`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <span
        className="text-xs text-gray-600 text-right"
        title={`${importStatus.speed} media/minute`}
      >
        {importStatus.estimatedMinutesRemaining
          ? importStatus.estimatedMinutesRemaining > 60
            ? `${Math.round(importStatus.estimatedMinutesRemaining / 60)} hrs remaining`
            : `${Math.round(importStatus.estimatedMinutesRemaining)} mins remaining`
          : ''}
      </span>
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

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Error loading study: {error.message}</div>
      </div>
    )
  }

  if (!study) {
    return
  }

  return (
    <div className="flex gap-4 flex-col h-full">
      <header className="w-full border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
        <div className="flex items-center">
          <nav aria-label="Tabs" className="-mb-px flex space-x-8 px-4">
            <Tab to={`/study/${id}`} icon={NotebookText} end>
              Overview
            </Tab>
            <Tab to={`/study/${id}/activity`} icon={ChartBar}>
              Activity
            </Tab>
            <Tab to={`/study/${id}/media`} icon={Image}>
              Media
            </Tab>
            <Tab to={`/study/${id}/deployments`} icon={Cctv}>
              Deployments
            </Tab>
            {study?.importerName?.startsWith('local/') && (
              <Tab to={`/study/${id}/files`} icon={FolderOpen}>
                Files
              </Tab>
            )}
            <Tab to={`/study/${id}/settings`} icon={Settings}>
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
          {study?.importerName?.startsWith('local/') && (
            <Route
              path="files"
              element={
                <ErrorBoundary FallbackComponent={ErrorFallback} key={'files'}>
                  <Files studyId={id} />
                </ErrorBoundary>
              }
            />
          )}
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
