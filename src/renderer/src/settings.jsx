import { NavLink, Navigate, Route, Routes } from 'react-router'
import { ErrorBoundary } from 'react-error-boundary'
import { BrainCircuit, Info, Github, Earth } from 'lucide-react'
import Zoo from './model_zoo'

function SettingsInfo({ version, platform }) {
  return (
    <div className="p-4">
      <ul className="list-none space-y-2">
        <li className="flex items-center">
          <span className="font-semibold">
            Biowatch version {version} for {platform}
          </span>
        </li>
        <li className="flex items-center">
          <Github size={14} className="mr-2" />
          <a
            href="https://github.com/earthtoolsmaker/biowatch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            https://github.com/earthtoolsmaker/biowatch
          </a>
        </li>
        <li className="flex items-center">
          <Earth size={14} className="mr-2" />
          <a
            href="https://www.earthtoolsmaker.org/tools/biowatch/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            https://www.earthtoolsmaker.org/tools/biowatch/
          </a>
        </li>
      </ul>
    </div>
  )
}

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

export default function SettingsPage() {
  const settingsParams = {
    version: window.electron.process.env.npm_package_version,
    platform: window.electron.process.platform
  }
  return (
    <div className="flex gap-4 flex-col h-full">
      <header className="w-full flex border-b border-gray-200 divide-gray-200 divide-x sticky top-0 bg-white z-10 rounded-tl-md rounded-tr-md [&>a:last-child]:rounded-tr-md [&>a:first-child]:rounded-tl-md">
        <NavLink
          to={`/settings/info`}
          className={({ isActive }) =>
            `${isActive ? 'bg-gray-100' : ''} hover:bg-gray-100 transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <Info color="black" size={20} className="pb-[2px]" />
          Info
        </NavLink>
        <NavLink
          to={`/settings/ml_zoo`}
          className={({ isActive }) =>
            `${isActive ? 'bg-gray-100' : ''} cursor-pointer hover:bg-gray-100 transition-colors flex justify-center flex-row gap-2 items-center px-4 h-10 text-sm`
          }
        >
          <BrainCircuit color="black" size={20} className="pb-[2px]" />
          AI Models
        </NavLink>
      </header>
      <div className="flex-1 overflow-y-auto h-full pb-4">
        <Routes>
          <Route
            path="ml_zoo"
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'ml_zoo'}>
                <Zoo />
              </ErrorBoundary>
            }
          />
          <Route
            path="info"
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'info'}>
                <SettingsInfo {...settingsParams} />
              </ErrorBoundary>
            }
          />
          {/* Default route */}
          <Route path="*" element={<Navigate to="/settings/info" replace />} />
        </Routes>
      </div>
    </div>
  )
}
