import { FolderOpen, Pencil, Plus, Settings, Trash2, Search, ChevronRight } from 'lucide-react'
import { ErrorBoundary } from 'react-error-boundary'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import Import from './import'
import Study from './study'
import SettingsPage from './settings'
import DeleteStudyModal from './DeleteStudyModal'
import { useEffect, useState, useRef } from 'react'

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

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null) // { study, x, y }
  const [renamingStudyId, setRenamingStudyId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteModalStudy, setDeleteModalStudy] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const renameInputRef = useRef(null)

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

  // Context menu handlers
  const handleContextMenu = (e, study) => {
    e.preventDefault()
    setContextMenu({ study, x: e.clientX, y: e.clientY })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return

    const handleClickOutside = () => closeContextMenu()
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeContextMenu()
    }

    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  // Rename handlers
  const startRename = (study) => {
    closeContextMenu()
    setRenamingStudyId(study.id)
    setRenameValue(study.name)
  }

  const cancelRename = () => {
    setRenamingStudyId(null)
    setRenameValue('')
  }

  const saveRename = async () => {
    const study = studies.find((s) => s.id === renamingStudyId)
    if (renameValue.trim() && renameValue.trim() !== study?.name) {
      await window.api.updateStudy(renamingStudyId, { name: renameValue.trim() })
      queryClient.invalidateQueries(['studies'])
    }
    cancelRename()
  }

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      saveRename()
    } else if (e.key === 'Escape') {
      cancelRename()
    }
  }

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingStudyId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingStudyId])

  // Delete handlers
  const startDelete = (study) => {
    closeContextMenu()
    setDeleteModalStudy(study)
  }

  const confirmDelete = async () => {
    if (deleteModalStudy) {
      await window.api.deleteStudyDatabase(deleteModalStudy.id)
      setDeleteModalStudy(null)
    }
  }

  const cancelDelete = () => {
    setDeleteModalStudy(null)
  }

  // Filter studies based on search query
  const filteredStudies = studies.filter((study) =>
    study.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className={`relative flex h-svh flex-row`}>
      <div className="w-64 h-full flex flex-col fixed">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-gray-900">Studies</h2>
            <NavLink
              to="/import"
              className="h-7 w-7 p-0 flex items-center justify-center rounded hover:bg-gray-100 transition-colors"
              title="Add a new study"
            >
              <Plus className="h-4 w-4" />
            </NavLink>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search studies..."
              className="w-full pl-8 h-9 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Studies List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            {filteredStudies.map((study) => (
              <div key={study.id} onContextMenu={(e) => handleContextMenu(e, study)}>
                {renamingStudyId === study.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={saveRename}
                    className="w-full px-3 py-2.5 rounded-lg text-sm border border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1"
                  />
                ) : (
                  <NavLink
                    to={`/study/${study.id}`}
                    className={({ isActive }) =>
                      `w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-all group mb-1 ${
                        isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'
                      }`
                    }
                  >
                    <span className="flex-1 text-left truncate">{study.name}</span>
                    <ChevronRight
                      className={`h-4 w-4 flex-shrink-0 transition-opacity ${
                        location.pathname.includes(`/study/${study.id}`)
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-50'
                      }`}
                    />
                  </NavLink>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-gray-200">
          <NavLink
            to="/settings/ml_zoo"
            className="w-full flex items-center justify-start gap-2 px-3 py-2 text-sm hover:bg-gray-100 rounded-md transition-colors"
          >
            <Settings className="h-4 w-4" />
            Settings
          </NavLink>
        </div>
      </div>
      <main className="ml-64 relative flex w-[calc(100%-16rem)] flex-1 bg-transparent pt-3 pr-3">
        <div className="flex-col bg-white shadow w-full rounded-xl overflow-hidden">
          <Routes>
            <Route path="/import" element={<Import onNewStudy={onNewStudy} />} />
            <Route path="/study/:id/*" element={<Study />} />
            <Route path="/settings/*" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white rounded-md shadow-lg border border-gray-200 py-1 min-w-[140px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => startRename(contextMenu.study)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 text-left"
          >
            <Pencil size={14} />
            Rename
          </button>
          <button
            onClick={() => startDelete(contextMenu.study)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-gray-100 text-left"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}

      {/* Delete Study Modal */}
      <DeleteStudyModal
        isOpen={deleteModalStudy !== null}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        studyName={deleteModalStudy?.name}
      />
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
