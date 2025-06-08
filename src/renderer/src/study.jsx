import 'leaflet/dist/leaflet.css'
import { Cctv, ChartBar, Image, NotebookText } from 'lucide-react'
import { NavLink, Route, Routes, useParams } from 'react-router'
import { ErrorBoundary } from 'react-error-boundary'
import Deployments from './deployments'
import Overview from './overview'
import Activity from './activity'
import Media from './media'
import { useEffect, useState } from 'react'

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

export default function Study({ onUpdateStudy }) {
  let { id } = useParams()
  console.log('window', window.location.href)
  const study = JSON.parse(localStorage.getItem('studies')).find((study) => study.id === id)
  console.log('S', study)

  return (
    <div className="flex gap-4 flex-col h-full">
      <header className="w-full flex border-b border-gray-200 divide-gray-200 divide-x sticky top-0 bg-white z-10 rounded-tl-md rounded-tr-md [&>a:last-child]:rounded-tr-md [&>a:first-child]:rounded-tl-md">
        <NavLink
          to={`/study/${id}`}
          end
          className={({ isActive }) =>
            `${isActive ? 'bg-gray-100' : ''} hover:bg-gray-100 transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <NotebookText color="black" size={20} className="pb-[2px]" />
          Overview
        </NavLink>
        <NavLink
          to={`/study/${id}/activity`}
          className={({ isActive }) =>
            `${isActive ? 'bg-gray-100' : ''} cursor-pointer hover:bg-gray-100 transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <ChartBar color="black" size={20} className="pb-[2px]" />
          Activity
        </NavLink>
        <NavLink
          to={`/study/${id}/media`}
          className={({ isActive }) =>
            `${isActive ? 'bg-gray-100' : ''} cursor-pointer hover:bg-gray-100 transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <Image color="black" size={20} className="pb-[2px]" />
          Media
        </NavLink>
        <NavLink
          to={`/study/${id}/deployments`}
          className={({ isActive }) =>
            `${isActive ? 'bg-gray-100' : ''} cursor-pointer hover:bg-gray-100 transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <Cctv color="black" size={20} className="pb-[2px]" />
          Deployments
        </NavLink>
      </header>
      <div className="flex-1 overflow-y-auto h-full pb-4">
        <Routes>
          <Route
            index
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'overview'}>
                <Overview
                  data={study.data}
                  studyId={id}
                  studyName={study.name}
                  importerName={study.importerName}
                  onUpdateStudy={onUpdateStudy}
                />
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
        </Routes>
      </div>
    </div>
  )
}
