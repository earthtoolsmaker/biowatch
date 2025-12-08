import { FolderOpen, Plus, Settings } from 'lucide-react'
import { ErrorBoundary } from 'react-error-boundary'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import Import from './import'
import Study from './study'
import SettingsPage from './settings'
import { useEffect } from 'react'

// Create a client outside the component to avoid recreation
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false
    }
  }
})

function ErrorFallback({ error, resetErrorBoundary }) {
  console.log('ErrorFallback', error.stack)
  const navigate = useNavigate()

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
          onClick={() => {
            navigate('/import')
            // window.location.reload()
          }}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm"
        >
          Back
        </button>

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

        <button
          onClick={() => {
            localStorage.clear()
            resetErrorBoundary()
            navigate('/import')
          }}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm"
        >
          Clear all Data
        </button>
      </div>
    </div>
  )
}

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()

  const { data: studies = [], isLoading } = useQuery({
    queryKey: ['studies'],
    queryFn: async () => {
      const studies = await window.api.getStudies()
      console.log('Fetched studies from API:', studies)
      return studies.sort((a, b) => {
        if (!a.createdAt && !b.createdAt) return 0
        if (!a.createdAt) return -1
        if (!b.createdAt) return 1
        return new Date(a.createdAt) - new Date(b.createdAt)
      })
    },
    onError: (error) => {
      console.error('Failed to fetch studies:', error)
      alert('Failed to load studies: ' + error.message)
    }
  })

  useEffect(() => {
    if (isLoading) return
    const lastUrl = localStorage.getItem('lastUrl')

    if (studies.length === 0) {
      navigate('/import')
    } else if (lastUrl && lastUrl !== '/import') {
      navigate(lastUrl)
    } else {
      navigate(`/study/${studies[0].id}`)
    }
  }, [isLoading])

  // Store current URL in localStorage whenever it changes
  useEffect(() => {
    if (location.pathname === '/') {
      return
    }
    localStorage.setItem('lastUrl', location.pathname)
  }, [location])

  // Add listener for the delete study action
  useEffect(() => {
    const handleDeleteStudy = async (event, studyId) => {
      try {
        console.log('Deleting study with ID:', studyId)
        const updatedStudies = studies.filter((s) => s.id !== studyId)
        queryClient.invalidateQueries(['studies'])

        // Navigate away if we're on the deleted study
        if (location.pathname.includes(`/study/${studyId}`)) {
          if (updatedStudies.length > 0) {
            navigate(`/study/${updatedStudies[0].id}`)
          } else {
            navigate('/import')
          }
        }
        // No need to update local state, let the query handle data
      } catch (error) {
        console.error('Failed to delete study:', error)
        alert('Failed to delete study: ' + error.message)
      }
    }

    // Register the IPC event listener
    window.electron.ipcRenderer.on('study:delete', handleDeleteStudy)

    return () => {
      // Clean up listener when component unmounts
      window.electron.ipcRenderer.removeListener('study:delete', handleDeleteStudy)
    }
  }, [studies, location, navigate])

  const onNewStudy = (study) => {
    const isValid = study && study.id && study.name && study.data && study.path
    if (!isValid) {
      console.warn('Invalid study data', study)
    }
    // Invalidate the query to refetch studies
    queryClient.invalidateQueries(['studies'])
  }

  return (
    <div className={`relative flex h-svh flex-row`}>
      <div className="w-52 h-full p-2 fixed">
        {/* <header className="p-2">
          <div className="text-base font-semibold p-2 flex items-center">
            <span className="pt-[3px]">Biowatch</span>
            <Camera color="black" size={24} className="rotate-[80deg]" />
          </div>
        </header> */}
        <ul className="flex w-full min-w-0 flex-col gap-4 p-2">
          <li>
            <div className="flex w-full items-center h-8 text-sm font-medium rounded-md p-2 cursor-default gap-2">
              <FolderOpen className="text-gray-500" size={16} />
              <span className="flex-1">Studies</span>
              <NavLink
                to="/import"
                className="flex items-center justify-center w-5 h-5 rounded hover:bg-gray-200 transition-colors"
                title="Add a new study"
              >
                <Plus color="black" size={14} />
              </NavLink>
            </div>
            <ul className="border-l mx-3.5 border-gray-200 flex w-full flex-col gap-2 px-1.5 py-0.5 text-[hsl(var(--sidebar-foreground))]">
              {studies.map((study) => (
                <li key={study.id}>
                  <NavLink
                    to={`/study/${study.id}`}
                    className={({ isActive }) =>
                      `break-anywhere flex w-full items-center text-sm hover:bg-gray-100 rounded-md px-2 py-1 ${isActive ? 'font-semibold' : ''}`
                    }
                  >
                    {study.name}
                  </NavLink>
                </li>
              ))}
            </ul>
          </li>
        </ul>
        <footer className="absolute left-0 bottom-0 w-full p-2">
          <NavLink
            to="/settings/ml_zoo"
            className={({ isActive }) =>
              `flex w-full items-center gap-2 text-sm hover:bg-gray-100 rounded-md p-2 ${isActive ? 'font-semibold' : ''}`
            }
          >
            <Settings className="text-gray-500" size={16} />
            <span>Settings</span>
          </NavLink>
        </footer>
      </div>
      <main className="ml-52 relative flex w-[calc(100%-14rem)] flex-1 bg-transparent pt-3 pr-3">
        <div className="flex-col bg-white rounded-t-xl shadow w-full">
          <Routes>
            <Route path="/import" element={<Import onNewStudy={onNewStudy} />} />
            <Route path="/study/:id/*" element={<Study />} />
            <Route path="/settings/*" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <AppContent />
        </ErrorBoundary>
      </HashRouter>
    </QueryClientProvider>
  )
}
