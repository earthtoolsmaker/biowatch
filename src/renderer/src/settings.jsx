import { Navigate, Route, Routes } from 'react-router'
import { ErrorBoundary } from 'react-error-boundary'
import { BrainCircuit, Info, Github, Earth } from 'lucide-react'
import Zoo from './models'
import { modelZoo } from '../../shared/mlmodels'
import { Tab } from './components/Tab'

function SettingsFooter({ className }) {
  return (
    <div className={`flex justify-center py-8 ${className || ''}`}>
      <div className="flex flex-col items-center">
        {/* TODO: serve and display our own icon of ETM */}
        <img
          className="w-14 mb-4 transition-transform duration-700 ease-in-out hover:rotate-[360deg]"
          src="https://avatars.githubusercontent.com/u/165696201?s=200&v=4"
        />
        <span>
          Made with 💙 by{' '}
          <a
            href="https://www.earthtoolsmaker.org/tools/biowatch/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            EarthToolsMaker
          </a>
        </span>
      </div>
    </div>
  )
}

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
  const version = __APP_VERSION__
  const platform = window.electron.process.platform

  return (
    <div className="flex gap-4 flex-col h-full">
      <header className="w-full border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
        <nav aria-label="Tabs" className="-mb-px flex space-x-8 px-4">
          <Tab to="/settings/ml_zoo" icon={BrainCircuit}>
            AI Models
          </Tab>
          <Tab to="/settings/info" icon={Info}>
            Info
          </Tab>
        </nav>
      </header>
      <div className="flex-1 overflow-y-auto pb-4">
        <Routes>
          <Route
            path="ml_zoo"
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'ml_zoo'}>
                <div className="min-h-full flex flex-col">
                  <Zoo modelZoo={modelZoo} />
                  <SettingsFooter className="mt-auto" />
                </div>
              </ErrorBoundary>
            }
          />
          <Route
            path="info"
            element={
              <ErrorBoundary FallbackComponent={ErrorFallback} key={'info'}>
                <div className="min-h-full flex flex-col">
                  <SettingsInfo version={version} platform={platform} />
                  <SettingsFooter className="mt-auto" />
                </div>
              </ErrorBoundary>
            }
          />
          {/* Default route */}
          <Route path="*" element={<Navigate to="/settings/ml_zoo" replace />} />
        </Routes>
      </div>
    </div>
  )
}
