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

      <div
        className={`w-20 bg-gray-200 rounded-full h-2 ${importStatus.isRunning ? 'animate-progress-pulse' : ''}`}
      >
        <div
          className={`h-full bg-blue-600 transition-all duration-500 ease-in-out rounded-full ${importStatus.isRunning ? 'animate-bar-glow' : ''}`}
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
      <header className="w-full flex border-b border-gray-200 divide-gray-200 divide-x sticky top-0 bg-white z-10 rounded-tl-md rounded-tr-md [&>a:last-child]:rounded-tr-md [&>a:first-child]:rounded-tl-md">
        <NavLink
          to={`/study/${id}`}
          end
          className={({ isActive }) =>
            `${isActive ? 'bg-white' : 'bg-gray-100'} hover:bg-white transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <NotebookText color="black" size={20} className="pb-[2px]" />
          Overview
        </NavLink>
        <NavLink
          to={`/study/${id}/activity`}
          className={({ isActive }) =>
            `${isActive ? 'bg-white' : 'bg-gray-100'} cursor-pointer hover:bg-white transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <ChartBar color="black" size={20} className="pb-[2px]" />
          Activity
        </NavLink>
        <NavLink
          to={`/study/${id}/media`}
          className={({ isActive }) =>
            `${isActive ? 'bg-white' : 'bg-gray-100'} cursor-pointer hover:bg-white transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <Image color="black" size={20} className="pb-[2px]" />
          Media
        </NavLink>
        <NavLink
          to={`/study/${id}/deployments`}
          className={({ isActive }) =>
            `${isActive ? 'bg-white' : 'bg-gray-100'} cursor-pointer hover:bg-white transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <Cctv color="black" size={20} className="pb-[2px]" />
          Deployments
        </NavLink>
        {study?.importerName?.startsWith('local/') && (
          <NavLink
            to={`/study/${id}/files`}
            className={({ isActive }) =>
              `${isActive ? 'bg-white' : 'bg-gray-100'} cursor-pointer hover:bg-white transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
            }
          >
            <FolderOpen color="black" size={20} className="pb-[2px]" />
            Files
          </NavLink>
        )}
        <NavLink
          to={`/study/${id}/settings`}
          className={({ isActive }) =>
            `${isActive ? 'bg-white' : 'bg-gray-100'} cursor-pointer hover:bg-white transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <Settings color="black" size={20} className="pb-[2px]" />
          Settings
        </NavLink>

        <ImportStatus studyId={id} importerName={study?.importerName} />
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
